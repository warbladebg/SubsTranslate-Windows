import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CatalogDetails } from "../src/core/discovery/DiscoveryTypes";
import { DownloadedLibraryService, isDownloadedLibraryFile } from "../src/main/downloadedLibraryService";

describe("downloaded library service", () => {
  it("preserves concurrent completed downloads and serializes rescans with index updates", async () => {
    const root = await mkdtemp(join(tmpdir(), "substranslate-library-concurrent-"));
    const service = new DownloadedLibraryService();
    const show = media("series", "tt3333333", "Concurrent Show", "2026-01-01");
    const plans = await Promise.all([1, 2, 3, 4].map((episode) =>
      service.planDownload(root, show, `Show.S01E0${episode}.mkv`, 1, episode)));
    await Promise.all(plans.map((plan) => writeFile(plan.outputPath, "episode")));
    await Promise.all([
      ...plans.map((plan) => service.recordCompletedDownload(root, show, plan)),
      service.rescan(root)
    ]);
    const snapshot = await service.getLibrary(root);
    expect(snapshot.titles).toHaveLength(1);
    expect(snapshot.titles[0].files.map((file) => file.episode)).toEqual([1, 2, 3, 4]);
    const stored = JSON.parse(await readFile(join(root, ".substranslate", "library.json"), "utf8"));
    expect(stored.titles[0].files).toHaveLength(4);
  });

  it("removes vanished files without treating directories as video files", async () => {
    const root = await mkdtemp(join(tmpdir(), "substranslate-library-stale-"));
    const service = new DownloadedLibraryService();
    const title = media("movie", "tt1234567", "Missing", "2026-01-01");
    const plan = await service.planDownload(root, title, "Missing.mkv");
    await mkdir(plan.outputPath);
    await service.recordCompletedDownload(root, title, plan);
    expect((await service.getLibrary(root)).titles).toEqual([]);
    const stored = JSON.parse(await readFile(join(root, ".substranslate", "library.json"), "utf8"));
    expect(stored.titles).toEqual([]);
  });
  it("plans deterministic movie and episode folders and indexes completed files", async () => {
    const root = await mkdtemp(join(tmpdir(), "substranslate-library-"));
    const service = new DownloadedLibraryService();
    const movie = media("movie", "tt1234567", "A Movie: The Test", "2026-02-03");
    const series = media("series", "tt7654321", "A Show", "2024-09-10");

    const moviePlan = await service.planDownload(root, movie, "release.1080p.mkv");
    expect(moviePlan.outputPath).toBe(join(
      root,
      "Movies",
      "A Movie The Test (2026) [tt1234567]",
      "release.1080p.mkv"
    ));
    await writeFile(moviePlan.outputPath, "movie");
    await service.recordCompletedDownload(root, movie, moviePlan);

    const episodePlan = await service.planDownload(root, series, "A.Show.S02E03.WEB-DL.mkv", 2, 3);
    expect(episodePlan.outputPath).toBe(join(
      root,
      "TV Shows",
      "A Show (2024) [tt7654321]",
      "Season 02",
      "A.Show.S02E03.WEB-DL.mkv"
    ));
    await writeFile(episodePlan.outputPath, "episode");
    await service.recordCompletedDownload(root, series, episodePlan);

    const snapshot = await service.getLibrary(root);
    expect(snapshot.titles).toHaveLength(2);
    expect(snapshot.titles.find((title) => title.mediaType === "series")?.files[0]).toMatchObject({
      season: 2,
      episode: 3,
      processedDirectoryPath: join(root, "TV Shows", "A Show (2024) [tt7654321]", "Processed", "Season 02")
    });
    expect(JSON.parse(await readFile(join(root, ".substranslate", "library.json"), "utf8"))).toMatchObject({
      version: 1,
      titles: expect.arrayContaining([expect.objectContaining({ key: "movie:tt1234567" })])
    });
  });

  it("versions duplicate downloads instead of overwriting them", async () => {
    const root = await mkdtemp(join(tmpdir(), "substranslate-library-version-"));
    const service = new DownloadedLibraryService();
    const title = media("movie", "tt1111111", "Duplicate", "2025-01-01");
    const first = await service.planDownload(root, title, "Duplicate.mkv");
    await writeFile(first.outputPath, "first");

    const second = await service.planDownload(root, title, "Duplicate.mkv");
    expect(second.filename).toBe("Duplicate (2).mkv");
  });

  it("rebuilds its index from the managed folder structure and ignores processed output", async () => {
    const root = await mkdtemp(join(tmpdir(), "substranslate-library-rescan-"));
    const service = new DownloadedLibraryService();
    const title = media("series", "tt2222222", "Recovered Show", "2022-01-01");
    const plan = await service.planDownload(root, title, "Recovered.Show.S01E04.mkv", 1, 4);
    await writeFile(plan.outputPath, "source");
    const processedPath = join(dirname(dirname(plan.outputPath)), "Processed", "Season 01", "processed.mkv");
    await writeFileAfterCreating(service, root, processedPath);

    const snapshot = await service.rescan(root);
    expect(snapshot.titles).toHaveLength(1);
    expect(snapshot.titles[0]).toMatchObject({
      title: "Recovered Show",
      imdbId: "tt2222222",
      files: [expect.objectContaining({ season: 1, episode: 4 })]
    });
  });

  it("imports external movie and TV folders on rescan and keeps their file identities", async () => {
    const root = await mkdtemp(join(tmpdir(), "substranslate-library-import-"));
    const service = new DownloadedLibraryService();
    const movieDirectory = join(root, "Movies", "Example.Movie.2024.1080p", "Release");
    const showDirectory = join(root, "TV Shows", "Example_Show");
    const seasonDirectory = join(showDirectory, "S02", "Release");
    await mkdir(movieDirectory, { recursive: true });
    await mkdir(seasonDirectory, { recursive: true });
    await writeFile(join(movieDirectory, "Example.Movie.2024.mkv"), "movie");
    await writeFile(join(showDirectory, "Example.Show.S01E02.mp4"), "episode");
    await writeFile(join(seasonDirectory, "Episode 03.mkv"), "episode");
    await writeFile(join(showDirectory, "bonus.mkv"), "bonus");
    await mkdir(join(showDirectory, "Processed", "Season 02"), { recursive: true });
    await writeFile(join(showDirectory, "Processed", "Season 02", "output.mkv"), "processed");

    expect((await service.getLibrary(root)).titles).toHaveLength(0);
    const imported = await service.rescan(root);
    expect(imported.titles).toHaveLength(2);
    expect(imported.titles.find((title) => title.mediaType === "movie")).toMatchObject({
      title: "Example Movie",
      releaseDate: "2024-01-01",
      files: [expect.objectContaining({ filename: "Example.Movie.2024.mkv" })]
    });
    const show = imported.titles.find((title) => title.mediaType === "series")!;
    expect(show.title).toBe("Example Show");
    expect(show.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ filename: "Example.Show.S01E02.mp4", season: 1, episode: 2 }),
      expect.objectContaining({ filename: "Episode 03.mkv", season: 2, episode: 3 }),
      expect.objectContaining({ filename: "bonus.mkv", season: undefined, episode: undefined })
    ]));
    expect(show.files).toHaveLength(3);
    const rescanned = await service.rescan(root);
    expect(rescanned.titles.find((title) => title.mediaType === "series")?.files.map((file) => file.id))
      .toEqual(show.files.map((file) => file.id));
  });

  it("moves only the selected managed file to trash and removes it from the index", async () => {
    const root = await mkdtemp(join(tmpdir(), "substranslate-library-delete-"));
    const service = new DownloadedLibraryService();
    const show = media("series", "tt3333333", "Delete Show", "2026-01-01");
    const first = await service.planDownload(root, show, "Delete.Show.S01E01.mkv", 1, 1);
    await writeFile(first.outputPath, "episode one");
    await service.recordCompletedDownload(root, show, first);
    const second = await service.planDownload(root, show, "Delete.Show.S01E02.mkv", 1, 2);
    await writeFile(second.outputPath, "episode two");
    await service.recordCompletedDownload(root, show, second);
    const before = await service.getLibrary(root);
    const firstFile = before.titles[0].files.find((file) => file.episode === 1)!;
    const trashed: string[] = [];

    await service.deleteFile(root, before.titles[0].key, firstFile.id, async (path) => {
      trashed.push(path);
      await rm(path);
    });

    expect(trashed).toEqual([first.outputPath]);
    await expect(access(first.outputPath)).rejects.toThrow();
    expect(await access(second.outputPath)).toBeUndefined();
    expect((await service.getLibrary(root)).titles[0].files).toEqual([
      expect.objectContaining({ episode: 2 })
    ]);
  });

  it("recognizes only tracked library files as openable paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "substranslate-library-open-"));
    const service = new DownloadedLibraryService();
    const movie = media("movie", "tt4444444", "Open Movie", "2026-01-01");
    const plan = await service.planDownload(root, movie, "Open.Movie.mkv");
    await writeFile(plan.outputPath, "movie");
    await service.recordCompletedDownload(root, movie, plan);
    const { titles } = await service.getLibrary(root);

    expect(isDownloadedLibraryFile(titles, plan.outputPath)).toBe(true);
    expect(isDownloadedLibraryFile(titles, plan.outputPath.toUpperCase())).toBe(true);
    expect(isDownloadedLibraryFile(titles, join(dirname(plan.outputPath), "setup.exe"))).toBe(false);
    expect(isDownloadedLibraryFile(titles, "C:\\Windows\\System32\\cmd.exe")).toBe(false);
    expect(isDownloadedLibraryFile(titles, "Open.Movie.mkv")).toBe(false);
    expect(isDownloadedLibraryFile(titles, undefined)).toBe(false);
  });
});

async function writeFileAfterCreating(
  service: DownloadedLibraryService,
  root: string,
  path: string
): Promise<void> {
  await service.ensureStructure(root);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "processed");
}

function media(
  mediaType: CatalogDetails["mediaType"],
  id: string,
  title: string,
  releaseDate: string
): CatalogDetails {
  return {
    id,
    imdbId: id,
    mediaType,
    title,
    overview: "Test title",
    releaseDate,
    genreIds: [],
    genres: [],
    cast: [],
    crew: [],
    videos: [],
    seasons: [],
    recommendations: [],
    voteAverage: 8,
    voteCount: 1_000,
    popularity: 100
  };
}
