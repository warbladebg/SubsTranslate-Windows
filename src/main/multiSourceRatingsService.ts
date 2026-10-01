import { AsyncTtlCache } from "../core/cache/AsyncTtlCache";
import { normalizeAvailabilityItems } from "../core/discovery/AvailabilityItems";
import { mapWithConcurrency } from "../core/async/mapWithConcurrency";
import type {
  DiscoveryRatingsResult,
  ExternalRating,
  RatingSourceId,
  StreamingAvailabilityItem,
  TitleRatings
} from "../core/discovery/DiscoveryTypes";
import { electronFetch } from "./electronFetch";
import { readBoundedJson } from "./boundedResponse";
import { withTimeout } from "../core/async/withTimeout";

const MDBLIST_BASE_URL = "https://api.mdblist.com";
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_ITEMS_PER_REQUEST = 50;
const CACHE_TTL_MS = 24 * 60 * 60_000;
const REQUEST_CONCURRENCY = 4;

type FetchLike = typeof fetch;
type ApiKeyProvider = () => Promise<string | undefined>;

interface MdblistResponse {
  response?: unknown;
  error?: unknown;
  ratings?: unknown;
}

export class MultiSourceRatingsService {
  private readonly cache = new AsyncTtlCache<ExternalRating[]>(400);

  constructor(
    private readonly apiKeyProvider: ApiKeyProvider,
    private readonly fetchImpl: FetchLike = electronFetch
  ) {}

  clearCache(): void {
    this.cache.clear();
  }

  async validateApiKey(apiKey: string): Promise<void> {
    const normalized = normalizeApiKey(apiKey);
    await this.fetchRatings({ id: "tt0133093", mediaType: "movie" }, normalized, false);
  }

  async getRatings(items: StreamingAvailabilityItem[]): Promise<DiscoveryRatingsResult> {
    const apiKey = normalizeApiKey(await this.apiKeyProvider());
    const normalized = normalizeAvailabilityItems(items, MAX_ITEMS_PER_REQUEST);
    const entries: TitleRatings[] = [];
    let failedItems = 0;
    let firstError: unknown;

    const results = await mapWithConcurrency(normalized, REQUEST_CONCURRENCY, async (item) => {
      try {
        return await this.fetchRatings(item, apiKey, true);
      } catch (error) {
        firstError ??= error;
        return undefined;
      }
    });
    for (const entry of results) {
      if (entry) entries.push(entry);
      else failedItems += 1;
    }

    if (entries.length === 0 && failedItems > 0 && firstError) throw firstError;
    return { entries, checkedItems: normalized.length, failedItems };
  }

  private async fetchRatings(
    item: StreamingAvailabilityItem,
    apiKey: string,
    useCache: boolean
  ): Promise<TitleRatings> {
    const key = `${item.mediaType}:${item.id}`;
    const ratings = await this.cache.getOrLoad(`${apiKey}\0${key}`, useCache ? CACHE_TTL_MS : 0, () => this.requestRatings(item, apiKey));
    return { key, ratings: ratings.map((rating) => ({ ...rating })) };
  }

  private async requestRatings(item: StreamingAvailabilityItem, apiKey: string): Promise<ExternalRating[]> {
    const mediaType = item.mediaType === "series" ? "show" : "movie";
    const url = new URL(`/imdb/${mediaType}/${item.id}/`, `${MDBLIST_BASE_URL}/`);
    if (url.origin !== MDBLIST_BASE_URL) throw new Error("Invalid ratings provider URL.");
    url.searchParams.set("apikey", apiKey);
    return withTimeout(REQUEST_TIMEOUT_MS, async (signal) => {
      const response = await this.fetchImpl(url, {
        headers: { Accept: "application/json" },
        signal,
        redirect: "error"
      });
      if (response.status === 401 || response.status === 403) throw new Error("The MDBList API key was rejected.");
      if (response.status === 429) throw new Error("The MDBList rating limit has been reached. Try again later.");
      if (!response.ok) throw new Error(`The ratings provider returned HTTP ${response.status}.`);
      const raw = await readBoundedJson<MdblistResponse>(response, { maximumBytes: MAX_RESPONSE_BYTES, provider: "Ratings" });
      if (raw?.response === false) {
        const message = typeof raw.error === "string"
          ? raw.error.slice(0, 300)
          : "The ratings provider rejected the request.";
        throw new Error(message);
      }
      return mapRatings(raw?.ratings);
    });
  }

}

function normalizeApiKey(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Add an MDBList API key in Discovery settings to load external ratings.");
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 1_000 || /[\r\n\0]/.test(normalized)) {
    throw new Error("Add a valid MDBList API key in Discovery settings to load external ratings.");
  }
  return normalized;
}

function mapRatings(value: unknown): ExternalRating[] {
  const candidates = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.entries(value).map(([source, rating]) => ({ source, value: rating }))
      : [];
  const ratings = candidates.flatMap((candidate): ExternalRating[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const raw = candidate as { source?: unknown; value?: unknown; rating?: unknown; votes?: unknown };
    const source = normalizeRatingSource(raw.source);
    const numericValue = finiteNumber(raw.value ?? raw.rating);
    if (!source || numericValue === undefined || !ratingInRange(source, numericValue)) return [];
    const votes = finiteNumber(raw.votes);
    return [{
      source,
      value: numericValue,
      votes: votes !== undefined && votes >= 0 ? Math.round(votes) : undefined
    }];
  });
  return [...new Map(ratings.map((rating) => [rating.source, rating])).values()];
}

function normalizeRatingSource(value: unknown): RatingSourceId | undefined {
  if (typeof value !== "string") return undefined;
  const source = value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
  if (source === "imdb") return "imdb";
  if (source === "trakt") return "trakt";
  if (source === "tmdb" || source === "themoviedb") return "tmdb";
  if (source === "letterboxd") return "letterboxd";
  if (source === "tomatoes" || source === "rottentomatoes") return "tomatoes";
  if (source === "popcorn" || source === "popcornmeter") return "popcorn";
  if (source === "metacritic" || source === "metascore") return "metacritic";
  if (source === "metacriticuser" || source === "metacriticuserscore") return "metacritic-user";
  if (source === "rogerebert") return "rogerebert";
  if (source === "myanimelist" || source === "mal") return "myanimelist";
  return undefined;
}

function ratingInRange(source: RatingSourceId, value: number): boolean {
  if (source === "imdb" || source === "letterboxd" || source === "rogerebert" || source === "myanimelist") {
    return value >= 0 && value <= 10;
  }
  return value >= 0 && value <= 100;
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value.replace(/[% ,]/g, ""))
      : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}
