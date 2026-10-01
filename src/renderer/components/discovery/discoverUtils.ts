import type { TorrentSource } from "../../../core/discovery/DiscoveryTypes";
import type { DiscoveryCatalogFilters } from "../../../core/discovery/DiscoveryFilters";
import { normalizeRecentDiscoverySearches, RECENT_DISCOVERY_SEARCHES_STORAGE_KEY } from "../../../core/discovery/RecentSearches";
import type { DownloadLocationState } from "../../../core/downloads/DownloadLocations";

export const MIN_CATALOG_QUERY_LENGTH = 2;

export function normalizeCatalogQuery(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function isSearchableCatalogQuery(value: string): boolean {
  return normalizeCatalogQuery(value).length >= MIN_CATALOG_QUERY_LENGTH;
}

export function readRecentDiscoverySearches(): string[] {
  try {
    const storedSearches = window.localStorage.getItem(RECENT_DISCOVERY_SEARCHES_STORAGE_KEY);
    return storedSearches ? normalizeRecentDiscoverySearches(JSON.parse(storedSearches)) : [];
  } catch {
    return [];
  }
}

export function writeRecentDiscoverySearches(searches: string[]): void {
  try {
    const normalizedSearches = normalizeRecentDiscoverySearches(searches);
    if (normalizedSearches.length === 0) {
      window.localStorage.removeItem(RECENT_DISCOVERY_SEARCHES_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(
      RECENT_DISCOVERY_SEARCHES_STORAGE_KEY,
      JSON.stringify(normalizedSearches)
    );
  } catch {
    // Searching remains available when local storage is blocked or unavailable.
  }
}

export function isStaleRealDebridCacheError(message: string): boolean {
  return /provider cache claim is stale|could not make the file available immediately/i.test(message);
}

export function realDebridSourceKey(source: TorrentSource): string {
  return `${source.infoHash.toLowerCase()}:${source.fileIndex ?? ""}`;
}

export function defaultDownloadLocationId(state: DownloadLocationState): string {
  return state.locations.find((location) => location.isDefault && location.isAvailable)?.id
    ?? state.locations.find((location) => location.isAvailable)?.id
    ?? "";
}

export function copyDiscoveryFilters(filters: DiscoveryCatalogFilters): DiscoveryCatalogFilters {
  return {
    ...filters,
    genreIds: [...filters.genreIds],
    streamingServices: [...filters.streamingServices]
  };
}
