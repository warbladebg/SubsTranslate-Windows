import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CatalogDetails, CatalogItem } from "../src/core/discovery/DiscoveryTypes";
import {
  DiscoveryStore,
  defaultDiscoveryPreferences,
  normalizePreferences
} from "../src/main/discoveryStore";
import { getDurableBackupPath } from "../src/main/durableFileStore";

describe("discovery state store", () => {
  it("persists preferences and mutually exclusive feedback", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "discovery-store-")), "state.json");
    const store = new DiscoveryStore(path);
    const savedPreferences = await store.savePreferences({
      ...defaultDiscoveryPreferences,
      preferredQuality: "2160p"
    });
    await store.recordInteraction(item, "liked", true);
    const disliked = await store.recordInteraction(item, "disliked", true);
    const restored = await new DiscoveryStore(path).getState();

    expect(savedPreferences).not.toHaveProperty("sourceAddonUrls");
    expect(disliked).toMatchObject({ liked: false, disliked: true });
    expect(restored.preferences.preferredQuality).toBe("2160p");
    expect(restored.interactions).toMatchObject([{ key: "movie:tt0000042", disliked: true }]);
  });

  it("migrates v2 preferences to v3 while silently dropping legacy source URLs", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "discovery-store-")), "state.json");
    await writeFile(path, JSON.stringify({
      version: 2,
      preferences: {
        ...defaultDiscoveryPreferences,
        preferredQuality: "720p",
        sourceAddonUrls: [
          "https://user:secret@legacy-addon.example/configure/secret"
        ]
      },
      interactions: []
    }));
    await writeFile(getDurableBackupPath(path), JSON.stringify({
      version: 2,
      preferences: {
        ...defaultDiscoveryPreferences,
        sourceAddonUrls: ["https://backup-user:backup-secret@legacy-addon.example/configure/backup-secret"]
      },
      interactions: []
    }));
    const restored = await new DiscoveryStore(path).getState();

    expect(restored.preferences).toMatchObject({ preferredQuality: "720p" });
    expect(restored.preferences).not.toHaveProperty("sourceAddonUrls");

    for (const persistedPath of [path, getDurableBackupPath(path)]) {
      const persistedText = await readFile(persistedPath, "utf8");
      const persisted = JSON.parse(persistedText) as {
        version: number;
        preferences: Record<string, unknown>;
      };
      expect(persisted.version).toBe(3);
      expect(persisted.preferences).not.toHaveProperty("sourceAddonUrls");
      expect(persistedText).not.toContain("secret");
    }
  });

  it("scrubs a legacy backup even when the primary is already v3", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "discovery-store-")), "state.json");
    await writeFile(path, JSON.stringify({
      version: 3,
      preferences: { ...defaultDiscoveryPreferences, preferredQuality: "2160p" },
      interactions: []
    }));
    await writeFile(getDurableBackupPath(path), JSON.stringify({
      version: 2,
      preferences: {
        ...defaultDiscoveryPreferences,
        sourceAddonUrls: ["https://legacy-addon.example/configure/old-secret"]
      },
      interactions: []
    }));

    const restored = await new DiscoveryStore(path).getState();

    expect(restored.preferences.preferredQuality).toBe("2160p");
    expect(await readFile(path, "utf8")).not.toContain("sourceAddonUrls");
    expect(await readFile(getDurableBackupPath(path), "utf8")).not.toContain("sourceAddonUrls");
  });

  it("scrubs malformed primary and backup files that contain legacy source credentials", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "discovery-store-")), "state.json");
    await writeFile(path, '{"sourceAddonUrls":["https://legacy.example/primary-secret"],', "utf8");
    await writeFile(
      getDurableBackupPath(path),
      '{"sourceAddonUrls":["https://legacy.example/backup-secret"],',
      "utf8"
    );

    const restored = await new DiscoveryStore(path).getState();

    expect(restored).toEqual({
      preferences: defaultDiscoveryPreferences,
      interactions: []
    });
    for (const persistedPath of [path, getDurableBackupPath(path)]) {
      const persistedText = await readFile(persistedPath, "utf8");
      expect(JSON.parse(persistedText)).toMatchObject({ version: 3, interactions: [] });
      expect(persistedText).not.toContain("secret");
      expect(persistedText).not.toContain("sourceAddonUrls");
    }
  });

  it("bounds malformed numeric preferences", () => {
    expect(normalizePreferences({
      ...defaultDiscoveryPreferences,
      maxSizeGb: -20,
      minSeeders: Number.POSITIVE_INFINITY,
      region: "bulgaria"
    })).toMatchObject({
      maxSizeGb: 0,
      minSeeders: 0,
      region: "BG"
    });
  });

  it("tracks completed episode downloads without marking a series watched until every regular episode is complete", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "discovery-store-")), "state.json");
    const store = new DiscoveryStore(path);

    const firstEpisode = await store.recordCompletedDownload(series, 1, 1);
    expect(firstEpisode).toMatchObject({
      watched: false,
      watchedEpisodes: ["s1e1"],
      knownEpisodeCount: 3,
      watchedManually: false
    });

    await store.recordCompletedDownload(series, 1, 1);
    const special = await store.recordCompletedDownload(series, 0, 1);
    expect(special.watchedEpisodes).toEqual(["s1e1"]);
    expect(special.watched).toBe(false);

    const secondEpisode = await store.recordCompletedDownload(series, 1, 2);
    expect(secondEpisode.watched).toBe(false);
    const completed = await store.recordCompletedDownload(series, 2, 1);
    expect(completed).toMatchObject({
      watched: true,
      watchedEpisodes: ["s1e1", "s1e2", "s2e1"],
      knownEpisodeCount: 3
    });

    const restored = await new DiscoveryStore(path).getState();
    expect(restored.interactions[0]).toMatchObject({ watched: true, knownEpisodeCount: 3 });

    const manuallyCleared = await store.recordInteraction(series, "watched", false);
    expect(manuallyCleared).toMatchObject({ watched: false, watchedEpisodes: [] });
    expect(manuallyCleared.knownEpisodeCount).toBeUndefined();
  });

  it("lets individual TV episodes be marked watched or unwatched", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "discovery-store-")), "state.json");
    const store = new DiscoveryStore(path);

    const first = await store.setEpisodeWatched(series, 1, 1, true);
    expect(first).toMatchObject({
      watched: false,
      watchedEpisodes: ["s1e1"],
      knownEpisodeCount: 3,
      watchedManually: false
    });

    await store.setEpisodeWatched(series, 1, 2, true);
    const complete = await store.setEpisodeWatched(series, 2, 1, true);
    expect(complete).toMatchObject({
      watched: true,
      watchedEpisodes: ["s1e1", "s1e2", "s2e1"]
    });

    const partial = await store.setEpisodeWatched(series, 1, 2, false);
    expect(partial).toMatchObject({
      watched: false,
      watchedEpisodes: ["s1e1", "s2e1"]
    });
  });

  it("expands a manually watched show before one episode is marked unwatched", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "discovery-store-")), "state.json");
    const store = new DiscoveryStore(path);
    await store.recordInteraction(series, "watched", true);

    const partial = await store.setEpisodeWatched(series, 2, 1, false);

    expect(partial).toMatchObject({
      watched: false,
      watchedManually: false,
      watchedEpisodes: ["s1e1", "s1e2"],
      knownEpisodeCount: 3
    });
    await expect(store.setEpisodeWatched(series, 9, 9, true)).rejects.toThrow(/valid TV episode/i);
  });

  it("marks a movie watched after its completed download", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "discovery-store-")), "state.json");
    const saved = await new DiscoveryStore(path).recordCompletedDownload(movieDetails);

    expect(saved).toMatchObject({
      key: "movie:tt0000042",
      watched: true,
      watchedEpisodes: [],
      watchedManually: false
    });
  });

  it("keeps preferences while dropping legacy numeric TMDB interactions", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "discovery-store-")), "state.json");
    await writeFile(path, JSON.stringify({
      version: 1,
      preferences: { ...defaultDiscoveryPreferences, preferredMediaType: "movie" },
      interactions: [{
        key: "movie:603",
        item: { ...item, id: 603 },
        liked: true,
        updatedAt: "2026-01-01T00:00:00.000Z"
      }]
    }));

    await expect(new DiscoveryStore(path).getState()).resolves.toMatchObject({
      preferences: { preferredMediaType: "movie" },
      interactions: []
    });
  });
});

const item: CatalogItem = {
  id: "tt0000042",
  mediaType: "movie",
  title: "Legal test movie",
  overview: "",
  genreIds: [99],
  voteAverage: 7,
  voteCount: 100,
  popularity: 20
};

const movieDetails: CatalogDetails = {
  ...item,
  genres: [{ id: 99, name: "Documentary" }],
  cast: [],
  crew: [],
  videos: [],
  seasons: [],
  recommendations: []
};

const series: CatalogDetails = {
  ...item,
  id: "tt0000043",
  mediaType: "series",
  title: "Legal test series",
  genres: [{ id: 99, name: "Documentary" }],
  cast: [],
  crew: [],
  videos: [],
  seasons: [
    { seasonNumber: 0, name: "Specials", episodeCount: 4 },
    { seasonNumber: 1, name: "Season 1", episodeCount: 2 },
    { seasonNumber: 2, name: "Season 2", episodeCount: 1 }
  ],
  recommendations: []
};
