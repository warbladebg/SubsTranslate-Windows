import { describe, expect, it, vi } from "vitest";
import type { CatalogDetails, TorrentSource } from "../src/core/discovery/DiscoveryTypes";
import { OtherDebridService } from "../src/main/otherDebridService";

const hash = "a".repeat(40);
const source: TorrentSource = {
  id: "source", provider: "Comet", infoHash: hash, name: "Open.Film.1080p.mkv",
  trackers: [], observedAt: "2026-09-25T00:00:00Z", providerClaimedCached: false, cacheStatus: "unknown"
};
const movie = { mediaType: "movie", imdbId: "tt1234567" } as CatalogDetails;
const reply = (value: unknown) => new Response(JSON.stringify(value), { status: 200,
  headers: { "Content-Type": "application/json" } });

describe("other debrid services", () => {
  it("checks Premiumize cache and downloads only a video file", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => String(input).endsWith("/api/cache/check")
      ? reply({ status: "success", response: [true] })
      : reply({ status: "success", content: [
        { path: "sample.exe", link: "https://cdn.example/sample.exe", size: 10 },
        { path: "Open.Film.1080p.mkv", link: "https://cdn.example/film.mkv", size: 1000 }
      ] }));
    const service = new OtherDebridService(async () => "premiumize-secret", fetchMock as typeof fetch);
    const files = await service.resolveCachedDownloads("premiumize", source, movie);
    expect(files).toMatchObject([{ filename: "Open.Film.1080p.mkv", url: "https://cdn.example/film.mkv" }]);
    expect(JSON.stringify(files)).not.toContain("premiumize-secret");
  });

  it("uses TorBox's cached-only add and obtains the file ID from the account list", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("checkcached")) return reply({ success: true, data: { [hash]: { hash, name: "Open Film" } } });
      if (url.includes("createtorrent")) {
        expect((init?.body as FormData).get("add_only_if_cached")).toBe("true");
        return reply({ success: true, data: { torrent_id: 12 } });
      }
      if (url.includes("mylist")) return reply({ success: true, data: { id: 12, hash, download_finished: true,
        files: [{ id: 5, name: "Open.Film.mkv", size: 1000 }] } });
      if (url.includes("requestdl")) return reply({ success: true, data: "https://cdn.example/film.mkv" });
      throw new Error("unexpected request");
    });
    const service = new OtherDebridService(async () => "torbox-secret", fetchMock as typeof fetch);
    const files = await service.resolveCachedDownloads("torbox", source, movie);
    expect(files).toMatchObject([{ filename: "Open.Film.mkv", url: "https://cdn.example/film.mkv" }]);
  });

  it("requires AllDebrid to confirm a ready matching hash before resolving files", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.includes("magnet/upload")) return reply({ status: "success", data: { magnets: [{ hash, id: 42, ready: true }] } });
      if (url.includes("magnet/files")) return reply({ status: "success", data: { magnets: [{ files: [
        { n: "Open.Film.mkv", s: 1000, l: "https://alldebrid.com/f/file" }
      ] }] } });
      if (url.includes("link/unlock")) return reply({ status: "success", data: { link: "https://cdn.example/film.mkv" } });
      throw new Error("unexpected request");
    });
    const service = new OtherDebridService(async () => "ad-secret", fetchMock as typeof fetch);
    expect(await service.resolveCachedDownloads("all-debrid", source, movie)).toMatchObject([
      { filename: "Open.Film.mkv", url: "https://cdn.example/film.mkv" }
    ]);
  });

  it("uses Debrid-Link's cached hash add and rejects unready files", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => String(input).includes("seedbox/list")
      ? reply({ success: true, value: [] })
      : reply({ success: true, value: { hashString: hash, downloadPercent: 20, files: [] } }));
    const service = new OtherDebridService(async () => "dl-secret", fetchMock as typeof fetch);
    await expect(service.resolveCachedDownloads("debrid-link", source, movie)).rejects.toThrow("not confirm");
  });
});
