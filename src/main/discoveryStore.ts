import { app } from "electron";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  CatalogDetails,
  CatalogItem,
  DiscoveryAction,
  DiscoveryInteraction,
  DiscoveryPreferences,
  DiscoveryState
} from "../core/discovery/DiscoveryTypes";
import { catalogItemKey } from "../core/discovery/DiscoveryTypes";
import { cleanText as cleanString } from "../core/util/text";
import {
  getDurableBackupPath,
  readJsonWithBackup,
  replaceJsonWithBackup,
  replaceJsonWithSanitizedBackup
} from "./durableFileStore";

interface StoredDiscoveryState {
  version: 3;
  preferences: DiscoveryPreferences;
  interactions: DiscoveryInteraction[];
}

const DISCOVERY_STORE_VERSION = 3;
const MAX_STORED_INTERACTIONS = 2_000;
const LEGACY_SOURCE_URLS_KEY = "sourceAddonUrls";

export const defaultDiscoveryPreferences: DiscoveryPreferences = {
  language: "en-US",
  region: "BG",
  preferredMediaType: "all",
  preferredQuality: "1080p",
  maxSizeGb: 0,
  minSeeders: 0,
  sourceProvider: "torrentio",
  debridProvider: "real-debrid"
};

export class DiscoveryStore {
  private readonly storePath: string;
  private migrationPromise?: Promise<void>;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(storePath = join(app.getPath("userData"), "discovery-state.json")) {
    this.storePath = storePath;
  }

  async getState(): Promise<DiscoveryState> {
    const state = await readJsonWithBackup(this.storePath, normalizeStoredState) ?? {
      version: DISCOVERY_STORE_VERSION,
      preferences: { ...defaultDiscoveryPreferences },
      interactions: []
    } satisfies StoredDiscoveryState;
    this.migrationPromise ??= this.scrubLegacyStoredState(state);
    await this.migrationPromise;
    return {
      preferences: state.preferences,
      interactions: state.interactions
    };
  }

  async savePreferences(preferences: DiscoveryPreferences): Promise<DiscoveryPreferences> {
    const normalized = normalizePreferences(preferences);
    await this.enqueue(async () => {
      const current = await this.getState();
      await this.writeState(normalized, current.interactions);
    });
    return normalized;
  }

  async recordInteraction(
    item: CatalogItem,
    action: DiscoveryAction,
    active: boolean
  ): Promise<DiscoveryInteraction> {
    return this.updateInteraction(normalizeCatalogItem(item), (existing) => {
      const saved = { ...withDefaults(existing), [action]: active };
      if (action === "liked" && active) {
        saved.disliked = false;
      }
      if (action === "disliked" && active) {
        saved.liked = false;
      }
      if (action === "watched") {
        saved.watchedManually = active;
        if (!active) {
          saved.watchedEpisodes = [];
          saved.knownEpisodeCount = undefined;
        }
      }
      return saved;
    });
  }

  async recordCompletedDownload(
    media: CatalogDetails,
    season?: number,
    episode?: number
  ): Promise<DiscoveryInteraction> {
    const normalizedItem = normalizeCatalogItem(media);
    return this.updateInteraction(normalizedItem, (existing) => {
      const watchedEpisodes = new Set(existing?.watchedEpisodes ?? []);
      let watched = true;
      let knownEpisodeCount: number | undefined;

      if (normalizedItem.mediaType === "series") {
        const knownEpisodeKeys = knownSeriesEpisodeKeys(media);
        const episodeKey = toEpisodeKey(season, episode);
        if (episodeKey && knownEpisodeKeys.has(episodeKey)) {
          watchedEpisodes.add(episodeKey);
        }
        knownEpisodeCount = knownEpisodeKeys.size || existing?.knownEpisodeCount;
        watched = existing?.watchedManually === true
          || (knownEpisodeKeys.size > 0 && [...knownEpisodeKeys].every((episodeId) => watchedEpisodes.has(episodeId)))
          || (knownEpisodeKeys.size === 0 && existing?.watched === true);
      } else {
        watchedEpisodes.clear();
      }

      return {
        ...withDefaults(existing),
        watched,
        watchedEpisodes: [...watchedEpisodes].sort(compareEpisodeKeys),
        knownEpisodeCount
      };
    });
  }

  async setEpisodeWatched(
    media: CatalogDetails,
    season: number,
    episode: number,
    active: boolean
  ): Promise<DiscoveryInteraction> {
    const normalizedItem = normalizeCatalogItem(media);
    const knownEpisodeKeys = knownSeriesEpisodeKeys(media);
    const selectedEpisodeKey = toEpisodeKey(season, episode);
    if (
      normalizedItem.mediaType !== "series"
      || !selectedEpisodeKey
      || !knownEpisodeKeys.has(selectedEpisodeKey)
      || typeof active !== "boolean"
    ) {
      throw new Error("Select a valid TV episode.");
    }

    return this.updateInteraction(normalizedItem, (existing) => {
      const watchedEpisodes = new Set(existing?.watchedEpisodes ?? []);
      if (existing?.watchedManually) {
        knownEpisodeKeys.forEach((episodeKey) => watchedEpisodes.add(episodeKey));
      }
      if (active) {
        watchedEpisodes.add(selectedEpisodeKey);
      } else {
        watchedEpisodes.delete(selectedEpisodeKey);
      }

      return {
        ...withDefaults(existing),
        watched: [...knownEpisodeKeys].every((episodeKey) => watchedEpisodes.has(episodeKey)),
        watchedEpisodes: [...watchedEpisodes]
          .filter((episodeKey) => knownEpisodeKeys.has(episodeKey))
          .sort(compareEpisodeKeys),
        knownEpisodeCount: knownEpisodeKeys.size,
        watchedManually: false
      };
    });
  }

  async clearInteractions(): Promise<void> {
    await this.enqueue(async () => {
      const current = await this.getState();
      await this.writeState(current.preferences, []);
    });
  }

  /**
   * Replaces one title's interaction inside the write queue. `build` receives the stored
   * entry (if any) and returns the replacement, which moves to the front of the list.
   */
  private updateInteraction(
    item: CatalogItem,
    build: (existing: DiscoveryInteraction | undefined) => Omit<DiscoveryInteraction, "key" | "item" | "updatedAt">
  ): Promise<DiscoveryInteraction> {
    return this.enqueue(async () => {
      const current = await this.getState();
      const key = catalogItemKey(item);
      const existing = current.interactions.find((interaction) => interaction.key === key);
      const saved: DiscoveryInteraction = { ...build(existing), key, item, updatedAt: new Date().toISOString() };
      const interactions = [
        saved,
        ...current.interactions.filter((interaction) => interaction.key !== key)
      ].slice(0, MAX_STORED_INTERACTIONS);
      await this.writeState(current.preferences, interactions);
      return saved;
    });
  }

  private writeState(preferences: DiscoveryPreferences, interactions: DiscoveryInteraction[]): Promise<void> {
    return replaceJsonWithBackup(this.storePath, {
      version: DISCOVERY_STORE_VERSION,
      preferences,
      interactions
    } satisfies StoredDiscoveryState);
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const queued = this.writeQueue.then(operation, operation);
    this.writeQueue = queued.then(() => undefined, () => undefined);
    return queued;
  }

  private async scrubLegacyStoredState(state: StoredDiscoveryState): Promise<void> {
    if (!await discoveryStateNeedsSanitizedMigration(this.storePath)) {
      return;
    }
    await replaceJsonWithSanitizedBackup(this.storePath, {
      version: DISCOVERY_STORE_VERSION,
      preferences: state.preferences,
      interactions: state.interactions
    } satisfies StoredDiscoveryState);
  }
}

export function normalizePreferences(value: Partial<DiscoveryPreferences>): DiscoveryPreferences {
  const mediaTypes = new Set(["all", "movie", "series"]);
  const qualities = new Set(["any", "2160p", "1080p", "720p"]);
  const language = typeof value.language === "string" && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(value.language)
    ? value.language
    : defaultDiscoveryPreferences.language;
  const region = typeof value.region === "string" && /^[A-Z]{2}$/.test(value.region)
    ? value.region
    : defaultDiscoveryPreferences.region;
  const maxSizeGb = finiteInRange(value.maxSizeGb, 0, 1_000, defaultDiscoveryPreferences.maxSizeGb);
  const minSeeders = Math.round(finiteInRange(value.minSeeders, 0, 1_000_000, defaultDiscoveryPreferences.minSeeders));
  const sourceProvider = (["torrentio", "comet", "mediafusion"] as const).includes(value.sourceProvider as "torrentio")
    ? value.sourceProvider as DiscoveryPreferences["sourceProvider"]
    : defaultDiscoveryPreferences.sourceProvider;
  const debridProvider = (["real-debrid", "all-debrid", "premiumize", "torbox", "debrid-link"] as const)
    .includes(value.debridProvider as "real-debrid")
    ? value.debridProvider as DiscoveryPreferences["debridProvider"]
    : defaultDiscoveryPreferences.debridProvider;
  const defaultDownloadDirectory = typeof value.defaultDownloadDirectory === "string" && value.defaultDownloadDirectory.trim()
    ? value.defaultDownloadDirectory.trim()
    : undefined;

  return {
    language,
    region,
    preferredMediaType: mediaTypes.has(value.preferredMediaType ?? "")
      ? value.preferredMediaType as DiscoveryPreferences["preferredMediaType"]
      : defaultDiscoveryPreferences.preferredMediaType,
    preferredQuality: qualities.has(value.preferredQuality ?? "")
      ? value.preferredQuality as DiscoveryPreferences["preferredQuality"]
      : defaultDiscoveryPreferences.preferredQuality,
    maxSizeGb,
    minSeeders,
    sourceProvider,
    debridProvider,
    defaultDownloadDirectory
  };
}

function normalizeStoredState(value: unknown): StoredDiscoveryState {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid discovery state.");
  }
  const candidate = value as Partial<StoredDiscoveryState>;
  const rawInteractions = Array.isArray(candidate.interactions) ? candidate.interactions : [];
  return {
    version: DISCOVERY_STORE_VERSION,
    preferences: normalizePreferences(candidate.preferences ?? {}),
    interactions: rawInteractions.flatMap((interaction) => {
      try {
        return [normalizeInteraction(interaction)];
      } catch {
        return [];
      }
    }).slice(0, MAX_STORED_INTERACTIONS)
  };
}

function normalizeInteraction(value: unknown): DiscoveryInteraction {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid interaction.");
  }
  const candidate = value as Partial<DiscoveryInteraction>;
  const item = normalizeCatalogItem(candidate.item as CatalogItem);
  const watchedEpisodes = Array.isArray(candidate.watchedEpisodes)
    ? [...new Set(candidate.watchedEpisodes.filter(isEpisodeKey))].slice(0, 10_000).sort(compareEpisodeKeys)
    : [];
  const knownEpisodeCount = Number.isSafeInteger(candidate.knownEpisodeCount)
    && (candidate.knownEpisodeCount ?? 0) > 0
    && (candidate.knownEpisodeCount ?? 0) <= 10_000
    ? candidate.knownEpisodeCount
    : undefined;
  return {
    key: catalogItemKey(item),
    item,
    liked: candidate.liked === true,
    disliked: candidate.disliked === true,
    watched: candidate.watched === true,
    watchedEpisodes,
    knownEpisodeCount,
    watchedManually: typeof candidate.watchedManually === "boolean"
      ? candidate.watchedManually
      : candidate.watched === true,
    watchlisted: candidate.watchlisted === true,
    hidden: candidate.hidden === true,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date(0).toISOString()
  };
}

function knownSeriesEpisodeKeys(media: CatalogDetails): Set<string> {
  const keys = new Set<string>();
  if (!Array.isArray(media.seasons)) {
    return keys;
  }
  for (const season of media.seasons.slice(0, 200)) {
    if (!Number.isSafeInteger(season?.seasonNumber) || season.seasonNumber <= 0
      || !Number.isSafeInteger(season.episodeCount) || season.episodeCount <= 0) {
      continue;
    }
    for (let episode = 1; episode <= Math.min(season.episodeCount, 1_000); episode += 1) {
      keys.add(`s${season.seasonNumber}e${episode}`);
      if (keys.size >= 10_000) {
        return keys;
      }
    }
  }
  return keys;
}

function toEpisodeKey(season: number | undefined, episode: number | undefined): string | undefined {
  return Number.isSafeInteger(season) && (season ?? 0) > 0
    && Number.isSafeInteger(episode) && (episode ?? 0) > 0
    ? `s${season}e${episode}`
    : undefined;
}

function isEpisodeKey(value: unknown): value is string {
  return typeof value === "string" && /^s[1-9]\d{0,3}e[1-9]\d{0,3}$/.test(value);
}

function compareEpisodeKeys(left: string, right: string): number {
  const [, leftSeason, leftEpisode] = /^s(\d+)e(\d+)$/.exec(left) ?? [];
  const [, rightSeason, rightEpisode] = /^s(\d+)e(\d+)$/.exec(right) ?? [];
  return Number(leftSeason) - Number(rightSeason) || Number(leftEpisode) - Number(rightEpisode);
}

async function discoveryStateNeedsSanitizedMigration(storePath: string): Promise<boolean> {
  const results = await Promise.all([
    storedFileNeedsSanitizedMigration(storePath),
    storedFileNeedsSanitizedMigration(getDurableBackupPath(storePath))
  ]);
  return results.some(Boolean);
}

async function storedFileNeedsSanitizedMigration(filePath: string): Promise<boolean> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return false;
  }
  if (text.includes(`"${LEGACY_SOURCE_URLS_KEY}"`)) {
    return true;
  }
  try {
    const value = JSON.parse(text) as { version?: unknown };
    return !value || typeof value !== "object" || value.version !== DISCOVERY_STORE_VERSION;
  } catch {
    return true;
  }
}

function normalizeCatalogItem(item: CatalogItem): CatalogItem {
  if (!item || typeof item.id !== "string" || !/^tt\d{5,12}$/.test(item.id) || !["movie", "series"].includes(item.mediaType)) {
    throw new Error("Invalid catalog item.");
  }
  return {
    id: item.id,
    mediaType: item.mediaType,
    title: cleanText(item.title, 300),
    originalTitle: item.originalTitle ? cleanText(item.originalTitle, 300) : undefined,
    overview: cleanText(item.overview, 4_000),
    posterPath: safeImageUrl(item.posterPath),
    backdropPath: safeImageUrl(item.backdropPath),
    releaseDate: typeof item.releaseDate === "string" ? item.releaseDate.slice(0, 10) : undefined,
    genreIds: Array.isArray(item.genreIds)
      ? item.genreIds.filter((id) => Number.isInteger(id) && id > 0).slice(0, 30)
      : [],
    voteAverage: finiteInRange(item.voteAverage, 0, 10, 0),
    voteCount: Math.round(finiteInRange(item.voteCount, 0, Number.MAX_SAFE_INTEGER, 0)),
    popularity: finiteInRange(item.popularity, 0, Number.MAX_SAFE_INTEGER, 0),
    originalLanguage: typeof item.originalLanguage === "string" ? item.originalLanguage.slice(0, 12) : undefined
  };
}

function safeImageUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 500) {
    return undefined;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname === "images.metahub.space"
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

/** Interaction flags carried over from the stored entry, with defaults for a new title. */
function withDefaults(existing: DiscoveryInteraction | undefined): Omit<DiscoveryInteraction, "key" | "item" | "updatedAt"> {
  return {
    liked: existing?.liked ?? false,
    disliked: existing?.disliked ?? false,
    watched: existing?.watched ?? false,
    watchedEpisodes: existing?.watchedEpisodes ?? [],
    knownEpisodeCount: existing?.knownEpisodeCount,
    watchedManually: existing?.watchedManually ?? false,
    watchlisted: existing?.watchlisted ?? false,
    hidden: existing?.hidden ?? false
  };
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? cleanString(value, maxLength) : "";
}

function finiteInRange(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback;
}
