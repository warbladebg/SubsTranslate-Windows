import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DownloadManager } from "../src/main/downloadManager";
import type { DownloadProgress } from "../src/core/discovery/DiscoveryTypes";

describe("Real-Debrid download manager", () => {
  it("accepts chunked responses without a declared content length", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rd-download-chunked-"));
    const outputPath = join(directory, "chunked.bin");
    const progress: DownloadProgress[] = [];
    const manager = new DownloadManager(vi.fn(async () => new Response("chunked data")) as typeof fetch);
    await manager.download("https://cdn.example/file", outputPath, "chunked.bin", (event) => progress.push(event));
    expect(await readFile(outputPath, "utf8")).toBe("chunked data");
    expect(progress.at(-1)).toMatchObject({ status: "completed", totalBytes: undefined });
  });

  it("cleans up active state when the starting progress listener throws", async () => {
    const manager = new DownloadManager(vi.fn() as typeof fetch);
    await expect(manager.download("https://cdn.example/file", join(tmpdir(), "listener.bin"), "listener.bin", () => {
      throw new Error("renderer closed");
    })).rejects.toThrow("renderer closed");
    expect(manager.isActive()).toBe(false);
    await manager.cancel();
  });

  it("honors cancellation from the starting event without starting a network request", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rd-download-early-cancel-"));
    const fetchMock = vi.fn();
    const manager = new DownloadManager(fetchMock as typeof fetch);
    let cancellation: Promise<void> | undefined;
    await expect(manager.download("https://cdn.example/file", join(directory, "cancelled.bin"), "cancelled.bin", (event) => {
      if (event.status === "starting") cancellation = manager.cancel();
    })).rejects.toThrow(/cancelled/i);
    await cancellation;
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
  });
  it("streams to a temporary file, verifies length, and atomically installs the result", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rd-download-"));
    const outputPath = join(directory, "legal.bin");
    const bytes = new TextEncoder().encode("lawfully distributed test file");
    const fetchMock = vi.fn(async () => fakeDownloadResponse(bytes, bytes.length));
    const progress: DownloadProgress[] = [];
    const manager = new DownloadManager(fetchMock as typeof fetch);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValueOnce(1_000).mockReturnValue(2_000);

    await expect(manager.download(
      "https://cdn.example/legal.bin",
      outputPath,
      "legal.bin",
      (message) => progress.push(message)
    )).resolves.toBe(outputPath);

    expect(await readFile(outputPath, "utf8")).toBe("lawfully distributed test file");
    expect(progress.at(-1)).toMatchObject({ status: "completed", percent: 100, outputPath });
    expect(progress.at(-1)).toMatchObject({
      elapsedSeconds: 1,
      bytesPerSecond: bytes.length
    });
    expect(manager.isActive()).toBe(false);
    nowSpy.mockRestore();
  });

  it("removes partial output and fails when content length does not match", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rd-download-short-"));
    const outputPath = join(directory, "short.bin");
    const bytes = new TextEncoder().encode("short");
    const manager = new DownloadManager(
      vi.fn(async () => fakeDownloadResponse(bytes, bytes.length + 10)) as typeof fetch
    );

    await expect(manager.download(
      "https://cdn.example/short.bin",
      outputPath,
      "short.bin",
      () => undefined
    )).rejects.toThrow(/ended early/i);
    await expect(readFile(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    "http://cdn.example/file",
    "https://localhost/file",
    "https://127.0.0.1/file",
    "file:///tmp/file"
  ])("rejects an unsafe download URL before fetch: %s", async (url) => {
    const fetchMock = vi.fn();
    const manager = new DownloadManager(fetchMock as typeof fetch);
    await expect(manager.download(url, join(tmpdir(), "blocked.bin"), "blocked.bin", () => undefined))
      .rejects.toThrow(/public HTTPS/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates each redirect before making the next request", async () => {
    const cancel = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 302,
      url: "https://cdn.example/start",
      headers: new Headers({ location: "http://127.0.0.1/private" }),
      body: { cancel }
    } as unknown as Response));
    const manager = new DownloadManager(fetchMock as typeof fetch);

    await expect(manager.download(
      "https://cdn.example/start",
      join(tmpdir(), "redirect-blocked.bin"),
      "redirect-blocked.bin",
      () => undefined
    )).rejects.toThrow(/public HTTPS/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("does not finish cancellation until the downloaded part has been deleted", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rd-download-cancel-"));
    const outputPath = join(directory, "cancelled.bin");
    const progress: DownloadProgress[] = [];
    let releaseFirstChunk!: () => void;
    const firstChunkWritten = new Promise<void>((resolve) => {
      releaseFirstChunk = resolve;
    });
    const manager = new DownloadManager(vi.fn(async (_url, init) => {
      const signal = init?.signal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("partially downloaded data"));
          signal?.addEventListener("abort", () => {
            controller.error(new DOMException("Download cancelled.", "AbortError"));
          }, { once: true });
        }
      });
      return {
        ok: true,
        status: 200,
        url: "https://cdn.example/cancelled.bin",
        headers: new Headers({ "content-length": "1024" }),
        body
      } as Response;
    }) as typeof fetch);

    const download = manager.download(
      "https://cdn.example/cancelled.bin",
      outputPath,
      "cancelled.bin",
      (message) => {
        progress.push(message);
        if (message.status === "downloading") {
          releaseFirstChunk();
        }
      }
    );
    const rejectedDownload = expect(download).rejects.toThrow(/cancelled/i);
    await firstChunkWritten;

    await manager.cancel();

    await rejectedDownload;
    expect(progress.at(-1)).toMatchObject({ status: "cancelled" });
    expect(await readdir(directory)).toEqual([]);
    expect(manager.isActive()).toBe(false);
  });
});

function fakeDownloadResponse(bytes: Uint8Array, contentLength: number): Response {
  const body = new Response(bytes.slice().buffer as ArrayBuffer).body;
  return {
    ok: true,
    status: 200,
    url: "https://cdn.example/final.bin",
    headers: new Headers({ "content-length": String(contentLength) }),
    body
  } as Response;
}
