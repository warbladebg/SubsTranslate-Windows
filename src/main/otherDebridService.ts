import { parsePublicHttpsUrl } from "./publicHttpsUrl";
import { readBoundedJson } from "./boundedResponse";
import { withTimeout } from "../core/async/withTimeout";
import { mapWithConcurrency } from "../core/async/mapWithConcurrency";
import { debridProviderName, type CatalogDetails, type OtherDebridProvider, type RealDebridConnectionStatus, type TorrentSource } from "../core/discovery/DiscoveryTypes";
import { buildSanitizedMagnetUri, normalizeInfoHash } from "../core/discovery/MagnetLinks";
import { electronFetch } from "./electronFetch";
import type { ResolvedRealDebridDownload } from "./realDebridService";
import { errorMessage } from "../core/util/errors";

export type { OtherDebridProvider };
type FetchLike = typeof fetch;
// Provider responses are untyped JSON that is narrowed field by field where it is read.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
type FileCandidate = { path: string; size?: number; url?: string; id?: number };

const API_ORIGINS: Record<OtherDebridProvider, string> = {
  "all-debrid": "https://api.alldebrid.com",
  premiumize: "https://www.premiumize.me",
  torbox: "https://api.torbox.app",
  "debrid-link": "https://debrid-link.com"
};
const VIDEO_EXT = /\.(mkv|mp4|avi|webm|m4v|mov|ts)$/i;

export class OtherDebridService {
  constructor(
    private readonly getToken: (provider: OtherDebridProvider) => Promise<string | undefined>,
    private readonly fetchImpl: FetchLike = electronFetch
  ) {}

  async getConnectionStatus(provider: OtherDebridProvider, overrideToken?: string): Promise<RealDebridConnectionStatus> {
    try {
      const value = provider === "all-debrid"
        ? await this.request(provider, "/v4/user", {}, overrideToken)
        : provider === "premiumize"
          ? await this.request(provider, "/api/account/info", {}, overrideToken)
          : provider === "torbox"
            ? await this.request(provider, "/v1/api/user/me", {}, overrideToken)
            : await this.request(provider, "/api/v2/account/infos", {}, overrideToken);
      const user = provider === "all-debrid" ? value.data?.user : provider === "torbox" ? value.data : provider === "debrid-link" ? value.value : value;
      const name = user?.username ?? user?.email ?? user?.customer_id;
      return { connected: true, username: typeof name === "string" ? name.slice(0, 100) : undefined,
        accountType: provider === "premiumize" ? "Premiumize" : undefined };
    } catch (error) {
      return { connected: false, message: safeError(error) };
    }
  }

  async checkCachedSources(provider: OtherDebridProvider, sources: TorrentSource[]): Promise<TorrentSource[]> {
    const candidates = sources.slice(0, 100).filter((source) => {
      try { normalizeInfoHash(source.infoHash); return true; } catch { return false; }
    });
    // Neither API has a non-mutating global hash lookup. Verify one selected hash
    // at download time instead of adding every search result to the user's cloud.
    if (provider === "debrid-link" || provider === "all-debrid") return candidates;
    if (provider === "premiumize") {
      const body = new URLSearchParams();
      candidates.forEach((source) => body.append("items[]", buildSanitizedMagnetUri(source)));
      const data = await this.request(provider, "/api/cache/check", { method: "POST", body });
      return candidates.filter((_, index) => data.response?.[index] === true);
    }
    const body = JSON.stringify({ hashes: candidates.map((source) => source.infoHash) });
    const data = await this.request(provider, "/v1/api/torrents/checkcached?format=object", {
      method: "POST", headers: { "Content-Type": "application/json" }, body
    });
    return candidates.filter((source) => {
      const item = Array.isArray(data.data)
        ? data.data.find((entry: Json) => String(entry.hash).toLowerCase() === source.infoHash)
        : data.data?.[source.infoHash] ?? data.data?.[source.infoHash.toUpperCase()];
      return item === true || (item && String(item.hash).toLowerCase() === source.infoHash);
    });
  }

  async resolveCachedDownloads(
    provider: OtherDebridProvider,
    source: TorrentSource,
    media: CatalogDetails,
    season?: number,
    episode?: number,
    episodes?: number[]
  ): Promise<ResolvedRealDebridDownload[]> {
    const hash = normalizeInfoHash(source.infoHash);
    const cached = await this.checkCachedSources(provider, [source]);
    if (!cached.length) throw new Error(`${debridProviderName(provider)} no longer has this torrent cached.`);
    const magnet = buildSanitizedMagnetUri(source);
    let files: FileCandidate[];
    if (provider === "premiumize") {
      const data = await this.request(provider, "/api/transfer/directdl", {
        method: "POST", body: new URLSearchParams({ src: magnet })
      });
      files = (Array.isArray(data.content) ? data.content : []).map((entry: Json) => ({
        path: String(entry.path ?? ""), size: entry.size, url: entry.link
      }));
    } else if (provider === "all-debrid") {
      const added = await this.request(provider, "/v4/magnet/upload", {
        method: "POST", body: new URLSearchParams({ "magnets[]": magnet })
      });
      const item = added.data?.magnets?.[0];
      if (!item?.ready || !item.id || String(item.hash).toLowerCase() !== hash) {
        throw new Error("AllDebrid did not confirm that this torrent is ready.");
      }
      const listed = await this.request(provider, "/v4/magnet/files", {
        method: "POST", body: new URLSearchParams({ "id[]": String(item.id) })
      });
      files = flattenAllDebridFiles(listed.data?.magnets?.[0]?.files);
    } else if (provider === "debrid-link") {
      const list = await this.request(provider, "/api/v2/seedbox/list?perPage=100", {});
      let item = (Array.isArray(list.value) ? list.value : []).find((entry: Json) =>
        String(entry.hashString).toLowerCase() === hash && entry.downloadPercent === 100);
      if (!item) {
        const added = await this.request(provider, "/api/v2/seedbox/add", {
          method: "POST", body: new URLSearchParams({ url: hash })
        });
        item = added.value;
      }
      if (!item) throw new Error("Debrid-Link no longer has this torrent ready in your account.");
      if (String(item.hashString).toLowerCase() !== hash || item.downloadPercent !== 100) {
        throw new Error("Debrid-Link did not confirm that this torrent is cached and ready.");
      }
      files = (Array.isArray(item.files) ? item.files : []).filter((entry: Json) => entry.downloadPercent === 100)
        .map((entry: Json) => ({ path: String(entry.name ?? ""), size: entry.size, url: entry.downloadUrl }));
    } else {
      const form = new FormData();
      form.set("magnet", magnet);
      form.set("add_only_if_cached", "true");
      const added = await this.request(provider, "/v1/api/torrents/createtorrent", { method: "POST", body: form });
      const torrentId = Number(added.data?.torrent_id);
      if (!Number.isSafeInteger(torrentId)) throw new Error("TorBox did not return a torrent ID.");
      const list = await this.request(provider, `/v1/api/torrents/mylist?id=${torrentId}&bypass_cache=true`, {});
      const item = Array.isArray(list.data) ? list.data.find((entry: Json) => entry.id === torrentId) : list.data;
      if (!item || String(item.hash).toLowerCase() !== hash || !item.download_finished) {
        throw new Error("TorBox did not confirm that this torrent is ready.");
      }
      files = (Array.isArray(item.files) ? item.files : []).filter((entry: Json) => entry.infected !== true)
        .map((entry: Json) => ({
        path: String(entry.name ?? entry.short_name ?? ""), size: entry.size, id: entry.id
        }));
      const selected = selectMediaFiles(files, media, season, episode, episodes, source.fileIndex);
      return mapWithConcurrency(selected, 4, async (file) => {
        if (!Number.isSafeInteger(file.id)) throw new Error("TorBox did not identify a media file.");
        const token = await this.requiredToken(provider);
        const query = new URLSearchParams({ token, torrent_id: String(torrentId), file_id: String(file.id) });
        const result = await this.request(provider, `/v1/api/torrents/requestdl?${query}`, {});
        return resolvedFile(file, result.data);
      });
    }
    const selected = selectMediaFiles(files, media, season, episode, episodes, source.fileIndex);
    if (provider === "all-debrid") {
      return mapWithConcurrency(selected, 4, async (file) => {
        const result = await this.request(provider, "/v4/link/unlock", {
          method: "POST", body: new URLSearchParams({ link: file.url! })
        });
        return resolvedFile(file, result.data?.link);
      });
    }
    return selected.map((file) => resolvedFile(file, file.url));
  }

  private async requiredToken(provider: OtherDebridProvider, override?: string): Promise<string> {
    const token = override ?? await this.getToken(provider);
    if (!token || token.length > 1_000 || /[\r\n\0]/.test(token)) {
      throw new Error(`${debridProviderName(provider)} API key is missing or invalid.`);
    }
    return token;
  }

  private async request(provider: OtherDebridProvider, path: string, init: RequestInit, overrideToken?: string): Promise<Json> {
    const token = await this.requiredToken(provider, overrideToken);
    return withTimeout(20_000, async (signal) => {
      const response = await this.fetchImpl(`${API_ORIGINS[provider]}${path}`, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${token}`, Accept: "application/json" },
        redirect: "error", signal
      });
      if (!response.ok) throw new Error(`${debridProviderName(provider)} returned HTTP ${response.status}.`);
      const data = await readBoundedJson<Json>(response, { maximumBytes: 5 * 1024 * 1024, provider: debridProviderName(provider) });
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(`${debridProviderName(provider)} returned an invalid response.`);
      if (data.success === false || data.status === "error") {
        throw new Error(`${debridProviderName(provider)} rejected the request: ${safeError(data.error?.message ?? data.detail ?? data.error ?? "unknown error")}`);
      }
      return data;
    }, `${debridProviderName(provider)} request timed out.`);
  }
}

function flattenAllDebridFiles(value: unknown, prefix = ""): FileCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry.n !== "string") return [];
    const path = prefix ? `${prefix}/${entry.n}` : entry.n;
    return Array.isArray(entry.e)
      ? flattenAllDebridFiles(entry.e, path)
      : [{ path, size: entry.s, url: entry.l }];
  });
}

function selectMediaFiles(files: FileCandidate[], media: CatalogDetails, season?: number, episode?: number,
  episodes?: number[], fileIndex?: number): FileCandidate[] {
  const videos = files.filter((file) => VIDEO_EXT.test(file.path) && !/\b(sample|trailer|featurette|extras?)\b/i.test(file.path));
  if (media.mediaType === "series") {
    if (!Number.isInteger(season) || season! < 0) throw new Error("Choose a valid season.");
    const matching = videos.filter((file) => {
      const marker = file.path.match(/\bS(\d{1,2})[\s._-]*E(\d{1,3})\b/i);
      return marker && Number(marker[1]) === season && (episode === undefined || Number(marker[2]) === episode)
        && (episodes === undefined || episodes.includes(Number(marker[2])));
    });
    if (!matching.length) throw new Error("No matching video files were found in this cached torrent.");
    if (episode === undefined && episodes !== undefined && new Set(matching.map((file) => episodeNumber(file.path))).size !== episodes.length) {
      throw new Error("The cached torrent does not contain every selected episode.");
    }
    return episode === undefined ? matching.sort((a, b) => (episodeNumber(a.path) ?? 0) - (episodeNumber(b.path) ?? 0))
      : [matching.sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0]];
  }
  const indexed = fileIndex !== undefined ? files[fileIndex] : undefined;
  const selected = indexed && videos.includes(indexed) ? indexed : videos.sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0];
  if (!selected) throw new Error("No video file was found in this cached torrent.");
  return [selected];
}

function resolvedFile(file: FileCandidate, rawUrl: unknown): ResolvedRealDebridDownload {
  if (typeof rawUrl !== "string") throw new Error("The debrid service did not return a download link.");
  const url = parsePublicHttpsUrl(rawUrl);
  if (!url) {
    throw new Error("The debrid service returned an unsafe download link.");
  }
  const filename = file.path.split(/[\\/]/).pop()?.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 220) ?? "video.mkv";
  return { url: url.toString(), filename, sizeBytes: file.size, episodeNumber: episodeNumber(file.path) };
}

function episodeNumber(path: string): number | undefined {
  const marker = path.match(/\bS\d{1,2}[\s._-]*E(\d{1,3})\b/i);
  return marker ? Number(marker[1]) : undefined;
}

function safeError(error: unknown): string {
  return errorMessage(error).replace(/https?:\/\/\S+/g, "[URL]").slice(0, 300);
}
