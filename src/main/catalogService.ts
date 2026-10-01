import { AsyncTtlCache } from "../core/cache/AsyncTtlCache";
import type {
  CatalogDetails,
  CatalogItem,
  CatalogPerson,
  CatalogVideo,
  DiscoveryHome,
  DiscoveryInteraction,
  DiscoveryPreferences,
  MediaType,
  StreamingCatalogueRequest,
  SeasonSummary
} from "../core/discovery/DiscoveryTypes";
import { catalogItemKey } from "../core/discovery/DiscoveryTypes";
import { DISCOVERY_GENRES, discoveryGenreId } from "../core/discovery/DiscoveryFilters";
import {
  hasRecommendationSignal,
  rankRecommendations,
  recommendationSignalStrength
} from "../core/discovery/RecommendationEngine";
import { electronFetch } from "./electronFetch";
import { readBoundedJson } from "./boundedResponse";
import { withTimeout } from "../core/async/withTimeout";
import { cleanText, stableNumericId } from "../core/util/text";

const CINEMETA_BASE_URL = "https://v3-cinemeta.strem.io";
const CINEMETA_CATALOG_BASE_URL = "https://cinemeta-catalogs.strem.io/top";
const METAHUB_IMAGE_ORIGIN = "https://images.metahub.space";
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_CATALOG_ITEMS = 200;
const CATALOG_PAGE_SIZE = 50;
const MAX_CATALOG_SKIP = 50_000;

const GENRE_BY_ID = new Map(DISCOVERY_GENRES.map((name) => [discoveryGenreId(name), name]));

type FetchLike = typeof fetch;

function recommendationReasonTitle(interaction: DiscoveryInteraction): string {
  if (interaction.liked) {
    return `Because you liked ${interaction.item.title}`;
  }
  if (interaction.watchlisted) {
    return `Because you favourited ${interaction.item.title}`;
  }
  if (interaction.watched) {
    return `Because you watched ${interaction.item.title}`;
  }
  return `Because you started ${interaction.item.title}`;
}

interface CatalogLoad {
  type: MediaType;
  items: CatalogItem[];
}

export class CatalogService {
  private readonly cache = new AsyncTtlCache<unknown>(200);

  constructor(private readonly fetchImpl: FetchLike = electronFetch) {}

  async getHome(
    preferences: DiscoveryPreferences,
    interactions: DiscoveryInteraction[]
  ): Promise<DiscoveryHome> {
    const types = selectedMediaTypes(preferences);
    const settledCatalogs = await Promise.allSettled(
      types.map(async (type): Promise<CatalogLoad> => ({
        type,
        items: await this.fetchCatalog(type, "top", undefined, 10 * 60_000)
      }))
    );
    const loadedCatalogs = settledCatalogs.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    if (loadedCatalogs.length === 0) {
      const firstFailure = settledCatalogs.find((result): result is PromiseRejectedResult => result.status === "rejected");
      throw firstFailure?.reason ?? new Error("The metadata catalog is temporarily unavailable.");
    }

    const popular = loadedCatalogs.flatMap((catalog) => catalog.items);
    const now = new Date();
    const tasteSeeds = interactions
      .map((interaction) => ({ interaction, strength: recommendationSignalStrength(interaction, now) }))
      .filter((seed) => seed.strength > 0)
      .sort((left, right) =>
        right.strength - left.strength
        || right.interaction.updatedAt.localeCompare(left.interaction.updatedAt)
      )
      .slice(0, 5)
      .map((seed) => seed.interaction);
    const hasPersonalization = interactions.some(hasRecommendationSignal);
    const relatedGroups = await Promise.all(
      tasteSeeds.map(async (interaction) => ({
        interaction,
        items: await this.getRelatedCandidates(interaction.item, popular)
      }))
    );
    const related = relatedGroups.flatMap((group) => group.items);
    const recommendationCandidates = [...related, ...popular];
    const recommendedMovies = rankRecommendations(
      recommendationCandidates.filter((item) => item.mediaType === "movie"),
      interactions,
      30
    );
    const recommendedSeries = rankRecommendations(
      recommendationCandidates.filter((item) => item.mediaType === "series"),
      interactions,
      30
    );
    const popularMovies = popular.filter((item) => item.mediaType === "movie").slice(0, 30);
    const popularSeries = popular.filter((item) => item.mediaType === "series").slice(0, 30);
    const recommendationSubtitle = hasPersonalization
      ? "Ranked locally from your likes, favourites, watched titles, dislikes, hidden titles, genres, ratings, and recency."
      : "Like, favourite, or watch a few titles to personalize this row.";
    const sections = [
      ...(recommendedMovies.length > 0
        ? [{
            id: "recommended-movies",
            title: hasPersonalization ? "Recommended movies" : "Popular movie starting points",
            subtitle: recommendationSubtitle,
            items: recommendedMovies
          }]
        : []),
      ...(recommendedSeries.length > 0
        ? [{
            id: "recommended-series",
            title: hasPersonalization ? "Recommended TV shows" : "Popular TV starting points",
            subtitle: recommendationSubtitle,
            items: recommendedSeries
          }]
        : []),
      ...relatedGroups
        .filter((group) => group.items.length > 0)
        .slice(0, 2)
        .map((group) => ({
          id: `because-${group.interaction.key}`,
          title: recommendationReasonTitle(group.interaction),
          items: rankRecommendations(group.items, interactions, 20)
        })),
      ...(popularMovies.length > 0 ? [{ id: "popular-movies", title: "Popular movies", items: popularMovies }] : []),
      ...(popularSeries.length > 0 ? [{ id: "popular-series", title: "Popular TV", items: popularSeries }] : [])
    ].filter((section) => section.items.length > 0);

    return { sections, generatedAt: new Date().toISOString() };
  }

  async search(query: string, preferences: DiscoveryPreferences): Promise<CatalogItem[]> {
    const normalized = query.replace(/\s+/g, " ").trim();
    if (normalized.length < 2 || normalized.length > 200) {
      throw new Error("Search must contain between 2 and 200 characters.");
    }
    const types = selectedMediaTypes(preferences);
    const extra = `search=${encodeURIComponent(normalized)}`;
    const settled = await Promise.allSettled(
      types.map((type) => this.fetchCatalog(type, "top", extra, 2 * 60_000))
    );
    const successful = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    if (successful.length === 0 && settled.every((result) => result.status === "rejected")) {
      const failure = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
      throw failure?.reason ?? new Error("Search is temporarily unavailable.");
    }
    const uniqueResults = deduplicate(successful);
    const hydratedResults = await this.hydrateBestSearchMatches(uniqueResults, normalized);
    return rankSearchResults(hydratedResults, normalized).slice(0, 50);
  }

  async browseCatalogueCandidates(request: StreamingCatalogueRequest): Promise<{
    items: CatalogItem[];
    nextSkip: number;
    hasMore: boolean;
  }> {
    const skip = Number.isSafeInteger(request.skip)
      ? Math.max(0, Math.min(request.skip, MAX_CATALOG_SKIP))
      : 0;
    const query = request.query.replace(/\s+/g, " ").trim().slice(0, 200);
    const types: MediaType[] = request.mediaType === "all"
      ? ["movie", "series"]
      : [request.mediaType];
    const selectedGenre = request.genreIds.length === 1
      ? GENRE_BY_ID.get(request.genreIds[0])
      : undefined;
    const extra = [
      ...(query.length >= 2 ? [`search=${encodeURIComponent(query)}`] : []),
      ...(selectedGenre ? [`genre=${encodeURIComponent(selectedGenre)}`] : []),
      ...(skip > 0 ? [`skip=${skip}`] : [])
    ].join("&") || undefined;
    const settled = await Promise.allSettled(
      types.map((type) => this.fetchCatalog(type, "top", extra, 0))
    );
    const loaded = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    if (loaded.length === 0 && settled.every((result) => result.status === "rejected")) {
      const failure = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
      throw failure?.reason ?? new Error("The catalogue is temporarily unavailable.");
    }
    const items = deduplicate(loaded.flatMap((catalogue) => catalogue));
    const nextSkip = Math.min(skip + CATALOG_PAGE_SIZE, MAX_CATALOG_SKIP);
    return {
      items,
      nextSkip,
      hasMore: query.length < 2
        && skip < MAX_CATALOG_SKIP
        && loaded.some((catalogue) => catalogue.length > 0)
    };
  }

  async getDetails(mediaType: MediaType, id: string, _language = "en-US"): Promise<CatalogDetails> {
    const imdbId = cleanImdbId(id);
    if (!imdbId) {
      throw new Error("Invalid catalog item ID.");
    }
    const rawResponse = await this.fetchJson<CinemetaMetaResponse>(
      `/meta/${toCinemetaType(mediaType)}/${imdbId}.json`,
      30 * 60_000
    );
    const raw = rawResponse?.meta;
    const item = mapCatalogItem(raw, mediaType);
    if (!raw || !item || item.id !== imdbId) {
      throw new Error("The metadata provider returned an invalid title.");
    }

    const genreNames = cleanStringArray(raw.genre ?? raw.genres, 30, 100);
    const recommendations = genreNames[0]
      ? await this.fetchCatalog(
        mediaType,
        "top",
        `genre=${encodeURIComponent(genreNames[0])}`,
        30 * 60_000
      ).then((items) => items.filter((candidate) => candidate.id !== imdbId).slice(0, 20), () => [])
      : [];
    const cast = mapPeople(raw.cast, "Cast");
    const directors = mapPeople(raw.director, "Director");
    const writers = mapPeople(raw.writer, "Writer");

    return {
      ...item,
      imdbId,
      runtimeMinutes: parseRuntime(raw.runtime),
      genres: genreNames.map((name) => ({ id: discoveryGenreId(name), name })),
      cast,
      crew: [...directors, ...writers].slice(0, 20),
      videos: mapVideos(raw).slice(0, 12),
      seasons: mapSeasons(raw.videos, item.posterPath),
      recommendations,
      status: cleanOptionalText(raw.status, 100)
    };
  }

  private async getRelatedCandidates(seed: CatalogItem, popular: CatalogItem[]): Promise<CatalogItem[]> {
    const genreName = seed.genreIds.map((id) => GENRE_BY_ID.get(id)).find(Boolean);
    if (genreName) {
      try {
        const catalog = await this.fetchCatalog(
          seed.mediaType,
          "top",
          `genre=${encodeURIComponent(genreName)}`,
          30 * 60_000
        );
        return catalog.filter((candidate) => candidate.id !== seed.id).slice(0, 40);
      } catch {
        // The popular in-memory catalog below keeps recommendations useful during partial provider failures.
      }
    }
    const seedGenres = new Set(seed.genreIds);
    return popular
      .filter((candidate) =>
        candidate.id !== seed.id
        && candidate.mediaType === seed.mediaType
        && candidate.genreIds.some((id) => seedGenres.has(id))
      )
      .slice(0, 40);
  }

  private async hydrateBestSearchMatches(items: CatalogItem[], query: string): Promise<CatalogItem[]> {
    const parsedQuery = parseSearchQuery(query);
    const scored = items.map((item, index) => ({
      index,
      score: searchTitleRelevance(item, parsedQuery)
    }));
    const bestScore = Math.max(0, ...scored.map((candidate) => candidate.score));
    const candidates = scored
      .filter((candidate) => candidate.score === bestScore && candidate.score >= 3)
      .slice(0, 16);
    if (candidates.length < 2) {
      return items;
    }

    const hydrated = await Promise.all(candidates.map(async ({ index }) => {
      const item = items[index];
      try {
        const response = await this.fetchJson<CinemetaMetaResponse>(
          `/meta/${toCinemetaType(item.mediaType)}/${item.id}.json`,
          5 * 60_000
        );
        const details = mapCatalogItem(response?.meta, item.mediaType);
        return details?.id === item.id ? mergeSearchItem(item, details) : item;
      } catch {
        return item;
      }
    }));
    const replacements = new Map(candidates.map((candidate, index) => [
      catalogItemKey(items[candidate.index]),
      hydrated[index]
    ]));
    return items.map((item) => replacements.get(catalogItemKey(item)) ?? item);
  }

  private async fetchCatalog(
    mediaType: MediaType,
    catalog: "top",
    extra: string | undefined,
    cacheTtlMs: number
  ): Promise<CatalogItem[]> {
    const suffix = extra ? `/${extra}` : "";
    const baseUrl = extra?.startsWith("search=") ? CINEMETA_BASE_URL : CINEMETA_CATALOG_BASE_URL;
    const response = await this.fetchJson<CinemetaCatalogResponse>(
      `${baseUrl}/catalog/${toCinemetaType(mediaType)}/${catalog}${suffix}.json`,
      cacheTtlMs
    );
    return mapCatalogResults(response, mediaType);
  }

  private async fetchJson<T>(path: string, cacheTtlMs: number): Promise<T> {
    const url = new URL(path, `${CINEMETA_BASE_URL}/`);
    if (![CINEMETA_BASE_URL, CINEMETA_CATALOG_BASE_URL].some((base) => url.href.startsWith(`${base}/`))) {
      throw new Error("Invalid metadata provider URL.");
    }
    return this.cache.getOrLoad(url.toString(), cacheTtlMs, () => this.requestJson<T>(url)) as Promise<T>;
  }

  private async requestJson<T>(url: URL): Promise<T> {
    return withTimeout(REQUEST_TIMEOUT_MS, async (signal) => {
      const response = await this.fetchImpl(url, {
        headers: { Accept: "application/json" },
        signal,
        redirect: "error"
      });
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("The requested title was not found.");
        }
        if (response.status === 429) {
          throw new Error("The metadata catalog is busy. Try again shortly.");
        }
        throw new Error(`Metadata request failed with HTTP ${response.status}.`);
      }
      return readBoundedJson<T>(response, { maximumBytes: MAX_RESPONSE_BYTES, provider: "Metadata" });
    }, "The metadata request timed out.");
  }

}

interface CinemetaCatalogResponse {
  metas?: unknown[];
}

interface CinemetaMetaResponse {
  meta?: CinemetaMeta;
}

interface CinemetaMeta {
  id?: unknown;
  imdb_id?: unknown;
  type?: unknown;
  name?: unknown;
  description?: unknown;
  poster?: unknown;
  background?: unknown;
  released?: unknown;
  releaseInfo?: unknown;
  year?: unknown;
  genre?: unknown;
  genres?: unknown;
  imdbRating?: unknown;
  imdbVotes?: unknown;
  popularity?: unknown;
  popularities?: unknown;
  runtime?: unknown;
  cast?: unknown;
  director?: unknown;
  writer?: unknown;
  trailers?: unknown;
  trailerStreams?: unknown;
  videos?: unknown;
  status?: unknown;
}

function mapCatalogResults(response: CinemetaCatalogResponse | undefined, forcedType: MediaType): CatalogItem[] {
  if (!Array.isArray(response?.metas)) {
    return [];
  }
  return deduplicate(
    response.metas
      .slice(0, MAX_CATALOG_ITEMS)
      .flatMap((raw) => {
        const item = mapCatalogItem(raw, forcedType);
        return item ? [item] : [];
      })
  );
}

function mapCatalogItem(raw: unknown, forcedType?: MediaType): CatalogItem | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const value = raw as CinemetaMeta;
  const id = cleanImdbId(value.id ?? value.imdb_id);
  const mediaType = forcedType ?? fromCinemetaType(value.type);
  const title = cleanOptionalText(value.name, 300);
  if (!id || !mediaType || !title) {
    return undefined;
  }
  const genres = cleanStringArray(value.genre ?? value.genres, 30, 100);
  return {
    id,
    mediaType,
    title,
    overview: cleanOptionalText(value.description, 4_000) ?? "",
    posterPath: value.poster ? metahubImage(id, "poster", "small") : undefined,
    backdropPath: value.background ? metahubImage(id, "background", "medium") : undefined,
    releaseDate: parseReleaseDate(value.released, value.releaseInfo, value.year),
    genreIds: genres.map(discoveryGenreId),
    voteAverage: boundedNumber(parseNumeric(value.imdbRating), 0, 10),
    voteCount: parseVoteCount(value.imdbVotes),
    popularity: parsePopularity(value),
    originalLanguage: undefined,
    runtimeMinutes: parseRuntime(value.runtime)
  };
}

function mapPeople(value: unknown, job: "Cast" | "Director" | "Writer"): CatalogPerson[] {
  return cleanStringArray(value, 30, 200).map((name) => ({
    id: stableNumericId(`person:${name.toLowerCase()}`),
    name,
    job: job === "Cast" ? undefined : job
  }));
}

function mapVideos(meta: CinemetaMeta): CatalogVideo[] {
  const videos = new Map<string, CatalogVideo>();
  if (Array.isArray(meta.trailers)) {
    for (const raw of meta.trailers.slice(0, 30)) {
      if (!raw || typeof raw !== "object") {
        continue;
      }
      const value = raw as Record<string, unknown>;
      const key = youtubeKey(value.source);
      if (!key) {
        continue;
      }
      videos.set(key, {
        key,
        name: cleanOptionalText(value.type, 100) ?? "Trailer",
        site: "YouTube",
        type: "Trailer",
        official: true
      });
    }
  }
  if (Array.isArray(meta.trailerStreams)) {
    for (const raw of meta.trailerStreams.slice(0, 30)) {
      if (!raw || typeof raw !== "object") {
        continue;
      }
      const value = raw as Record<string, unknown>;
      const key = youtubeKey(value.ytId);
      if (!key || videos.has(key)) {
        continue;
      }
      videos.set(key, {
        key,
        name: cleanOptionalText(value.title, 200) ?? "Trailer",
        site: "YouTube",
        type: "Trailer",
        official: true
      });
    }
  }
  return [...videos.values()];
}

function mapSeasons(value: unknown, posterPath: string | undefined): SeasonSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seasons = new Map<number, { episodeCount: number; airDate?: string }>();
  for (const raw of value.slice(0, 5_000)) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const episode = raw as Record<string, unknown>;
    const seasonNumber = asIntegerAllowZero(episode.season);
    const episodeNumber = asPositiveInteger(episode.episode) ?? asPositiveInteger(episode.number);
    if (seasonNumber === undefined || episodeNumber === undefined) {
      continue;
    }
    const airDate = parseReleaseDate(episode.released ?? episode.firstAired);
    const existing = seasons.get(seasonNumber);
    seasons.set(seasonNumber, {
      episodeCount: Math.max(existing?.episodeCount ?? 0, episodeNumber),
      airDate: earlierDate(existing?.airDate, airDate)
    });
  }
  return [...seasons]
    .sort(([left], [right]) => left - right)
    .map(([seasonNumber, season]) => ({
      seasonNumber,
      name: seasonNumber === 0 ? "Specials" : `Season ${seasonNumber}`,
      episodeCount: season.episodeCount,
      airDate: season.airDate,
      posterPath
    }));
}

function selectedMediaTypes(preferences: DiscoveryPreferences): MediaType[] {
  return preferences.preferredMediaType === "all"
    ? ["movie", "series"]
    : [preferences.preferredMediaType];
}

function deduplicate(items: CatalogItem[]): CatalogItem[] {
  return [...new Map(items.map((item) => [`${item.mediaType}:${item.id}`, item])).values()];
}

interface ParsedSearchQuery {
  normalizedTitle: string;
  tokens: string[];
  year?: string;
}

function rankSearchResults(items: CatalogItem[], query: string): CatalogItem[] {
  const parsedQuery = parseSearchQuery(query);
  return items
    .map((item, index) => ({
      item,
      index,
      relevance: searchTitleRelevance(item, parsedQuery),
      yearMatch: searchYearMatch(item, parsedQuery.year)
    }))
    .sort((left, right) =>
      right.relevance - left.relevance
      || right.yearMatch - left.yearMatch
      || right.item.popularity - left.item.popularity
      || right.item.voteCount - left.item.voteCount
      || right.item.voteAverage - left.item.voteAverage
      || (right.item.releaseDate ?? "").localeCompare(left.item.releaseDate ?? "")
      || left.index - right.index
    )
    .map(({ item }) => item);
}

function parseSearchQuery(value: string): ParsedSearchQuery {
  const normalized = normalizeSearchText(value);
  const yearMatch = normalized.match(/(?:^| )((?:18|19|20)\d{2})$/);
  const year = yearMatch?.[1];
  const normalizedTitle = year ? normalized.slice(0, -year.length).trim() : normalized;
  return {
    normalizedTitle,
    tokens: normalizedTitle.split(" ").filter(Boolean),
    year
  };
}

function searchTitleRelevance(item: CatalogItem, query: ParsedSearchQuery): number {
  const titles = [item.title, item.originalTitle]
    .flatMap((title) => title ? [normalizeSearchText(title)] : []);
  return Math.max(0, ...titles.map((title) => {
    if (!query.normalizedTitle) return 0;
    if (title === query.normalizedTitle) return 5;
    if (title.startsWith(`${query.normalizedTitle} `)) return 4;
    if (` ${title} `.includes(` ${query.normalizedTitle} `)) return 3;
    if (query.tokens.length > 0 && query.tokens.every((token) => title.split(" ").includes(token))) return 2;
    if (query.tokens.some((token) => title.includes(token))) return 1;
    return 0;
  }));
}

function searchYearMatch(item: CatalogItem, queryYear: string | undefined): number {
  if (!queryYear) return 0;
  const itemYear = item.releaseDate?.slice(0, 4);
  return itemYear === queryYear ? 1 : itemYear ? -1 : 0;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function mergeSearchItem(preview: CatalogItem, details: CatalogItem): CatalogItem {
  return {
    ...preview,
    ...details,
    overview: details.overview || preview.overview,
    posterPath: details.posterPath ?? preview.posterPath,
    backdropPath: details.backdropPath ?? preview.backdropPath,
    releaseDate: details.releaseDate ?? preview.releaseDate,
    genreIds: details.genreIds.length > 0 ? details.genreIds : preview.genreIds,
    voteAverage: details.voteAverage || preview.voteAverage,
    voteCount: details.voteCount || preview.voteCount,
    popularity: details.popularity || preview.popularity,
    originalLanguage: details.originalLanguage ?? preview.originalLanguage,
    runtimeMinutes: details.runtimeMinutes ?? preview.runtimeMinutes
  };
}

function toCinemetaType(type: MediaType): "movie" | "series" {
  return type;
}

function fromCinemetaType(value: unknown): MediaType | undefined {
  return value === "movie" || value === "series" ? value : undefined;
}

function metahubImage(
  imdbId: string,
  kind: "poster" | "background",
  size: "small" | "medium"
): string {
  return `${METAHUB_IMAGE_ORIGIN}/${kind}/${size}/${imdbId}/img`;
}

function parseReleaseDate(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const exact = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (exact) {
      return `${exact[1]}-${exact[2]}-${exact[3]}`;
    }
    const year = value.match(/(?:^|\D)(\d{4})(?:\D|$)/);
    if (year) {
      return `${year[1]}-01-01`;
    }
  }
  return undefined;
}

function parseRuntime(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0 && value < 10_000) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const match = value.match(/(\d{1,4})\s*min/i);
  const minutes = match ? Number(match[1]) : Number.NaN;
  return Number.isInteger(minutes) && minutes > 0 && minutes < 10_000 ? minutes : undefined;
}

function parsePopularity(meta: CinemetaMeta): number {
  const direct = parseNumeric(meta.popularity);
  if (direct !== undefined) {
    return boundedNumber(direct, 0, Number.MAX_SAFE_INTEGER);
  }
  if (meta.popularities && typeof meta.popularities === "object") {
    const values = Object.values(meta.popularities as Record<string, unknown>)
      .map(parseNumeric)
      .filter((value): value is number => value !== undefined && value >= 0);
    return values.length > 0 ? Math.max(...values) : 0;
  }
  return 0;
}

function parseVoteCount(value: unknown): number {
  if (typeof value === "string") {
    value = Number(value.replace(/[,\s]/g, ""));
  }
  return Math.round(boundedNumber(value, 0, Number.MAX_SAFE_INTEGER));
}

function parseNumeric(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function boundedNumber(value: unknown, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : 0;
}

function cleanImdbId(value: unknown): string | undefined {
  return typeof value === "string" && /^tt\d{5,12}$/.test(value) ? value : undefined;
}

function cleanStringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(
    value
      .slice(0, maxItems)
      .flatMap((entry) => {
        const text = cleanOptionalText(entry, maxLength);
        return text ? [text] : [];
      })
  )];
}

function cleanOptionalText(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.trim() ? cleanText(value, maxLength) : undefined;
}

function youtubeKey(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_-]{6,20}$/.test(value) ? value : undefined;
}

function asPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function asIntegerAllowZero(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function earlierDate(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return left < right ? left : right;
}
