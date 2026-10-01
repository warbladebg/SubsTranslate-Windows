import { parsePublicHttpsUrl } from "./publicHttpsUrl";
import { readBoundedJson } from "./boundedResponse";
import { withTimeout } from "../core/async/withTimeout";
import { mapWithConcurrency } from "../core/async/mapWithConcurrency";
import type {
  CatalogDetails,
  RealDebridConnectionStatus,
  TorrentSource,
  VerifyCachedSourcesRequest
} from "../core/discovery/DiscoveryTypes";
import { electronFetch } from "./electronFetch";
import { buildSanitizedMagnetUri, normalizeInfoHash } from "../core/discovery/MagnetLinks";
import { errorMessage } from "../core/util/errors";
import { cleanText } from "../core/util/text";

const REAL_DEBRID_BASE_URL = "https://api.real-debrid.com/rest/1.0";
const REQUEST_TIMEOUT_MS = 15_000;
const TORRENT_INDEX_TTL_MS = 60_000;
const TORRENT_RESOLUTION_ATTEMPTS = 20;
const TORRENT_RESOLUTION_POLL_MS = 500;
const VIDEO_EXTENSION = /\.(mkv|mp4|avi|webm|m4v|mov|ts)$/i;
const TERMINAL_TORRENT_STATUSES = new Set(["magnet_error", "error", "virus", "dead"]);

type FetchLike = typeof fetch;

interface RealDebridUser {
  username?: unknown;
  type?: unknown;
  expiration?: unknown;
}

interface RealDebridTorrentSummary {
  id: string;
  hash: string;
  filename: string;
  status: string;
  added?: string;
  links: string[];
}

interface RealDebridTorrentFile {
  id: number;
  path: string;
  bytes: number;
  selected: number;
}

interface RealDebridTorrentInfo extends RealDebridTorrentSummary {
  files: RealDebridTorrentFile[];
  bytes?: number;
}

interface ResolvedRealDebridFile {
  file: RealDebridTorrentFile;
  restrictedLink: string;
}

export interface ResolvedRealDebridDownload {
  url: string;
  filename: string;
  sizeBytes?: number;
  episodeNumber?: number;
}

export class RealDebridService {
  private torrentIndexCache?: { expiresAt: number; torrents: RealDebridTorrentSummary[] };

  constructor(
    private readonly getApiToken: () => Promise<string | undefined>,
    private readonly fetchImpl: FetchLike = electronFetch
  ) {}

  clearCachedAccountData(): void {
    this.torrentIndexCache = undefined;
  }

  async getConnectionStatus(): Promise<RealDebridConnectionStatus> {
    try {
      const user = await this.fetchJson<RealDebridUser>("/user", { method: "GET" });
      const username = typeof user.username === "string" ? cleanText(user.username, 100) : undefined;
      const accountType = typeof user.type === "string" ? cleanText(user.type, 30) : undefined;
      const premiumUntil = typeof user.expiration === "string" ? user.expiration : undefined;
      return { connected: true, username, accountType, premiumUntil };
    } catch (error) {
      return {
        connected: false,
        message: errorMessage(error)
      };
    }
  }

  async getVerifiedCachedSources(request: VerifyCachedSourcesRequest): Promise<TorrentSource[]> {
    validateVerificationRequest(request);
    const downloadingSeason = request.media.mediaType === "series" && request.episode === undefined;
    const providerClaimed = request.sources
      .filter((source) => source.providerClaimedCached && (!downloadingSeason || source.isSeasonPack === true))
      .map((source): TorrentSource => ({
        ...source,
        cacheStatus: "provider-claimed-cached",
        realDebridTorrentId: undefined,
        realDebridFileId: undefined,
        verifiedAt: undefined
      }));
    const downloaded = await this.listDownloadedTorrents();
    const byHash = new Map<string, RealDebridTorrentSummary[]>();
    for (const torrent of downloaded) {
      const current = byHash.get(torrent.hash) ?? [];
      current.push(torrent);
      byHash.set(torrent.hash, current);
    }

    const matches = request.sources
      .flatMap((source) => {
        const infoHash = normalizeInfoHash(source.infoHash);
        const torrents = byHash.get(infoHash) ?? [];
        return torrents.slice(0, 2).map((torrent) => ({ source, torrent }));
      })
      .slice(0, 100);
    const uniqueTorrentIds = [...new Set(matches.map((match) => match.torrent.id))];
    const loadedInfos = await mapWithConcurrency(uniqueTorrentIds, 4, async (id) => {
      try {
        return [id, await this.getTorrentInfo(id)] as const;
      } catch {
        return undefined;
      }
    });
    const infos = new Map(loadedInfos.filter((entry): entry is readonly [string, RealDebridTorrentInfo] => Boolean(entry)));
    const verifiedAt = new Date().toISOString();
    const verified: TorrentSource[] = [];
    for (const match of matches) {
      try {
        const info = infos.get(match.torrent.id);
        if (!info) {
          continue;
        }
        if (normalizeInfoHash(info.hash) !== normalizeInfoHash(match.source.infoHash) || info.status !== "downloaded") {
          continue;
        }
        const resolved = downloadingSeason
          ? chooseResolvedSeasonFiles(info, request.season!)
          : [chooseResolvedFile(info, request.media, request.season, request.episode, match.source.fileIndex)]
            .filter((entry): entry is ResolvedRealDebridFile => Boolean(entry));
        if (resolved.length === 0 || (downloadingSeason && match.source.isSeasonPack !== true)) {
          continue;
        }
        verified.push({
          ...match.source,
          cacheStatus: "verified-account-cached",
          realDebridTorrentId: info.id,
          realDebridFileId: downloadingSeason ? undefined : resolved[0].file.id,
          verifiedAt
        });
      } catch {
        // Keep the provider claim when account verification is unavailable.
      }
    }
    return deduplicateCachedSources([...providerClaimed, ...verified]);
  }

  async resolveVerifiedDownload(
    source: TorrentSource,
    media: CatalogDetails,
    season?: number,
    episode?: number
  ): Promise<ResolvedRealDebridDownload> {
    const downloads = await this.resolveVerifiedDownloads(source, media, season, episode);
    if (downloads.length !== 1) {
      throw new Error("This selection contains multiple files. Choose a download folder for the entire season.");
    }
    return downloads[0];
  }

  async resolveVerifiedDownloads(
    source: TorrentSource,
    media: CatalogDetails,
    season?: number,
    episode?: number,
    episodes?: number[]
  ): Promise<ResolvedRealDebridDownload[]> {
    validateMediaSelection(media, season, episode);
    if (episodes !== undefined && (media.mediaType !== "series" || episode !== undefined
      || !Array.isArray(episodes) || episodes.length === 0 || episodes.length > 1000
      || episodes.some((value) => !Number.isInteger(value) || value <= 0))) {
      throw new Error("Choose at least one valid episode for this season.");
    }
    const downloadingSeason = media.mediaType === "series" && episode === undefined;
    if (downloadingSeason && source.isSeasonPack !== true) {
      throw new Error("Choose a verified season-pack source to download the entire season.");
    }
    if (source.cacheStatus === "provider-claimed-cached" && source.providerClaimedCached) {
      return this.resolveProviderClaimedDownloads(source, media, season, episode, episodes);
    }
    if (source.cacheStatus === "unknown" && !source.providerClaimedCached) {
      return this.resolveProviderClaimedDownloads(source, media, season, episode, episodes);
    }
    if (
      source.cacheStatus !== "verified-account-cached"
      || !source.realDebridTorrentId
      || (!downloadingSeason && source.realDebridFileId === undefined)
    ) {
      throw new Error("This source has not been verified as cached in your Real-Debrid account.");
    }
    const info = await this.getTorrentInfo(source.realDebridTorrentId);
    if (info.status !== "downloaded" || normalizeInfoHash(info.hash) !== normalizeInfoHash(source.infoHash)) {
      throw new Error("The Real-Debrid torrent is no longer available as a downloaded item.");
    }
    const resolved = downloadingSeason
      ? selectEpisodes(chooseResolvedSeasonFiles(info, season!), episodes)
      : [chooseResolvedFile(info, media, season, episode, source.fileIndex)]
        .filter((entry): entry is ResolvedRealDebridFile => Boolean(entry));
    if (resolved.length === 0 || (!downloadingSeason && resolved[0].file.id !== source.realDebridFileId)) {
      throw new Error("The verified media file is no longer available in this Real-Debrid torrent.");
    }
    return mapWithConcurrency(resolved, 4, (entry) => this.unrestrictFile(entry, source.name));
  }

  private async unrestrictFile(
    resolved: ResolvedRealDebridFile,
    fallbackName: string
  ): Promise<ResolvedRealDebridDownload> {
    const body = new URLSearchParams({ link: resolved.restrictedLink });
    const unrestricted = await this.fetchJson<Record<string, unknown>>("/unrestrict/link", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    const url = typeof unrestricted.download === "string" ? validateDownloadUrl(unrestricted.download) : undefined;
    if (!url) {
      throw new Error("Real-Debrid did not return a valid HTTPS download link.");
    }
    const filename = typeof unrestricted.filename === "string"
      ? sanitizeFilename(unrestricted.filename)
      : sanitizeFilename(resolved.file.path.split("/").pop() ?? fallbackName);
    const filesize = typeof unrestricted.filesize === "number" && unrestricted.filesize >= 0
      ? unrestricted.filesize
      : resolved.file.bytes;
    const resolvedEpisodeNumber = episodeNumber(resolved.file.path);
    return {
      url,
      filename,
      sizeBytes: filesize || undefined,
      ...(resolvedEpisodeNumber !== undefined ? { episodeNumber: resolvedEpisodeNumber } : {})
    };
  }

  private async resolveProviderClaimedDownloads(
    source: TorrentSource,
    media: CatalogDetails,
    season: number | undefined,
    episode: number | undefined,
    episodes?: number[]
  ): Promise<ResolvedRealDebridDownload[]> {
    validateMediaSelection(media, season, episode);
    const body = new URLSearchParams({ magnet: buildSanitizedMagnetUri(source) });
    const added = await this.fetchJson<Record<string, unknown>>("/torrents/addMagnet", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    const torrentId = typeof added.id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(added.id)
      ? added.id
      : undefined;
    if (!torrentId) {
      throw new Error("Real-Debrid did not return a valid torrent identifier.");
    }

    this.torrentIndexCache = undefined;
    try {
      const pendingInfo = await this.waitForTorrentInfo(
        torrentId,
        (info) => info.files.length > 0,
        "Real-Debrid did not finish reading the provider-cached torrent."
      );
      if (normalizeInfoHash(pendingInfo.hash) !== normalizeInfoHash(source.infoHash)) {
        throw new Error("Real-Debrid returned a different torrent than the requested provider-cached source.");
      }
      const downloadingSeason = media.mediaType === "series" && episode === undefined;
      const candidates = downloadingSeason
        ? selectEpisodes(chooseSeasonCandidateFiles(pendingInfo, season!), episodes)
        : [chooseCandidateFile(pendingInfo, media, season, episode, source.fileIndex)]
          .filter((entry): entry is RealDebridTorrentFile => Boolean(entry));
      if (candidates.length === 0) {
        throw new Error("No matching video file was found in the provider-cached torrent.");
      }

      const selectBody = new URLSearchParams({ files: candidates.map((candidate) => candidate.id).join(",") });
      await this.fetchJson<void>(`/torrents/selectFiles/${encodeURIComponent(torrentId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: selectBody.toString()
      });

      const downloadedInfo = await this.waitForTorrentInfo(
        torrentId,
        (info) => info.status === "downloaded",
        "The provider cache claim is stale; Real-Debrid could not make the file available immediately."
      );
      if (normalizeInfoHash(downloadedInfo.hash) !== normalizeInfoHash(source.infoHash)) {
        throw new Error("Real-Debrid returned a different torrent than the requested provider-cached source.");
      }
      const resolved = downloadingSeason
        ? selectEpisodes(chooseResolvedSeasonFiles(downloadedInfo, season!), episodes)
        : [chooseResolvedFile(downloadedInfo, media, season, episode, source.fileIndex)]
          .filter((entry): entry is ResolvedRealDebridFile => Boolean(entry));
      const selectedIds = new Set(candidates.map((candidate) => candidate.id));
      if (resolved.length !== candidates.length || resolved.some((entry) => !selectedIds.has(entry.file.id))) {
        throw new Error("The selected media file was not available after Real-Debrid resolved the torrent.");
      }
      this.torrentIndexCache = undefined;
      return mapWithConcurrency(resolved, 4, (entry) => this.unrestrictFile(entry, source.name));
    } catch (error) {
      await this.deleteTorrent(torrentId);
      throw error;
    }
  }

  private async waitForTorrentInfo(
    id: string,
    ready: (info: RealDebridTorrentInfo) => boolean,
    timeoutMessage: string
  ): Promise<RealDebridTorrentInfo> {
    let lastStatus = "unknown";
    for (let attempt = 0; attempt < TORRENT_RESOLUTION_ATTEMPTS; attempt += 1) {
      const info = await this.getTorrentInfo(id);
      lastStatus = info.status;
      if (ready(info)) {
        return info;
      }
      if (TERMINAL_TORRENT_STATUSES.has(info.status)) {
        break;
      }
      if (attempt + 1 < TORRENT_RESOLUTION_ATTEMPTS) {
        await delay(TORRENT_RESOLUTION_POLL_MS);
      }
    }
    throw new Error(`${timeoutMessage} Last status: ${cleanText(lastStatus, 60)}.`);
  }

  private async deleteTorrent(id: string): Promise<void> {
    try {
      await this.fetchJson<void>(`/torrents/delete/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {
      // Best-effort cleanup must not replace the original resolution error.
    } finally {
      this.torrentIndexCache = undefined;
    }
  }

  private async listDownloadedTorrents(): Promise<RealDebridTorrentSummary[]> {
    if (this.torrentIndexCache && this.torrentIndexCache.expiresAt > Date.now()) {
      return this.torrentIndexCache.torrents;
    }
    const value = await this.fetchJson<unknown>("/torrents?limit=5000", { method: "GET" });
    const torrents = Array.isArray(value)
      ? value.flatMap((raw) => {
        const torrent = normalizeTorrentSummary(raw);
        return torrent?.status === "downloaded" && torrent.links.length > 0 ? [torrent] : [];
      })
      : [];
    this.torrentIndexCache = { torrents, expiresAt: Date.now() + TORRENT_INDEX_TTL_MS };
    return torrents;
  }

  private async getTorrentInfo(id: string): Promise<RealDebridTorrentInfo> {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) {
      throw new Error("Invalid Real-Debrid torrent identifier.");
    }
    const raw = await this.fetchJson<unknown>(`/torrents/info/${encodeURIComponent(id)}`, { method: "GET" });
    const summary = normalizeTorrentSummary(raw);
    if (!summary || !raw || typeof raw !== "object") {
      throw new Error("Real-Debrid returned invalid torrent information.");
    }
    const filesValue = (raw as { files?: unknown }).files;
    const files = Array.isArray(filesValue)
      ? filesValue.flatMap((file) => {
        if (!file || typeof file !== "object") {
          return [];
        }
        const value = file as Record<string, unknown>;
        return typeof value.id === "number"
          && Number.isInteger(value.id)
          && typeof value.path === "string"
          && typeof value.bytes === "number"
          && (value.selected === 0 || value.selected === 1)
          ? [{
            id: value.id,
            path: cleanPath(value.path),
            bytes: Math.max(0, value.bytes),
            selected: value.selected
          }]
          : [];
      })
      : [];
    return { ...summary, files };
  }

  private async fetchJson<T>(path: string, init: RequestInit): Promise<T> {
    const token = await this.getApiToken();
    if (!token) {
      throw new Error("Real-Debrid API token is missing. Add it in Discovery settings.");
    }
    return withTimeout(REQUEST_TIMEOUT_MS, async (signal) => {
      const response = await this.fetchImpl(`${REAL_DEBRID_BASE_URL}${path}`, {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        },
        signal,
        redirect: "error"
      });
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Real-Debrid rejected the API token.");
        }
        if (response.status === 403) {
          throw new Error("Real-Debrid denied this action. Check account and premium status.");
        }
        if (response.status === 429) {
          throw new Error("Real-Debrid rate limit reached. Try again shortly.");
        }
        throw new Error(`Real-Debrid request failed with HTTP ${response.status}.`);
      }
      if (response.status === 204) {
        return undefined as T;
      }
      return readBoundedJson<T>(response, { maximumBytes: 5 * 1024 * 1024, provider: "Real-Debrid" });
    }, "Real-Debrid request timed out.");
  }
}

function chooseResolvedFile(
  info: RealDebridTorrentInfo,
  media: CatalogDetails,
  season: number | undefined,
  episode: number | undefined,
  fileIndex: number | undefined
): ResolvedRealDebridFile | undefined {
  const selectedFiles = info.files.filter((file) => file.selected === 1);
  const linked = selectedFiles.flatMap((file, index) => {
    const link = info.links[index];
    return link && isRestrictedLink(link) ? [{ file, restrictedLink: link }] : [];
  });
  if (linked.length === 0) {
    return undefined;
  }

  if (fileIndex !== undefined) {
    const indexedFile = info.files[fileIndex];
    const exact = indexedFile && linked.find((entry) => entry.file.id === indexedFile.id);
    if (exact && isVideoFile(exact.file.path) && !isExcludedExtra(exact.file.path)) {
      return exact;
    }
  }

  if (media.mediaType === "series" && season !== undefined && episode !== undefined) {
    const marker = new RegExp(`\\bS0*${season}[^A-Za-z0-9]*E0*${episode}\\b`, "i");
    const episodeMatch = linked
      .filter((entry) => isVideoFile(entry.file.path) && marker.test(entry.file.path))
      .sort((left, right) => right.file.bytes - left.file.bytes)[0];
    return episodeMatch;
  }

  return linked
    .filter((entry) => isVideoFile(entry.file.path) && !isExcludedExtra(entry.file.path))
    .sort((left, right) => right.file.bytes - left.file.bytes)[0];
}

function chooseResolvedSeasonFiles(
  info: RealDebridTorrentInfo,
  season: number
): ResolvedRealDebridFile[] {
  const selectedFiles = info.files.filter((file) => file.selected === 1);
  const linked = selectedFiles.flatMap((file, index) => {
    const link = info.links[index];
    return link && isRestrictedLink(link) ? [{ file, restrictedLink: link }] : [];
  });
  return sortSeasonEntries(linked.filter((entry) => fileBelongsToSeason(entry.file.path, season)));
}

function chooseCandidateFile(
  info: RealDebridTorrentInfo,
  media: CatalogDetails,
  season: number | undefined,
  episode: number | undefined,
  fileIndex: number | undefined
): RealDebridTorrentFile | undefined {
  if (fileIndex !== undefined) {
    const exact = info.files[fileIndex];
    if (exact && isVideoFile(exact.path) && !isExcludedExtra(exact.path)) {
      return exact;
    }
  }

  if (media.mediaType === "series" && season !== undefined && episode !== undefined) {
    const marker = new RegExp(`\\bS0*${season}[^A-Za-z0-9]*E0*${episode}\\b`, "i");
    return info.files
      .filter((file) => isVideoFile(file.path) && marker.test(file.path))
      .sort((left, right) => right.bytes - left.bytes)[0];
  }

  return info.files
    .filter((file) => isVideoFile(file.path) && !isExcludedExtra(file.path))
    .sort((left, right) => right.bytes - left.bytes)[0];
}

function chooseSeasonCandidateFiles(info: RealDebridTorrentInfo, season: number): RealDebridTorrentFile[] {
  return sortSeasonEntries(info.files.filter((file) => fileBelongsToSeason(file.path, season)));
}

function fileBelongsToSeason(path: string, season: number): boolean {
  if (!isVideoFile(path) || isExcludedExtra(path)) {
    return false;
  }
  const episodeMarkers = [
    ...path.matchAll(/\bS(\d{1,2})[\s._-]*E(\d{1,3})\b/gi),
    ...path.matchAll(/\b(\d{1,2})x(\d{1,3})\b/gi)
  ];
  if (episodeMarkers.length > 0) {
    return episodeMarkers.some((match) => Number(match[1]) === season);
  }
  return [...path.matchAll(/(?:^|[\\/])(?:season[\s._-]*(\d{1,2})|S(\d{1,2}))(?:[\\/])/gi)]
    .some((match) => Number(match[1] ?? match[2]) === season);
}

function sortSeasonEntries<T extends { file?: RealDebridTorrentFile; path?: string }>(entries: T[]): T[] {
  return [...entries].sort((left, right) => {
    const leftPath = left.file?.path ?? left.path ?? "";
    const rightPath = right.file?.path ?? right.path ?? "";
    const leftEpisode = episodeNumber(leftPath) ?? Number.MAX_SAFE_INTEGER;
    const rightEpisode = episodeNumber(rightPath) ?? Number.MAX_SAFE_INTEGER;
    return leftEpisode - rightEpisode || leftPath.localeCompare(rightPath, undefined, { numeric: true });
  });
}

function episodeNumber(path: string): number | undefined {
  const match = path.match(/\bS\d{1,2}[\s._-]*E(\d{1,3})\b/i) ?? path.match(/\b\d{1,2}x(\d{1,3})\b/i);
  return match ? Number(match[1]) : undefined;
}

function normalizeTorrentSummary(raw: unknown): RealDebridTorrentSummary | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const value = raw as Record<string, unknown>;
  if (
    typeof value.id !== "string"
    || typeof value.hash !== "string"
    || typeof value.filename !== "string"
    || typeof value.status !== "string"
    || !Array.isArray(value.links)
  ) {
    return undefined;
  }
  try {
    return {
      id: value.id.slice(0, 100),
      hash: normalizeInfoHash(value.hash),
      filename: cleanText(value.filename, 500),
      status: value.status,
      added: typeof value.added === "string" ? value.added : undefined,
      links: value.links.filter((link): link is string => typeof link === "string" && isRestrictedLink(link))
    };
  } catch {
    return undefined;
  }
}

function validateVerificationRequest(request: VerifyCachedSourcesRequest): void {
  validateMediaSelection(request.media, request.season, request.episode);
  if (request.sources.length > 1_000) {
    throw new Error("Too many sources were supplied for Real-Debrid verification.");
  }
}

function validateMediaSelection(
  media: CatalogDetails,
  season: number | undefined,
  episode: number | undefined
): void {
  if (media.mediaType === "series") {
    if (!Number.isInteger(season) || season! < 0) {
      throw new Error("Choose a valid season before checking Real-Debrid.");
    }
    if (episode !== undefined && (!Number.isInteger(episode) || episode <= 0)) {
      throw new Error("Choose a valid episode before checking Real-Debrid.");
    }
  }
}

function deduplicateCachedSources(sources: TorrentSource[]): TorrentSource[] {
  const map = new Map<string, TorrentSource>();
  for (const source of sources) {
    map.set(`${source.infoHash}:${source.fileIndex ?? ""}`, source);
  }
  return [...map.values()];
}

function isRestrictedLink(value: string): boolean {
  return parsePublicHttpsUrl(value) !== undefined;
}

function validateDownloadUrl(value: string): string | undefined {
  return parsePublicHttpsUrl(value)?.toString();
}

function sanitizeFilename(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 220);
  return cleaned || "real-debrid-download.bin";
}

function cleanPath(value: string): string {
  return value.replace(/[\r\n\0]/g, "").slice(0, 2_000);
}

function isVideoFile(path: string): boolean {
  return VIDEO_EXTENSION.test(path);
}

function isExcludedExtra(path: string): boolean {
  return /(?:^|[\\/._ -])(sample|trailer|featurette|extras?)(?:[\\/._ -]|$)/i.test(path);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function selectEpisodes<T extends { file?: RealDebridTorrentFile; path?: string }>(
  entries: T[], episodes?: number[]
): T[] {
  if (episodes === undefined) return entries;
  const selected = entries.filter((entry) => episodes.includes(episodeNumber(entry.file?.path ?? entry.path ?? "") ?? -1));
  const available = new Set(selected.map((entry) => episodeNumber(entry.file?.path ?? entry.path ?? "")));
  const missing = episodes.filter((episode) => !available.has(episode));
  if (missing.length > 0) {
    throw new Error(`This source is missing selected episodes: ${missing.join(", ")}. Choose another season pack.`);
  }
  return selected;
}
