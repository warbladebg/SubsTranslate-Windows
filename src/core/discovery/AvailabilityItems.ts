import type { StreamingAvailabilityItem } from "./DiscoveryTypes";
import { catalogItemKey } from "./DiscoveryTypes";

/** Validate untrusted IPC input before constructing a provider URL. */
export function normalizeAvailabilityItems(value: unknown, limit: number): StreamingAvailabilityItem[] {
  if (!Array.isArray(value)) return [];
  const items = new Map<string, StreamingAvailabilityItem>();
  for (const candidate of value.slice(0, limit)) {
    if (!candidate || typeof candidate !== "object") continue;
    const item = candidate as Partial<StreamingAvailabilityItem>;
    if ((item.mediaType !== "movie" && item.mediaType !== "series")
      || typeof item.id !== "string" || !/^tt\d{5,12}$/.test(item.id)) continue;
    const normalized = { id: item.id, mediaType: item.mediaType };
    items.set(catalogItemKey(normalized), normalized);
  }
  return [...items.values()];
}
