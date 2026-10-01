import { parsePublicHttpsUrl } from "./publicHttpsUrl";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { DownloadProgress } from "../core/discovery/DiscoveryTypes";
import { electronFetch } from "./electronFetch";
import { errorMessage, isAbortError } from "../core/util/errors";
import { pathExists } from "./fsUtils";

type FetchLike = typeof fetch;
type ProgressListener = (progress: DownloadProgress) => void;

export class DownloadManager {
  private active?: {
    id: string;
    controller: AbortController;
    cleanupComplete: Promise<void>;
    resolveCleanup: () => void;
  };

  constructor(private readonly fetchImpl: FetchLike = electronFetch) {}

  async download(
    url: string,
    outputPath: string,
    filename: string,
    onProgress: ProgressListener
  ): Promise<string> {
    if (this.active) {
      throw new Error("Another Real-Debrid download is already active.");
    }
    validateHttpsDownloadUrl(url);
    if (!outputPath || /[\r\n\0]/.test(outputPath)) {
      throw new Error("Invalid download destination.");
    }

    const id = randomUUID();
    const controller = new AbortController();
    let resolveCleanup!: () => void;
    const cleanupComplete = new Promise<void>((resolve) => {
      resolveCleanup = resolve;
    });
    this.active = { id, controller, cleanupComplete, resolveCleanup };
    const temporaryPath = `${outputPath}.part-${id}`;
    const startedAt = Date.now();
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let response: Response | undefined;
    let receivedBytes = 0;
    let totalBytes: number | undefined;
    let lastProgressAt = 0;
    try {
      onProgress({ id, filename, receivedBytes, status: "starting" });
      await mkdir(dirname(outputPath), { recursive: true });
      controller.signal.throwIfAborted();
      response = await fetchFollowingSafeRedirects(this.fetchImpl, url, controller.signal);
      controller.signal.throwIfAborted();
      if (!response.ok || !response.body) {
        throw new Error(`Download failed with HTTP ${response.status}.`);
      }
      const declaredLength = response.headers.get("content-length");
      const contentLength = declaredLength === null ? NaN : Number(declaredLength);
      totalBytes = Number.isSafeInteger(contentLength) && contentLength >= 0 ? contentLength : undefined;
      handle = await open(temporaryPath, "wx");
      const reader = response.body.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          controller.signal.throwIfAborted();
          if (done) {
            break;
          }
          await writeAll(handle, value);
          receivedBytes += value.byteLength;
          const now = Date.now();
          if (now - lastProgressAt >= 200) {
            lastProgressAt = now;
            onProgress(progressSnapshot(id, filename, receivedBytes, totalBytes, "downloading", startedAt));
          }
        }
      } finally {
        reader.releaseLock();
      }
      await handle.sync();
      await handle.close();
      handle = undefined;
      controller.signal.throwIfAborted();
      if (totalBytes !== undefined && receivedBytes !== totalBytes) {
        throw new Error(`Download ended early: received ${receivedBytes} of ${totalBytes} bytes.`);
      }
      await safelyInstallDownload(temporaryPath, outputPath, id);
      onProgress({
        ...progressSnapshot(id, filename, receivedBytes, totalBytes, "completed", startedAt),
        outputPath
      });
      return outputPath;
    } catch (error) {
      await response?.body?.cancel().catch(() => undefined);
      await handle?.close().catch(() => undefined);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      const cancelled = isAbortError(error);
      onProgress({
        ...progressSnapshot(id, filename, receivedBytes, totalBytes, cancelled ? "cancelled" : "failed", startedAt),
        message: cancelled ? "Download cancelled." : safeErrorMessage(error)
      });
      if (cancelled) {
        throw new Error("Download cancelled.", { cause: error });
      }
      throw error;
    } finally {
      if (this.active?.id === id) {
        this.active.resolveCleanup();
        this.active = undefined;
      }
    }
  }

  async cancel(): Promise<void> {
    const active = this.active;
    if (!active) {
      return;
    }
    active.controller.abort();
    await active.cleanupComplete;
  }

  isActive(): boolean {
    return Boolean(this.active);
  }
}

function progressSnapshot(
  id: string,
  filename: string,
  receivedBytes: number,
  totalBytes: number | undefined,
  status: DownloadProgress["status"],
  startedAt: number
): DownloadProgress {
  const elapsedSeconds = Math.max(0, (Date.now() - startedAt) / 1000);
  const bytesPerSecond = receivedBytes > 0 && elapsedSeconds > 0
    ? receivedBytes / elapsedSeconds
    : undefined;
  const estimatedRemainingSeconds = totalBytes !== undefined
    && totalBytes > receivedBytes
    && bytesPerSecond !== undefined
    && bytesPerSecond > 0
    ? (totalBytes - receivedBytes) / bytesPerSecond
    : undefined;
  return {
    id,
    filename,
    receivedBytes,
    totalBytes,
    percent: totalBytes && totalBytes > 0 ? Math.min(100, receivedBytes / totalBytes * 100) : undefined,
    bytesPerSecond,
    elapsedSeconds,
    estimatedRemainingSeconds,
    status
  };
}

function validateHttpsDownloadUrl(value: string): void {
  if (!parsePublicHttpsUrl(value)) {
    throw new Error("Download URL must be a public HTTPS address without embedded credentials.");
  }
}

function safeErrorMessage(error: unknown): string {
  return errorMessage(error)
    .replace(/https?:\/\/\S+/gi, "[download URL]")
    .replace(/[\r\n\0]+/g, " ")
    .slice(0, 500);
}

async function fetchFollowingSafeRedirects(
  fetchImpl: FetchLike,
  initialUrl: string,
  signal: AbortSignal
): Promise<Response> {
  let currentUrl = initialUrl;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    validateHttpsDownloadUrl(currentUrl);
    const response = await fetchImpl(currentUrl, {
      headers: { Accept: "application/octet-stream" },
      signal,
      redirect: "manual"
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      if (response.url) {
        validateHttpsDownloadUrl(response.url);
      }
      return response;
    }
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    if (!location) {
      throw new Error("Download redirect did not include a destination.");
    }
    currentUrl = new URL(location, currentUrl).toString();
  }
  throw new Error("Download exceeded the safe redirect limit.");
}

async function writeAll(handle: Awaited<ReturnType<typeof open>>, value: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < value.byteLength) {
    const { bytesWritten } = await handle.write(value, offset, value.byteLength - offset);
    if (bytesWritten <= 0) {
      throw new Error("Could not write the downloaded data to disk.");
    }
    offset += bytesWritten;
  }
}

async function safelyInstallDownload(temporaryPath: string, outputPath: string, id: string): Promise<void> {
  const backupPath = `${outputPath}.download-backup-${id}`;
  const outputExisted = await pathExists(outputPath);
  if (outputExisted) {
    await rename(outputPath, backupPath);
  }
  try {
    await rename(temporaryPath, outputPath);
    await rm(backupPath, { force: true });
  } catch (error) {
    if (outputExisted) {
      await rename(backupPath, outputPath).catch(() => undefined);
    }
    throw error;
  }
}
