import { describe, expect, it } from "vitest";
import {
  buildDownloadedWorkflowTarget,
  type DownloadedLibraryFile,
  type DownloadedLibraryTitle
} from "../src/core/downloads/DownloadedLibrary";

function file(id: string, path: string, season?: number, episode?: number): DownloadedLibraryFile {
  return {
    id,
    path,
    filename: path.split(/[\\/]/).pop()!,
    sizeBytes: 1,
    modifiedAt: "",
    downloadedAt: "",
    season,
    episode,
    processedDirectoryPath: "D:\\Processed"
  };
}

const series: DownloadedLibraryTitle = {
  key: "series:1",
  catalogId: "1",
  mediaType: "series",
  title: "Show",
  directoryPath: "D:\\TV Shows\\Show",
  processedDirectoryPath: "D:\\Processed",
  downloadedAt: "",
  totalBytes: 3,
  files: [
    file("a", "D:\\TV Shows\\Show\\Season 01\\Show.S01E01.mkv", 1, 1),
    file("b", "D:\\TV Shows\\Show\\Season 01\\Show.S01E02.mkv", 1, 2),
    file("c", "D:\\TV Shows\\Show\\Season 01\\extras.mkv", 1)
  ]
};

describe("downloaded workflow targets", () => {
  it("targets a whole season, preferring recognised episodes", () => {
    const target = buildDownloadedWorkflowTarget(series, { scope: "season", season: 1, fileId: "" });
    expect(target?.scopeLabel).toBe("Season 1");
    expect(target?.videoPaths).toHaveLength(2);
    expect(target?.sourceDirectory).toBe("D:\\TV Shows\\Show\\Season 01");
  });

  it("uses every file of a season when none carry an episode number", () => {
    const unsorted = { ...series, files: [file("x", "D:\\TV Shows\\Show\\a.mkv"), file("y", "D:\\TV Shows\\Show\\b.mkv")] };
    const target = buildDownloadedWorkflowTarget(unsorted, { scope: "season", season: -1, fileId: "" });
    expect(target?.scopeLabel).toBe("Unsorted episodes");
    expect(target?.videoPaths).toHaveLength(2);
  });

  it("targets one episode by id and labels it", () => {
    const target = buildDownloadedWorkflowTarget(series, { scope: "episode", season: 1, fileId: "b" });
    expect(target?.scopeLabel).toBe("S01E02");
    expect(target?.videoPaths).toEqual(["D:\\TV Shows\\Show\\Season 01\\Show.S01E02.mkv"]);
    expect(buildDownloadedWorkflowTarget(series, { scope: "episode", season: 2, fileId: "b" })).toBeUndefined();
  });

  it("falls back to the first movie file", () => {
    const movie = { ...series, mediaType: "movie" as const, files: [file("m", "D:\\Movies\\Film\\Film.mkv")] };
    expect(buildDownloadedWorkflowTarget(movie, { scope: "episode", fileId: "missing" })).toMatchObject({
      scopeLabel: "Movie",
      videoPaths: ["D:\\Movies\\Film\\Film.mkv"],
      sourceDirectory: "D:\\TV Shows\\Show"
    });
  });
});
