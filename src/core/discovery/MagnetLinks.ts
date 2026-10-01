import type { TorrentSource } from "./DiscoveryTypes";

const HEX_INFO_HASH = /^[a-f0-9]{40}$/i;
const SAFE_TRACKER_PROTOCOLS = new Set(["https:", "http:", "udp:"]);

export function normalizeInfoHash(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!HEX_INFO_HASH.test(normalized)) {
    throw new Error("Torrent source has an invalid BitTorrent v1 info hash.");
  }
  return normalized;
}

export function buildSanitizedMagnetUri(source: Pick<TorrentSource, "infoHash" | "name" | "trackers">, fileIndices?: number[]): string {
  const infoHash = normalizeInfoHash(source.infoHash);
  const parameters = [`xt=urn:btih:${infoHash}`];
  if (fileIndices !== undefined) {
    if (!Array.isArray(fileIndices) || fileIndices.length === 0 || fileIndices.length > 1000
      || fileIndices.some((index) => !Number.isSafeInteger(index) || index < 0)) {
      throw new Error("Invalid torrent file selection.");
    }
    parameters.push(`so=${[...new Set(fileIndices)].sort((a, b) => a - b).join(",")}`);
  }
  const displayName = sanitizeDisplayName(source.name);
  if (displayName) {
    parameters.push(`dn=${encodeURIComponent(displayName)}`);
  }
  for (const tracker of sanitizeTrackers(source.trackers).slice(0, 10)) {
    parameters.push(`tr=${encodeURIComponent(tracker)}`);
  }
  return `magnet:?${parameters.join("&")}`;
}

export function sanitizeTrackers(trackers: string[]): string[] {
  const safe = new Set<string>();
  for (const rawTracker of trackers) {
    const candidate = rawTracker.startsWith("tracker:") ? rawTracker.slice("tracker:".length) : rawTracker;
    if (candidate.length > 500 || /[\r\n\0]/.test(candidate)) {
      continue;
    }
    try {
      const parsed = new URL(candidate);
      if (!SAFE_TRACKER_PROTOCOLS.has(parsed.protocol) || parsed.username || parsed.password) {
        continue;
      }
      safe.add(parsed.toString());
    } catch {
      // Ignore malformed provider data.
    }
  }
  return [...safe];
}

function sanitizeDisplayName(value: string): string {
  return value.replace(/[\r\n\0]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
}
