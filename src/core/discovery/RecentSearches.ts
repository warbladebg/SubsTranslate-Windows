export const RECENT_DISCOVERY_SEARCHES_STORAGE_KEY = "discovery-recent-searches-v1";
export const MAX_RECENT_DISCOVERY_SEARCHES = 5;

export function normalizeRecentDiscoverySearches(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const searches: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== "string") {
      continue;
    }
    const normalized = normalizeSearch(candidate);
    const key = normalized.toLocaleLowerCase();
    if (normalized.length < 2 || seen.has(key)) {
      continue;
    }
    searches.push(normalized);
    seen.add(key);
    if (searches.length >= MAX_RECENT_DISCOVERY_SEARCHES) {
      break;
    }
  }
  return searches;
}

export function addRecentDiscoverySearch(searches: string[], query: string): string[] {
  return normalizeRecentDiscoverySearches([query, ...searches]);
}

function normalizeSearch(value: string): string {
  return value.replace(/[\r\n\0]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
}
