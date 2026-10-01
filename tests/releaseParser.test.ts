import { describe, expect, it } from "vitest";
import { parseStremioStream, rankTorrentSources } from "../src/core/discovery/ReleaseParser";
import type { TorrentSource } from "../src/core/discovery/DiscoveryTypes";

describe("Stremio release parsing", () => {
  it("uses the advertised video filename when Comet or MediaFusion omits a release title", () => {
    const parsed = parseStremioStream({
      name: "MediaFusion | Midnight 🧲",
      description: "📺 BluRay 1080p",
      infoHash: "a".repeat(40),
      fileIdx: 3,
      behaviorHints: { filename: "Show.S01E02.1080p.mkv" }
    }, "MediaFusion", "2026-09-25T00:00:00Z");
    expect(parsed).toMatchObject({ name: "Show.S01E02.1080p.mkv", fileIndex: 3 });
  });
  it("extracts useful release fields and preserves a provider cache label", () => {
    const parsed = parseStremioStream({
      infoHash: "1".repeat(40),
      fileIdx: 4,
      name: "RD+ 1080p",
      title: "Film.2026.1080p.HEVC.HDR10.DTS-GROUP 💾 2.5 GB 👤 123",
      sources: ["tracker:udp://tracker.example:80/announce"]
    }, "authorized.example", "2026-07-17T00:00:00.000Z");

    expect(parsed).toMatchObject({
      infoHash: "1".repeat(40),
      fileIndex: 4,
      quality: "1080p",
      codec: "HEVC",
      hdr: "HDR10",
      audio: "DTS",
      seeders: 123,
      providerClaimedCached: true,
      cacheStatus: "provider-claimed-cached"
    });
    expect(parsed?.sizeBytes).toBe(Math.round(2.5 * 1024 ** 3));
  });

  it("recovers the hash and file index from a credential-bearing Torrentio RD+ route without retaining the route", () => {
    const infoHash = "a".repeat(40);
    const parsed = parseStremioStream({
      name: "[RD+] Torrentio\n1080p",
      title: "Film.2026.1080p.WEB-DL 💾 2 GB 👤 20",
      url: `https://torrentio.strem.fun/sort=qualitysize|realdebrid=super-secret/${infoHash}/null/7/Film.mkv`
    }, "Torrentio", "2026-07-19T00:00:00.000Z");

    expect(parsed).toMatchObject({
      infoHash,
      fileIndex: 7,
      providerClaimedCached: true,
      cacheStatus: "provider-claimed-cached"
    });
    expect(JSON.stringify(parsed)).not.toContain("super-secret");
    expect(parsed).not.toHaveProperty("url");
  });

  it("does not mislabel Torrentio RD download rows as cached", () => {
    const infoHash = "b".repeat(40);
    const parsed = parseStremioStream({
      name: "[RD download] Torrentio\n1080p",
      title: "Film.2026.1080p.WEB-DL 💾 2 GB 👤 20",
      url: `https://torrentio.strem.fun/realdebrid=super-secret/${infoHash}/null/0/Film.mkv`
    }, "Torrentio", "2026-07-19T00:00:00.000Z");

    expect(parsed).toMatchObject({
      infoHash,
      fileIndex: 0,
      providerClaimedCached: false,
      cacheStatus: "unknown"
    });
  });

  it("extracts Torrentio audio-language flags and treats its omitted English-only line as English", () => {
    const multilingual = parseStremioStream({
      infoHash: "6".repeat(40),
      title: "Film.2026.2160p.WEB-DL\n👤 20 💾 8 GB ⚙️ Provider\n🇬🇧 / 🇮🇹 / 🇫🇷"
    }, "Torrentio", "2026-07-25T00:00:00.000Z");
    const englishOnly = parseStremioStream({
      infoHash: "7".repeat(40),
      title: "Film.2026.2160p.WEB-DL\n👤 20 💾 8 GB ⚙️ Provider"
    }, "Torrentio", "2026-07-25T00:00:00.000Z");
    const unknownProvider = parseStremioStream({
      infoHash: "8".repeat(40),
      title: "Film.2026.2160p.WEB-DL"
    }, "Other provider", "2026-07-25T00:00:00.000Z");

    expect(multilingual?.audioLanguages).toEqual(["English", "Italian", "French"]);
    expect(englishOnly?.audioLanguages).toEqual(["English"]);
    expect(unknownProvider?.audioLanguages).toBeUndefined();
  });

  it("marks subtitles advertised by structured stream metadata or the release filename", () => {
    const structured = parseStremioStream({
      infoHash: "c".repeat(40),
      title: "Film.2026.1080p.WEB-DL",
      subtitles: [{ lang: "eng" }, { lang: "bul" }]
    }, "Torrentio", "2026-07-21T00:00:00.000Z");
    const releaseNamed = parseStremioStream({
      infoHash: "d".repeat(40),
      title: "Film.2026.1080p.WEB-DL",
      behaviorHints: { filename: "Film.2026.1080p.MULTiSUBS.mkv" }
    }, "Torrentio", "2026-07-21T00:00:00.000Z");
    const unknown = parseStremioStream({
      infoHash: "e".repeat(40),
      title: "Film.2026.1080p.WEB-DL"
    }, "Torrentio", "2026-07-21T00:00:00.000Z");

    expect(structured?.advertisedSubtitleLanguages).toEqual(["ENG", "BUL"]);
    expect(releaseNamed?.advertisedSubtitleLanguages).toEqual([]);
    expect(unknown?.advertisedSubtitleLanguages).toBeUndefined();
  });

  it("distinguishes season packs from individual episode releases", () => {
    const pack = parseStremioStream({
      infoHash: "f".repeat(40),
      title: "Show.S02.Complete.1080p.WEB-DL\nShow.S02E01.mkv"
    }, "Torrentio", "2026-07-21T00:00:00.000Z");
    const folderPack = parseStremioStream({
      infoHash: "1".repeat(40),
      title: "Show Collection\n/Season 2/Show.S02E01.mkv"
    }, "Torrentio", "2026-07-21T00:00:00.000Z");
    const episode = parseStremioStream({
      infoHash: "2".repeat(40),
      title: "Show.S02E01.1080p.WEB-DL"
    }, "Torrentio", "2026-07-21T00:00:00.000Z");

    expect(pack?.isSeasonPack).toBe(true);
    expect(folderPack?.isSeasonPack).toBe(true);
    expect(episode?.isSeasonPack).toBeUndefined();
  });

  it("filters size and seeder preferences before ranking", () => {
    const sources = [
      source("1", 5, 5),
      source("2", 20, 100),
      source("3", 2, 50)
    ];
    expect(rankTorrentSources(sources, {
      preferredQuality: "1080p",
      maxSizeGb: 10,
      minSeeders: 10
    }).map(({ id }) => id)).toEqual(["3"]);
  });

  it("orders by resolution, then descending size, before cache or seeder counts", () => {
    const sources = [
      { ...source("720", 20, 999), quality: "720p", cacheStatus: "verified-account-cached" as const },
      { ...source("1080-small", 2, 10), quality: "1080p" },
      { ...source("2160", 1, 1), quality: "2160p" },
      { ...source("unknown", 30, 999), quality: undefined },
      { ...source("1080-large", 5, 1), quality: "1080p" },
      { ...source("4320", 1, 1), quality: "4320p" },
      { ...source("1080-no-size", 0, 999), quality: "1080p", sizeBytes: undefined }
    ];
    expect(rankTorrentSources(sources, {
      preferredQuality: "720p", maxSizeGb: 0, minSeeders: 0
    }).map(({ id }) => id)).toEqual([
      "4320", "2160", "1080-large", "1080-small", "1080-no-size", "720", "unknown"
    ]);
  });

  it("recognizes 8K, 4K, and intermediate resolutions", () => {
    const qualities = ["8K", "4K", "1440p", "1080p", "720p"];
    expect(qualities.map((quality, index) => parseStremioStream({
      infoHash: String(index + 1).repeat(40),
      title: `Film.2026.${quality}.WEB-DL`
    }, "Comet", "2026-09-26T00:00:00.000Z")?.quality)).toEqual([
      "4320p", "2160p", "1440p", "1080p", "720p"
    ]);
  });

  it("uses Comet's exact videoSize and recognizes a filename-only season pack", () => {
    const parsed = parseStremioStream({
      infoHash: "a".repeat(40),
      name: "[TORRENT🧲] Comet 1080p",
      description: "📄 Show.S01.Complete.1080p 💾 1.2 GB",
      behaviorHints: { filename: "Show.S01.Complete.1080p", videoSize: 2_345_678_901 }
    }, "Comet", "2026-09-26T00:00:00.000Z");
    expect(parsed).toMatchObject({
      name: "Show.S01.Complete.1080p",
      sizeBytes: 2_345_678_901,
      isSeasonPack: true
    });
  });
});

function source(id: string, sizeGb: number, seeders: number): TorrentSource {
  return {
    id,
    provider: "test",
    infoHash: id.padStart(40, "0"),
    name: id,
    sizeBytes: sizeGb * 1024 ** 3,
    seeders,
    quality: "1080p",
    trackers: [],
    observedAt: "2026-07-17T00:00:00.000Z",
    providerClaimedCached: false,
    cacheStatus: "unknown"
  };
}
