import { describe, expect, it, vi } from "vitest";
import type { CatalogDetails, SourceSearchRequest } from "../src/core/discovery/DiscoveryTypes";
import { defaultDiscoveryPreferences } from "../src/main/discoveryStore";
import {
  SourceAggregatorService,
  type SourceAggregationRequest
} from "../src/main/sourceAggregatorService";

describe("torrent source aggregation", () => {
  it.each(["torrentio", "comet", "mediafusion"] as const)(
    "sorts %s results by resolution and then by size",
    async (provider) => {
      const fetchMock = vi.fn(async () => response({ streams: [
        stream("a", "Show.S01E02.720p 20 GB 👤 999", 2),
        stream("b", "Show.S01E02.1080p 3 GB 👤 100", 2),
        stream("c", "Show.S01E02.2160p 2 GB 👤 1", 2),
        stream("d", "Show.S01E02.1080p 6 GB 👤 1", 2)
      ] }));
      const service = new SourceAggregatorService(fetchMock as typeof fetch);
      const result = await service.search({ ...seriesRequest(), preferences: {
        ...seriesRequest().preferences, sourceProvider: provider
      } });
      expect(result.sources.map((source) => source.infoHash[0])).toEqual(["c", "d", "b", "a"]);
    }
  );

  it("routes searches through the selected community scraper and keeps credentials out of results", async () => {
    const seen: string[] = [];
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      seen.push(String(input));
      return response({ streams: [stream("a", "Show.S01E02.1080p.mkv", 2)] });
    });
    const service = new SourceAggregatorService(fetchMock as typeof fetch);
    const comet = await service.search({ ...seriesRequest(), preferences: {
      ...defaultDiscoveryPreferences, sourceProvider: "comet"
    }, realDebridApiToken: "test-secret" });
    const mediaFusion = await service.search({ ...seriesRequest(), preferences: {
      ...defaultDiscoveryPreferences, sourceProvider: "mediafusion"
    } });
    expect(seen[0]).toMatch(/^https:\/\/comet\.feels\.legal\/[^/]+\/stream\/series\/tt1234567:1:2\.json$/);
    expect(seen[1]).toBe("https://mediafusionfortheweebs.midnightignite.me/stream/series/tt1234567:1:2.json");
    expect(comet.sources[0].provider).toBe("Comet");
    expect(mediaFusion.sources[0].provider).toBe("MediaFusion");
    expect(JSON.stringify(comet)).not.toContain("test-secret");
  });
  it("requests both Comet debrid and torrent results when Real-Debrid is connected", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const encoded = String(input).split("/")[3];
      expect(JSON.parse(Buffer.from(encoded, "base64").toString("utf8"))).toEqual({
        debridServices: [{ service: "realdebrid", apiKey: "rd-secret" }],
        enableTorrent: true
      });
      return response({ streams: [
        { name: "[RD⚡] Comet 1080p", description: "Show.S01E02.1080p", url: `https://comet.feels.legal/${encoded}/playback/${"a".repeat(40)}/0/2/1/2` },
        stream("b", "Show.S01E02.1080p 3 GB", 3)
      ] });
    });
    const result = await new SourceAggregatorService(fetchMock as typeof fetch).search({
      ...seriesRequest(),
      preferences: { ...defaultDiscoveryPreferences, sourceProvider: "comet" },
      realDebridApiToken: "rd-secret"
    });
    expect(result.sources).toHaveLength(2);
    expect(result.sources.some((source) => source.providerClaimedCached)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("rd-secret");
  });

  it("accepts Comet's filename-only season packs and 1x02 episode names", async () => {
    const fetchMock = vi.fn(async () => response({ streams: [
      { infoHash: "a".repeat(40), fileIdx: 4, name: "[TORRENT🧲] Comet 1080p",
        behaviorHints: { filename: "Show.S01.Complete.1080p", videoSize: 4 * 1024 ** 3 } },
      { infoHash: "b".repeat(40), fileIdx: 2, name: "[TORRENT🧲] Comet 1080p",
        behaviorHints: { filename: "Show.1x02.1080p", videoSize: 1024 ** 3 } },
      { infoHash: "c".repeat(40), fileIdx: 3, name: "[TORRENT🧲] Comet 1080p",
        behaviorHints: { filename: "Show.1x03.1080p", videoSize: 1024 ** 3 } }
    ] }));
    const service = new SourceAggregatorService(fetchMock as typeof fetch);
    const preferences = { ...defaultDiscoveryPreferences, sourceProvider: "comet" as const };
    const episode = await service.search({ ...seriesRequest(), preferences });
    const season = await service.search({ ...seriesRequest(), episode: undefined, preferences });
    expect(episode.sources.map((source) => source.infoHash[0])).toEqual(["a", "b"]);
    expect(season.sources.map((source) => source.infoHash[0])).toEqual(["a"]);
  });
  it("maps nonconsecutive episodes to actual file indices and excludes incomplete packs", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const first = String(input).endsWith(":1:1.json");
      return response({ streams: [
        stream("a", "Show.S01.Complete.1080p 4 GB", first ? 2 : 7),
        stream(first ? "b" : "c", "Show.S01.Complete.1080p 4 GB", 0)
      ] });
    });
    const service = new SourceAggregatorService(fetchMock as typeof fetch);
    const result = await service.search({ ...seriesRequest(), episode: undefined, episodes: [3, 1] });
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({ infoHash: "a".repeat(40), selectedFileIndices: [2, 7] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses the fixed Torrentio origin and Stremio route, filters the wrong episode and samples, and deduplicates hashes", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      expect(String(input)).toBe("https://torrentio.strem.fun/stream/series/tt1234567:1:2.json");
      return response({
        streams: [
          stream("a", "Show.S01E02.1080p.HEVC 4 GB 👤 40", 2),
          stream("a", "Show.S01E02.1080p.HEVC.HDR10 4 GB 👤 40", 2),
          stream("b", "Show.S01E03.1080p 3 GB 👤 50", 3),
          stream("c", "Show.S01E02.Sample.1080p 100 MB 👤 2", 4)
        ]
      });
    });
    const service = new SourceAggregatorService(fetchMock as typeof fetch);

    const result = await service.search(seriesRequest());

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      infoHash: "a".repeat(40),
      fileIndex: 2,
      hdr: "HDR10",
      cacheStatus: "unknown"
    });
  });

  it("uses Torrentio's server-side Real-Debrid configuration and returns only normalized source data", async () => {
    const infoHash = "9".repeat(40);
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      expect(String(input)).toBe(
        "https://torrentio.strem.fun/sort=qualitysize|realdebrid=rd-secret/stream/series/tt1234567:1:2.json"
      );
      return response({
        streams: [{
          name: "[RD+] Torrentio\n1080p",
          title: "Show.S01E02.1080p.WEB-DL 2 GB 👤 20",
          url: `https://torrentio.strem.fun/realdebrid=rd-secret/${infoHash}/null/5/Show.S01E02.mkv`
        }]
      });
    });
    const service = new SourceAggregatorService(fetchMock as typeof fetch);

    const result = await service.search({
      ...seriesRequest(),
      realDebridApiToken: "rd-secret"
    });

    expect(result.sources).toMatchObject([{
      infoHash,
      fileIndex: 5,
      providerClaimedCached: true,
      cacheStatus: "provider-claimed-cached"
    }]);
    expect(JSON.stringify(result)).not.toContain("rd-secret");
    expect(result.sources[0]).not.toHaveProperty("url");
  });

  it("queries a representative episode and returns only packs containing the selected season", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      expect(String(input)).toBe("https://torrentio.strem.fun/stream/series/tt1234567:1:1.json");
      return response({
        streams: [
          stream("7", "Show.S01.Complete.1080p 12 GB 👤 30", 0),
          stream("8", "Show.S01E01.1080p 1 GB 👤 40", 1),
          stream("9", "Show.S02.Complete.1080p 13 GB 👤 20", 0)
        ]
      });
    });
    const service = new SourceAggregatorService(fetchMock as typeof fetch);

    const result = await service.search({ ...seriesRequest(), episode: undefined });

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      infoHash: "7".repeat(40),
      isSeasonPack: true
    });
  });

  it("isolates a failing provider while returning healthy results", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) =>
      String(input).includes("broken.example")
        ? new Response("failure", { status: 503 })
        : response({ streams: [stream("d", "Show.S01E02.720p 1 GB 👤 8", 1)] })
    );
    const result = await new SourceAggregatorService(fetchMock as typeof fetch, [
      { name: "Broken", baseUrl: "https://broken.example" },
      { name: "Healthy", baseUrl: "https://healthy.example" }
    ]).search(seriesRequest());

    expect(result.sources).toHaveLength(1);
    expect(result.providerErrors).toEqual([{ provider: "Broken", message: "HTTP 503" }]);
  });

  it("rejects source searches without a safe IMDb/episode identity", async () => {
    const request = seriesRequest();
    request.media.imdbId = undefined;
    await expect(new SourceAggregatorService().search(request)).rejects.toThrow(/IMDb/i);
  });

  it("bounds provider response size before parsing", async () => {
    const service = new SourceAggregatorService(
      vi.fn(async () => new Response("{}", {
        status: 200,
        headers: { "content-length": String(6 * 1024 * 1024) }
      })) as typeof fetch
    );
    const result = await service.search(seriesRequest());
    expect(result.sources).toEqual([]);
    expect(result.providerErrors[0].message).toMatch(/size limit/i);
  });

  it("caches successful parsed provider results briefly and returns defensive copies", async () => {
    const fetchMock = vi.fn(async () =>
      response({ streams: [stream("e", "Show.S01E02.1080p 2 GB 👤 12", 4)] })
    );
    const service = new SourceAggregatorService(fetchMock as typeof fetch);

    const first = await service.search(seriesRequest());
    first.sources[0].name = "mutated";
    first.sources[0].trackers.push("tracker:udp://untrusted.example:80");
    first.sources[0].advertisedSubtitleLanguages = ["ENG"];
    const second = await service.search(seriesRequest());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.sources[0].name).toBe("Show.S01E02.1080p 2 GB 👤 12");
    expect(second.sources[0].trackers).toEqual(["tracker:udp://tracker.example:80/announce"]);
    expect(second.sources).not.toBe(first.sources);
  });

  it("expires cached source results after five minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    try {
      const fetchMock = vi.fn(async () =>
        response({ streams: [stream("f", "Show.S01E02.1080p 2 GB 👤 12", 4)] })
      );
      const service = new SourceAggregatorService(fetchMock as typeof fetch);

      await service.search(seriesRequest());
      vi.advanceTimersByTime(5 * 60 * 1_000 + 1);
      await service.search(seriesRequest());

      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds the source cache to one hundred routes", async () => {
    const fetchMock = vi.fn(async () =>
      response({ streams: [stream("f", "Movie.1080p 2 GB 👤 12", 0)] })
    );
    const service = new SourceAggregatorService(fetchMock as typeof fetch);
    const requests = Array.from({ length: 101 }, (_, index) => movieRequest(index + 1));

    for (const request of requests) {
      await service.search(request);
    }
    await service.search(requests[0]);
    await service.search(requests.at(-1)!);

    expect(fetchMock).toHaveBeenCalledTimes(102);
  });

  it("does not cache an empty response so retry performs a fresh search", async () => {
    const fetchMock = vi.fn(async () => response({ streams: [] }));
    const service = new SourceAggregatorService(fetchMock as typeof fetch);

    await service.search(seriesRequest());
    await service.search(seriesRequest());

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps preferences out of the renderer-facing source request", () => {
    const request: SourceSearchRequest = {
      media: seriesDetails(),
      season: 1,
      episode: 2
    };

    expect(request).not.toHaveProperty("preferences");
    expect(request).not.toHaveProperty("realDebridApiToken");
  });
});

function seriesRequest(): SourceAggregationRequest {
  return {
    media: seriesDetails(),
    season: 1,
    episode: 2,
    preferences: { ...defaultDiscoveryPreferences, maxSizeGb: 30 }
  };
}

function movieRequest(id: number): SourceAggregationRequest {
  const imdbId = `tt${String(id).padStart(7, "0")}`;
  return {
    media: {
      ...seriesDetails(),
      id: imdbId,
      imdbId,
      mediaType: "movie",
      seasons: []
    },
    preferences: { ...defaultDiscoveryPreferences }
  };
}

function seriesDetails(): CatalogDetails {
  return {
    id: "tt1234567",
    mediaType: "series",
    title: "Show",
    overview: "",
    genreIds: [18],
    voteAverage: 8,
    voteCount: 1_000,
    popularity: 50,
    imdbId: "tt1234567",
    genres: [{ id: 18, name: "Drama" }],
    cast: [],
    crew: [],
    videos: [],
    seasons: [{ seasonNumber: 1, name: "Season 1", episodeCount: 10 }],
    recommendations: []
  };
}

function stream(hashCharacter: string, title: string, fileIdx: number) {
  return {
    infoHash: hashCharacter.repeat(40),
    fileIdx,
    title,
    sources: ["tracker:udp://tracker.example:80/announce"]
  };
}

function response(value: unknown): Response {
  const text = JSON.stringify(value);
  return new Response(text, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "content-length": String(new TextEncoder().encode(text).byteLength)
    }
  });
}
