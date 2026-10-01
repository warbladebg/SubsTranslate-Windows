import { describe, expect, it, vi } from "vitest";
import type { CatalogDetails, TorrentSource } from "../src/core/discovery/DiscoveryTypes";
import { RealDebridService } from "../src/main/realDebridService";

describe("Real-Debrid integration", () => {
  it("shows account-verified hashes and preserves provider cache claims", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer rd-token");
      const url = String(input);
      if (url.includes("/torrents?")) {
        return json([
          torrentSummary("rd-downloaded", "a", "downloaded"),
          torrentSummary("rd-active", "b", "downloading")
        ]);
      }
      if (url.endsWith("/torrents/info/rd-downloaded")) {
        return json(torrentInfo("rd-downloaded", "a", "downloaded"));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const service = new RealDebridService(async () => "rd-token", fetchMock as typeof fetch);
    const sources = [
      source("known", "a"),
      source("active", "b"),
      { ...source("provider-claim", "c"), providerClaimedCached: true }
    ];

    const verified = await service.getVerifiedCachedSources({ sources, media: movie });

    expect(verified).toHaveLength(2);
    expect(verified.find(({ id }) => id === "known")).toMatchObject({
      id: "known",
      cacheStatus: "verified-account-cached",
      realDebridTorrentId: "rd-downloaded",
      realDebridFileId: 1
    });
    expect(verified.find(({ id }) => id === "provider-claim")).toMatchObject({
      id: "provider-claim",
      cacheStatus: "provider-claimed-cached",
      providerClaimedCached: true
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("addMagnet"))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("selectFiles"))).toBe(false);
  });

  it("resolves a provider-cached source through a sanitized magnet and selects only its media file", async () => {
    let selected = false;
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/torrents/addMagnet")) {
        expect(init?.method).toBe("POST");
        const magnet = new URLSearchParams(String(init?.body)).get("magnet");
        expect(magnet).toMatch(/^magnet:\?/);
        expect(magnet).toContain(`xt=urn:btih:${"c".repeat(40)}`);
        expect(magnet).not.toContain("urn%3Abtih");
        expect(new URL(magnet!).searchParams.get("xt")).toBe(`urn:btih:${"c".repeat(40)}`);
        return json({ id: "provider-added" });
      }
      if (url.endsWith("/torrents/selectFiles/provider-added")) {
        expect(init?.method).toBe("POST");
        expect(new URLSearchParams(String(init?.body)).get("files")).toBe("1");
        selected = true;
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/torrents/info/provider-added")) {
        return selected
          ? json(torrentInfo("provider-added", "c", "downloaded"))
          : json({
            ...torrentInfo("provider-added", "c", "waiting_files_selection"),
            links: [],
            files: [
              { id: 1, path: "/Legal.Film.1080p.mkv", bytes: 1_234, selected: 0 },
              { id: 2, path: "/sample.mkv", bytes: 100, selected: 0 }
            ]
          });
      }
      if (url.endsWith("/unrestrict/link")) {
        return json({
          download: "https://cdn.example/provider-film.mkv",
          filename: "Provider Film.mkv",
          filesize: 1_234
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const service = new RealDebridService(async () => "rd-token", fetchMock as typeof fetch);

    await expect(service.resolveVerifiedDownload({
      ...source("provider-claim", "c"),
      providerClaimedCached: true,
      cacheStatus: "provider-claimed-cached"
    }, movie)).resolves.toEqual({
      url: "https://cdn.example/provider-film.mkv",
      filename: "Provider Film.mkv",
      sizeBytes: 1_234
    });

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/torrents/delete/"))).toBe(false);
  });

  it("removes a newly added torrent when a provider cache claim is stale", async () => {
    let selected = false;
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.endsWith("/torrents/addMagnet")) {
        return json({ id: "stale-provider" });
      }
      if (url.endsWith("/torrents/selectFiles/stale-provider")) {
        selected = true;
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/torrents/info/stale-provider")) {
        return json({
          ...torrentInfo("stale-provider", "e", selected ? "error" : "waiting_files_selection"),
          links: [],
          files: [{ id: 1, path: "/Legal.Film.1080p.mkv", bytes: 1_234, selected: selected ? 1 : 0 }]
        });
      }
      if (url.endsWith("/torrents/delete/stale-provider")) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const service = new RealDebridService(async () => "rd-token", fetchMock as typeof fetch);

    await expect(service.resolveVerifiedDownload({
      ...source("stale-provider", "e"),
      providerClaimedCached: true,
      cacheStatus: "provider-claimed-cached"
    }, movie)).rejects.toThrow(/provider cache claim is stale/i);

    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/torrents/delete/stale-provider"))).toBe(true);
  });

  it("revalidates the downloaded hash and exact file before unrestricting", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/torrents/info/rd-downloaded")) {
        return json(torrentInfo("rd-downloaded", "a", "downloaded"));
      }
      if (url.endsWith("/unrestrict/link")) {
        expect(init?.method).toBe("POST");
        expect(String(init?.body)).toContain(encodeURIComponent("https://restricted.example/legal"));
        return json({
          download: "https://cdn.example/legal-film.mkv",
          filename: "Legal Film.mkv",
          filesize: 1_234
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const service = new RealDebridService(async () => "rd-token", fetchMock as typeof fetch);

    await expect(service.resolveVerifiedDownload({
      ...source("known", "a"),
      cacheStatus: "verified-account-cached",
      realDebridTorrentId: "rd-downloaded",
      realDebridFileId: 1
    }, movie)).resolves.toEqual({
      url: "https://cdn.example/legal-film.mkv",
      filename: "Legal Film.mkv",
      sizeBytes: 1_234
    });
  });

  it("refuses an item that is no longer downloaded and never unrestricts it", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.endsWith("/torrents/info/rd-downloaded")) {
        return json(torrentInfo("rd-downloaded", "a", "downloading"));
      }
      throw new Error("Unrestrict should not be called");
    });
    const service = new RealDebridService(async () => "rd-token", fetchMock as typeof fetch);

    await expect(service.resolveVerifiedDownload({
      ...source("known", "a"),
      cacheStatus: "verified-account-cached",
      realDebridTorrentId: "rd-downloaded",
      realDebridFileId: 1
    }, movie)).rejects.toThrow(/no longer available/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("verifies the exact selected TV episode inside a cached season pack", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.includes("/torrents?")) {
        return json([{
          ...torrentSummary("season-pack", "d", "downloaded"),
          links: [
            "https://restricted.example/episode-1",
            "https://restricted.example/episode-2",
            "https://restricted.example/episode-3"
          ]
        }]);
      }
      if (url.endsWith("/torrents/info/season-pack")) {
        return json({
          ...torrentSummary("season-pack", "d", "downloaded"),
          links: [
            "https://restricted.example/episode-1",
            "https://restricted.example/episode-2",
            "https://restricted.example/episode-3"
          ],
          files: [
            { id: 10, path: "/Open.Show.S01E01.mkv", bytes: 1_000, selected: 1 },
            { id: 11, path: "/Open.Show.S01E02.mkv", bytes: 1_100, selected: 1 },
            { id: 12, path: "/Open.Show.S01E03.mkv", bytes: 1_200, selected: 1 }
          ]
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const service = new RealDebridService(async () => "rd-token", fetchMock as typeof fetch);

    const verified = await service.getVerifiedCachedSources({
      sources: [{ ...source("season", "d"), fileIndex: undefined }],
      media: { ...movie, mediaType: "series", seasons: [{ seasonNumber: 1, name: "Season 1", episodeCount: 3 }] },
      season: 1,
      episode: 2
    });

    expect(verified).toMatchObject([{ realDebridFileId: 11, cacheStatus: "verified-account-cached" }]);
  });

  it("selects and resolves every episode in the requested provider-cached season", async () => {
    let selected = false;
    const selectedFiles = [
      { id: 10, path: "/Show/Season 2/Show.S02E01.mkv", bytes: 1_001, selected: 1 },
      { id: 11, path: "/Show/Season 2/Show.S02E02.mkv", bytes: 1_002, selected: 1 }
    ];
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/torrents/addMagnet")) {
        return json({ id: "provider-season" });
      }
      if (url.endsWith("/torrents/selectFiles/provider-season")) {
        expect(new URLSearchParams(String(init?.body)).get("files")).toBe("10,11");
        selected = true;
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/torrents/info/provider-season")) {
        return json({
          ...torrentSummary("provider-season", "f", selected ? "downloaded" : "waiting_files_selection"),
          links: selected
            ? ["https://restricted.example/s02e01", "https://restricted.example/s02e02"]
            : [],
          files: [
            ...selectedFiles.map((file) => ({ ...file, selected: selected ? 1 : 0 })),
            { id: 12, path: "/Show/Season 3/Show.S03E01.mkv", bytes: 1_003, selected: 0 },
            { id: 13, path: "/Show/Season 2/sample.mkv", bytes: 100, selected: 0 }
          ]
        });
      }
      if (url.endsWith("/unrestrict/link")) {
        const link = new URLSearchParams(String(init?.body)).get("link")!;
        const episode = link.endsWith("s02e01") ? "01" : "02";
        return json({
          download: `https://cdn.example/show-s02e${episode}.mkv`,
          filename: `Show.S02E${episode}.mkv`,
          filesize: episode === "01" ? 1_001 : 1_002
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const service = new RealDebridService(async () => "rd-token", fetchMock as typeof fetch);

    const downloads = await service.resolveVerifiedDownloads({
      ...source("season-pack", "f"),
      fileIndex: undefined,
      isSeasonPack: true,
      providerClaimedCached: true,
      cacheStatus: "provider-claimed-cached"
    }, {
      ...movie,
      mediaType: "series",
      seasons: [{ seasonNumber: 2, name: "Season 2", episodeCount: 2 }]
    }, 2, undefined);

    expect(downloads).toMatchObject([
      { filename: "Show.S02E01.mkv", episodeNumber: 1 },
      { filename: "Show.S02E02.mkv", episodeNumber: 2 }
    ]);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/unrestrict/link"))).toHaveLength(2);
  });

  it.each([false, true])("downloads only selected episodes (provider cache: %s)", async (provider) => {
    let selected = false;
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/torrents/addMagnet")) return json({ id: "subset" });
      if (url.endsWith("/torrents/selectFiles/subset")) {
        expect(new URLSearchParams(String(init?.body)).get("files")).toBe("1,3");
        selected = true;
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/torrents/info/subset")) {
        const included = provider && selected ? [1, 3] : [1, 2, 3];
        return json({
          ...torrentSummary("subset", "a", provider && !selected ? "waiting_files_selection" : "downloaded"),
          files: [1, 2, 3].map((n) => ({ id: n, path: `/Show.S01E0${n}.mkv`, bytes: 1000, selected: included.includes(n) ? 1 : 0 })),
          links: included.map((n) => `https://restricted.example/episode${n}`)
        });
      }
      if (url.endsWith("/unrestrict/link")) {
        const link = new URLSearchParams(String(init?.body)).get("link")!;
        expect(link).not.toContain("episode2");
        return json({ download: `https://cdn.example/${link.split("/").pop()}.mkv` });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const service = new RealDebridService(async () => "token", fetchMock as typeof fetch);
    const downloads = await service.resolveVerifiedDownloads({
      ...source("subset", "a"), isSeasonPack: true,
      cacheStatus: provider ? "provider-claimed-cached" : "verified-account-cached",
      providerClaimedCached: provider, realDebridTorrentId: "subset"
    }, { ...movie, mediaType: "series" }, 1, undefined, [3, 1]);
    expect(downloads.map((file) => file.episodeNumber)).toEqual([1, 3]);
  });

  it("rejects empty selections and missing episodes before unrestricting files", async () => {
    const fetchMock = vi.fn(async () => json({
      ...torrentSummary("subset", "a", "downloaded"),
      files: [{ id: 1, path: "/Show.S01E01.mkv", bytes: 1000, selected: 1 }],
      links: ["https://restricted.example/episode1"]
    }));
    const service = new RealDebridService(async () => "token", fetchMock as typeof fetch);
    const cached: TorrentSource = { ...source("subset", "a"), isSeasonPack: true, cacheStatus: "verified-account-cached", realDebridTorrentId: "subset" };
    await expect(service.resolveVerifiedDownloads(cached, { ...movie, mediaType: "series" }, 1, undefined, [])).rejects.toThrow(/at least one/);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(service.resolveVerifiedDownloads(cached, { ...movie, mediaType: "series" }, 1, undefined, [1, 3])).rejects.toThrow(/missing selected episodes: 3/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never makes an API call without a token", async () => {
    const fetchMock = vi.fn();
    const service = new RealDebridService(async () => undefined, fetchMock as typeof fetch);

    await expect(service.getVerifiedCachedSources({ sources: [source("known", "a")], media: movie }))
      .rejects.toThrow(/token is missing/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

const movie: CatalogDetails = {
  id: "tt1234567",
  mediaType: "movie",
  title: "Legal Film",
  overview: "",
  genreIds: [99],
  voteAverage: 8,
  voteCount: 1_000,
  popularity: 20,
  imdbId: "tt1234567",
  genres: [{ id: 99, name: "Documentary" }],
  cast: [],
  crew: [],
  videos: [],
  seasons: [],
  recommendations: []
};

function source(id: string, hashCharacter: string): TorrentSource {
  return {
    id,
    provider: "authorized.example",
    infoHash: hashCharacter.repeat(40),
    fileIndex: 0,
    name: "Legal.Film.1080p.mkv",
    trackers: [],
    observedAt: "2026-07-17T00:00:00.000Z",
    providerClaimedCached: false,
    cacheStatus: "unknown"
  };
}

function torrentSummary(id: string, hashCharacter: string, status: string) {
  return {
    id,
    filename: "Legal Film",
    hash: hashCharacter.repeat(40),
    status,
    links: ["https://restricted.example/legal"],
    added: "2026-07-17T00:00:00.000Z"
  };
}

function torrentInfo(id: string, hashCharacter: string, status: string) {
  return {
    ...torrentSummary(id, hashCharacter, status),
    files: [
      { id: 1, path: "/Legal.Film.1080p.mkv", bytes: 1_234, selected: 1 },
      { id: 2, path: "/sample.mkv", bytes: 100, selected: 0 }
    ]
  };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
