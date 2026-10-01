import { AsyncTtlCache } from "../core/cache/AsyncTtlCache";
import { normalizeAvailabilityItems } from "../core/discovery/AvailabilityItems";
import { mapWithConcurrency } from "../core/async/mapWithConcurrency";
import type {
  StreamingAvailabilityEntry,
  StreamingAvailabilityItem,
  StreamingAvailabilityResult,
  StreamingServiceId
} from "../core/discovery/DiscoveryTypes";
import { electronFetch } from "./electronFetch";
import { readBoundedJson } from "./boundedResponse";
import { withTimeout } from "../core/async/withTimeout";

const WATCHHUB_BASE_URL = "https://watchhub.strem.io";
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_ITEMS_PER_REQUEST = 100;
const CACHE_TTL_MS = 6 * 60 * 60_000;
const REQUEST_CONCURRENCY = 32;

type FetchLike = typeof fetch;

interface WatchHubResponse {
  streams?: unknown[];
}

interface AvailabilityOptions {
  useCache?: boolean;
}

export class StreamingAvailabilityService {
  private readonly cache = new AsyncTtlCache<StreamingServiceId[]>(400);

  constructor(private readonly fetchImpl: FetchLike = electronFetch) {}

  async getAvailability(
    items: StreamingAvailabilityItem[],
    options: AvailabilityOptions = {}
  ): Promise<StreamingAvailabilityResult> {
    const normalized = normalizeAvailabilityItems(items, MAX_ITEMS_PER_REQUEST);
    const useCache = options.useCache !== false;
    const entries: StreamingAvailabilityEntry[] = [];
    let failedItems = 0;

    const results = await mapWithConcurrency(normalized, REQUEST_CONCURRENCY, async (item) => {
      try {
        return await this.getItemAvailability(item, useCache);
      } catch {
        return undefined;
      }
    });
    for (const entry of results) {
      if (entry) entries.push(entry);
      else failedItems += 1;
    }

    return { entries, checkedItems: normalized.length, failedItems };
  }

  private async getItemAvailability(
    item: StreamingAvailabilityItem,
    useCache: boolean
  ): Promise<StreamingAvailabilityEntry> {
    const key = `${item.mediaType}:${item.id}`;
    const services = await this.cache.getOrLoad(key, useCache ? CACHE_TTL_MS : 0, () => this.fetchItemAvailability(item));
    return { key, services: [...services] };
  }

  private async fetchItemAvailability(item: StreamingAvailabilityItem): Promise<StreamingServiceId[]> {
    const url = new URL(`/stream/${item.mediaType}/${item.id}.json`, `${WATCHHUB_BASE_URL}/`);
    if (url.origin !== WATCHHUB_BASE_URL) {
      throw new Error("Invalid streaming availability URL.");
    }
    return withTimeout(REQUEST_TIMEOUT_MS, async (signal) => {
      const response = await this.fetchImpl(url, {
        headers: { Accept: "application/json" },
        signal,
        redirect: "error"
      });
      if (!response.ok) {
        throw new Error(`Streaming availability request failed with HTTP ${response.status}.`);
      }
      const raw = await readBoundedJson<WatchHubResponse>(response, { maximumBytes: MAX_RESPONSE_BYTES, provider: "Streaming availability" });
      return mapStreamingServices(raw);
    });
  }

}

function mapStreamingServices(response: WatchHubResponse | undefined): StreamingServiceId[] {
  if (!Array.isArray(response?.streams)) return [];
  const services = response.streams.slice(0, 200).flatMap((stream): StreamingServiceId[] => {
    if (!stream || typeof stream !== "object") return [];
    const name = (stream as { name?: unknown }).name;
    const service = typeof name === "string" ? normalizeServiceName(name) : undefined;
    return service ? [service] : [];
  });
  return [...new Set(services)];
}

function normalizeServiceName(value: string): StreamingServiceId | undefined {
  const name = value.toLocaleLowerCase().replace(/[^a-z0-9+]+/g, " ").trim();
  if (name.includes("netflix")) return "netflix";
  if (name.includes("prime") || name.includes("amazon")) return "prime-video";
  if (name.includes("disney")) return "disney-plus";
  if (name === "max" || name.includes("hbo max")) return "max";
  if (name.includes("apple tv")) return "apple-tv-plus";
  if (name.includes("hulu")) return "hulu";
  if (name.includes("paramount")) return "paramount-plus";
  if (name.includes("peacock")) return "peacock";
  if (name.includes("crunchyroll")) return "crunchyroll";
  if (name.includes("mubi")) return "mubi";
  return undefined;
}
