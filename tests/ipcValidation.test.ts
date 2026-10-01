import { describe, expect, it } from "vitest";
import {
  expectArray,
  expectCatalogItem,
  expectDeleteDownloadedFileRequest,
  expectDownloadRequest,
  expectInteger,
  expectMediaTransformRequest,
  expectOneOf,
  expectOptionalPath,
  expectOtherDebridProvider,
  expectPath,
  expectStreamingCatalogueRequest,
  expectStreamingItems,
  expectString,
  expectTorrentSource,
  expectTranslationJobRequest,
  IpcInputError
} from "../src/main/ipcValidation";

const details = {
  id: "tt1254207",
  mediaType: "movie",
  title: "Big Buck Bunny",
  overview: "",
  genreIds: [16],
  voteAverage: 7,
  voteCount: 10,
  popularity: 1,
  imdbId: "tt1254207",
  genres: [],
  cast: [],
  crew: [],
  videos: [],
  seasons: [],
  recommendations: []
};
const source = {
  id: "source-1",
  provider: "torrentio",
  infoHash: "0123456789abcdef0123456789abcdef01234567",
  name: "Big.Buck.Bunny.1080p",
  trackers: ["udp://tracker.example:1337"],
  observedAt: "2026-01-01T00:00:00.000Z",
  providerClaimedCached: false,
  cacheStatus: "unknown"
};
const subtitleTrack = {
  index: 2,
  codecName: "subrip",
  codecType: "subtitle",
  language: "eng",
  title: "",
  isSupported: true,
  isTextBased: true,
  isImageBased: false,
  requiresOcr: false
};

describe("IPC primitive validators", () => {
  it("accepts well-formed values and returns them unchanged", () => {
    expect(expectString("hello", "greeting")).toBe("hello");
    expect(expectPath("D:\\Movies\\film.mkv", "video")).toBe("D:\\Movies\\film.mkv");
    expect(expectInteger(3, "season", { max: 10 })).toBe(3);
    expect(expectOneOf("mkv", ["mkv", "mp4"] as const, "format")).toBe("mkv");
    expect(expectArray([1, 2], "numbers", (value, label) => expectInteger(value, label))).toEqual([1, 2]);
  });

  it("rejects wrong types, empty text, and out-of-range numbers with a clear error", () => {
    expect(() => expectString(42, "search")).toThrow(IpcInputError);
    expect(() => expectString("   ", "search")).toThrow(/Invalid search/);
    expect(() => expectString("x".repeat(20), "search", { maxLength: 10 })).toThrow(/up to 10/);
    expect(() => expectInteger(1.5, "season")).toThrow(/whole number/);
    expect(() => expectInteger(-1, "season")).toThrow(/whole number/);
    expect(() => expectOneOf("avi", ["mkv", "mp4"] as const, "format")).toThrow(/one of mkv, mp4/);
    expect(() => expectArray("nope", "list", (value) => value)).toThrow(/list/);
    expect(() => expectArray([1, 2, 3], "list", (value) => value, 2)).toThrow(/at most 2/);
  });

  it("rejects paths containing NUL characters and treats empty optional paths as absent", () => {
    expect(() => expectPath("C:\\bad\0.exe", "file")).toThrow(/NUL/);
    expect(expectOptionalPath("", "folder")).toBeUndefined();
    expect(expectOptionalPath(undefined, "folder")).toBeUndefined();
  });
});

describe("IPC request validators", () => {
  it("only allows known debrid providers", () => {
    expect(expectOtherDebridProvider("torbox")).toBe("torbox");
    expect(() => expectOtherDebridProvider("real-debrid")).toThrow(/debrid provider/);
  });

  it("checks catalog items and streaming lookups", () => {
    expect(expectCatalogItem(details)).toBe(details);
    expect(() => expectCatalogItem({ ...details, mediaType: "podcast" })).toThrow(/media type/);
    expect(expectStreamingItems([{ id: "tt1", mediaType: "series", extra: true }])).toEqual([{ id: "tt1", mediaType: "series" }]);
    expect(() => expectStreamingItems([{ id: "", mediaType: "movie" }])).toThrow(/title list\[0\] id/);
  });

  it("normalizes a streaming catalogue request", () => {
    expect(expectStreamingCatalogueRequest({
      streamingServices: ["netflix"],
      mediaType: "all",
      genreIds: [],
      query: "",
      skip: 0
    })).toEqual({
      streamingServices: ["netflix"],
      mediaType: "all",
      genreIds: [],
      minimumRating: 0,
      query: "",
      skip: 0,
      showAll: undefined
    });
  });

  it("requires a valid BitTorrent info hash on torrent sources", () => {
    expect(expectTorrentSource(source)).toBe(source);
    expect(() => expectTorrentSource({ ...source, infoHash: "not-a-hash" })).toThrow(/info hash/);
  });

  it("validates download requests including episode lists", () => {
    const request = expectDownloadRequest({ source, media: details, episodes: [1, 2], destinationLocationId: "default" });
    expect(request.episodes).toEqual([1, 2]);
    expect(() => expectDownloadRequest({ source, media: details, episodes: [1, "two"] })).toThrow(/episodes\[1\]/);
    expect(() => expectDownloadRequest({ source, media: details, season: -1 })).toThrow(/season/);
  });

  it("validates media and translation job requests", () => {
    expect(expectMediaTransformRequest({
      videoPath: "D:\\film.mkv",
      audioProfileId: "copy",
      outputConflictMode: "versioned",
      outputContainerId: "mp4",
      audioGainDb: 1.5
    })).toMatchObject({ videoPath: "D:\\film.mkv", outputContainerId: "mp4", audioGainDb: 1.5 });
    expect(() => expectMediaTransformRequest({
      videoPath: "D:\\film.mkv",
      audioProfileId: "copy",
      outputConflictMode: "replace-everything"
    })).toThrow(/existing-file handling/);
    expect(() => expectMediaTransformRequest({
      videoPath: "D:\\film.mkv",
      audioProfileId: "copy",
      outputConflictMode: "versioned",
      audioGainDb: Number.NaN
    })).toThrow(/volume adjustment/);

    expect(expectTranslationJobRequest({
      videoPath: "D:\\film.mkv",
      track: subtitleTrack,
      settings: { providerId: "gemini" },
      sampleMode: "none"
    }).track).toBe(subtitleTrack);
    expect(() => expectTranslationJobRequest({
      videoPath: "D:\\film.mkv",
      track: { ...subtitleTrack, index: "2" },
      settings: {},
      sampleMode: "none"
    })).toThrow(/subtitle track index/);
  });

  it("requires every field of a downloaded file selection", () => {
    expect(expectDeleteDownloadedFileRequest({ libraryLocationId: "default", titleKey: "movie:tt1", fileId: "f1" }))
      .toEqual({ libraryLocationId: "default", titleKey: "movie:tt1", fileId: "f1" });
    expect(() => expectDeleteDownloadedFileRequest(null)).toThrow(/downloaded file selection/);
    expect(() => expectDeleteDownloadedFileRequest({ libraryLocationId: "default", titleKey: "movie:tt1" })).toThrow(/file id/);
  });
});
