import type { TorrentSource } from "./DiscoveryTypes";

export function sortTorrentSources(sources: TorrentSource[]): TorrentSource[] {
  return [...sources].sort((left, right) =>
    resolutionHeight(right.quality) - resolutionHeight(left.quality)
    || sourceSize(right) - sourceSize(left)
    || cacheRank(right) - cacheRank(left)
    || (right.seeders ?? 0) - (left.seeders ?? 0)
    || left.name.localeCompare(right.name)
    || left.id.localeCompare(right.id));
}

function resolutionHeight(value: string | undefined): number {
  const match = value?.match(/^(\d{3,4})[pi]$/i);
  if (match) return Number(match[1]);
  return /^8k$/i.test(value ?? "") ? 4320 : /^(?:4k|uhd)$/i.test(value ?? "") ? 2160 : 0;
}

function sourceSize(source: TorrentSource): number {
  return source.sizeBytes !== undefined && Number.isFinite(source.sizeBytes) && source.sizeBytes >= 0
    ? source.sizeBytes : -1;
}

function cacheRank(source: TorrentSource): number {
  return source.cacheStatus === "verified-account-cached" ? 3
    : source.cacheStatus === "verified-provider-cached" ? 2
      : source.cacheStatus === "provider-claimed-cached" ? 1 : 0;
}
