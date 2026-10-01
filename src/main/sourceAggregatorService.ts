import type {
  DiscoveryPreferences,
  SourceSearchRequest,
  SourceSearchResult,
  TorrentSource
} from "../core/discovery/DiscoveryTypes";
import { parseStremioStream, rankTorrentSources, type StremioStream } from "../core/discovery/ReleaseParser";
import { sortTorrentSources } from "../core/discovery/TorrentSourceSorting";
import { electronFetch } from "./electronFetch";
import { readBoundedText } from "./boundedResponse";
import { withTimeout } from "../core/async/withTimeout";
import { errorMessage } from "../core/util/errors";

const PROVIDER_TIMEOUT_MS = 12_000;
// Comet's documented default live scrape budget is 30 seconds, plus response assembly.
const COMET_TIMEOUT_MS = 40_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const SOURCE_CACHE_TTL_MS = 5 * 60 * 1_000;
const MAX_SOURCE_CACHE_ENTRIES = 100;

type FetchLike = typeof fetch;

interface StremioResponse {
  streams?: unknown;
}

export interface SourceAggregationRequest extends SourceSearchRequest {
  preferences: DiscoveryPreferences;
  realDebridApiToken?: string;
}

export interface SourceProvider {
  id?: DiscoveryPreferences["sourceProvider"];
  name: string;
  baseUrl: string;
}

export const BUILT_IN_SOURCE_PROVIDERS: readonly Readonly<SourceProvider>[] = Object.freeze([
  Object.freeze({
    id: "torrentio",
    name: "Torrentio",
    baseUrl: "https://torrentio.strem.fun"
  }),
  Object.freeze({
    id: "comet",
    name: "Comet",
    baseUrl: "https://comet.feels.legal"
  }),
  Object.freeze({
    id: "mediafusion",
    name: "MediaFusion",
    baseUrl: "https://mediafusionfortheweebs.midnightignite.me"
  })
]);

interface CachedProviderSources {
  expiresAt: number;
  sources: TorrentSource[];
}

export class SourceAggregatorService {
  private readonly providers: SourceProvider[];
  private readonly sourceCache = new Map<string, CachedProviderSources>();

  constructor(
    private readonly fetchImpl: FetchLike = electronFetch,
    providers: readonly Readonly<SourceProvider>[] = BUILT_IN_SOURCE_PROVIDERS
  ) {
    this.providers = providers.map(normalizeProvider);
  }

  async search(request: SourceAggregationRequest): Promise<SourceSearchResult> {
    validateSearchRequest(request);
    if (request.episodes !== undefined) {
      if (request.media.mediaType !== "series" || request.episode !== undefined
        || !Array.isArray(request.episodes) || request.episodes.length === 0 || request.episodes.length > 1000
        || request.episodes.some((episode) => !Number.isInteger(episode) || episode <= 0)) {
        throw new Error("Choose valid episodes before searching.");
      }
      const results: SourceSearchResult[] = [];
      for (const episode of [...new Set(request.episodes)].sort((a, b) => a - b)) {
        results.push(await this.search({ ...request, episodes: undefined, episode }));
      }
      // Each episode lookup supplies its actual torrent file index; never infer an index from its episode number.
      const sources = results[0].sources.flatMap((source) => {
        const matches = results.map((result) => result.sources.find((candidate) =>
          candidate.infoHash === source.infoHash && candidate.fileIndex !== undefined));
        if (matches.some((match) => !match)) return [];
        const selectedFileIndices = [...new Set(matches.map((match) => match!.fileIndex!))];
        if (selectedFileIndices.length !== results.length) return [];
        return [{ ...source, selectedFileIndices, isSeasonPack: true }];
      });
      return {
        sources: sortTorrentSources([...new Map(sources.map((source) => [source.infoHash, source])).values()]),
        providerErrors: results.flatMap((result) => result.providerErrors),
        searchedAt: new Date().toISOString()
      };
    }
    const providers = this.providers.filter((provider) => !provider.id || provider.id === (request.preferences.sourceProvider ?? "torrentio"));
    if (providers.length === 0) {
      return {
        sources: [],
        providerErrors: [],
        searchedAt: new Date().toISOString()
      };
    }
    const observedAt = new Date().toISOString();
    const settled = await Promise.all(
      providers.map(async (provider) => {
        try {
          return {
            provider: provider.name,
            sources: await this.searchProvider(provider, request, observedAt)
          };
        } catch (error) {
          return {
            provider: provider.name,
            sources: [] as TorrentSource[],
            error: safeProviderError(error)
          };
        }
      })
    );

    const deduplicated = deduplicateSources(settled.flatMap((result) => result.sources));
    return {
      sources: rankTorrentSources(deduplicated, request.preferences),
      providerErrors: settled.flatMap((result) => result.error
        ? [{ provider: result.provider, message: result.error }]
        : []),
      searchedAt: observedAt
    };
  }

  clearCache(): void {
    this.sourceCache.clear();
  }

  private async searchProvider(
    provider: SourceProvider,
    request: SourceAggregationRequest,
    observedAt: string
  ): Promise<TorrentSource[]> {
    const mediaId = sourceMediaId(request);
    const sourceType = request.media.mediaType === "movie" ? "movie" : "series";
    const providerConfig = provider.id === "torrentio"
      ? torrentioProviderConfig(request.realDebridApiToken)
      : provider.id === "comet"
        ? cometProviderConfig(request.realDebridApiToken)
        : "";
    const configuredPath = providerConfig ? `/${providerConfig}` : "";
    const url = new URL(`${provider.baseUrl}${configuredPath}/stream/${sourceType}/${mediaId}.json`);
    const cacheKey = `${provider.name}\0${url.toString()}`;
    const cached = this.getCachedSources(cacheKey);
    if (cached) {
      return cached;
    }
    const timeoutMs = provider.id === "comet" ? COMET_TIMEOUT_MS : PROVIDER_TIMEOUT_MS;
    return withTimeout(timeoutMs, async (signal) => {
      const response = await this.fetchImpl(url, {
        headers: { Accept: "application/json" },
        signal,
        redirect: "error"
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const text = await readBoundedText(response, MAX_RESPONSE_BYTES, "response exceeded the size limit");
      const value = parseStremioResponse(text);
      if (!Array.isArray(value.streams)) {
        throw new Error("response did not contain a streams array");
      }
      const sources = value.streams
        .slice(0, 1_000)
        .flatMap((stream) => {
          const parsed = parseStremioStream(stream as StremioStream, provider.name, observedAt);
          return parsed && matchesRequestedMedia(parsed, request) ? [parsed] : [];
        });
      if (sources.length > 0) {
        this.cacheSources(cacheKey, sources);
      }
      return cloneSources(sources);
    }, "request timed out");
  }

  private getCachedSources(key: string): TorrentSource[] | undefined {
    const cached = this.sourceCache.get(key);
    if (!cached) {
      return undefined;
    }
    if (cached.expiresAt <= Date.now()) {
      this.sourceCache.delete(key);
      return undefined;
    }
    this.sourceCache.delete(key);
    this.sourceCache.set(key, cached);
    return cloneSources(cached.sources);
  }

  private cacheSources(key: string, sources: TorrentSource[]): void {
    this.sourceCache.delete(key);
    while (this.sourceCache.size >= MAX_SOURCE_CACHE_ENTRIES) {
      const oldestKey = this.sourceCache.keys().next().value as string | undefined;
      if (!oldestKey) {
        break;
      }
      this.sourceCache.delete(oldestKey);
    }
    this.sourceCache.set(key, {
      expiresAt: Date.now() + SOURCE_CACHE_TTL_MS,
      sources: cloneSources(sources)
    });
  }
}

function torrentioProviderConfig(realDebridApiToken: string | undefined): string {
  const token = realDebridApiToken?.trim();
  if (!token) {
    return "";
  }
  if (token.length > 1_000 || /[\r\n\0]/.test(token)) {
    throw new Error("Real-Debrid credential is invalid.");
  }
  return `sort=qualitysize|realdebrid=${encodeURIComponent(token)}`;
}

function cometProviderConfig(realDebridApiToken: string | undefined): string {
  const token = realDebridApiToken?.trim();
  if (!token) return "";
  if (token.length > 1_000 || /[\r\n\0]/.test(token)) {
    throw new Error("Real-Debrid credential is invalid.");
  }
  return Buffer.from(JSON.stringify({
    debridServices: [{ service: "realdebrid", apiKey: token }],
    enableTorrent: true
  }), "utf8").toString("base64");
}

function validateSearchRequest(request: SourceSearchRequest): void {
  if (!/^tt\d{5,12}$/.test(request.media.imdbId ?? "")) {
    throw new Error("This title has no valid IMDb identifier, so torrent sources cannot be matched safely.");
  }
  if (request.media.mediaType === "series") {
    if (!Number.isInteger(request.season) || request.season! < 0) {
      throw new Error("Choose a valid season before finding sources.");
    }
    if (request.episode !== undefined && (!Number.isInteger(request.episode) || request.episode <= 0)) {
      throw new Error("Choose a valid episode before finding sources.");
    }
  }
}

function sourceMediaId(request: SourceSearchRequest): string {
  if (request.media.mediaType === "movie") {
    return request.media.imdbId!;
  }
  return `${request.media.imdbId}:${request.season}:${request.episode ?? 1}`;
}

function matchesRequestedMedia(source: TorrentSource, request: SourceSearchRequest): boolean {
  const text = `${source.name} ${source.description ?? ""}`;
  if (/\b(sample|trailer|featurette|extras?)\b/i.test(text)) {
    return false;
  }
  if (request.media.mediaType === "movie") {
    return true;
  }
  if (request.episode === undefined) {
    return source.isSeasonPack === true && seasonPackIncludesSeason(text, request.season!);
  }
  const episodeMarkers = [...text.matchAll(/\bS(\d{1,2})[\s._-]*E(\d{1,3})\b|\b(\d{1,2})x(\d{1,3})\b/gi)];
  if (episodeMarkers.length === 0) {
    return source.fileIndex !== undefined;
  }
  return episodeMarkers.some((match) =>
    Number(match[1] ?? match[3]) === request.season && Number(match[2] ?? match[4]) === request.episode
  );
}

function seasonPackIncludesSeason(text: string, season: number): boolean {
  const rangePatterns = [
    /\bS(\d{1,2})\s*[-–]\s*S?(\d{1,2})\b/gi,
    /\bseasons?\s*(\d{1,2})\s*[-–]\s*(\d{1,2})\b/gi,
    /\b(\d{1,2})\s*[-–]\s*(\d{1,2})\s*seasons?\b/gi
  ];
  for (const pattern of rangePatterns) {
    for (const match of text.matchAll(pattern)) {
      const start = Number(match[1]);
      const end = Number(match[2]);
      if (season >= Math.min(start, end) && season <= Math.max(start, end)) {
        return true;
      }
    }
  }
  return [...text.matchAll(/\bS(\d{1,2})\b|\bseason[\s._-]*(\d{1,2})\b/gi)]
    .some((match) => Number(match[1] ?? match[2]) === season);
}

function deduplicateSources(sources: TorrentSource[]): TorrentSource[] {
  const deduplicated = new Map<string, TorrentSource>();
  for (const source of sources) {
    const key = `${source.infoHash}:${source.fileIndex ?? ""}`;
    const existing = deduplicated.get(key);
    if (!existing || sourceRichness(source) > sourceRichness(existing)) {
      deduplicated.set(key, source);
    }
  }
  return [...deduplicated.values()];
}

function sourceRichness(source: TorrentSource): number {
  return [
    source.sizeBytes,
    source.seeders,
    source.quality,
    source.codec,
    source.hdr,
    source.audio,
    source.audioLanguages,
    source.advertisedSubtitleLanguages,
    source.isSeasonPack,
    source.fileIndex
  ].filter((value) => value !== undefined).length;
}

function normalizeProvider(provider: Readonly<SourceProvider>): SourceProvider {
  const name = provider.name.replace(/[\r\n\0]+/g, " ").trim().slice(0, 160);
  if (!name) {
    throw new Error("Source provider name is invalid.");
  }
  const parsed = new URL(provider.baseUrl);
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new Error("Source provider URL is invalid.");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return {
    id: provider.id,
    name,
    baseUrl: parsed.toString().replace(/\/$/, "")
  };
}

function cloneSources(sources: TorrentSource[]): TorrentSource[] {
  return sources.map((source) => ({
    ...source,
    trackers: [...source.trackers],
    audioLanguages: source.audioLanguages
      ? [...source.audioLanguages]
      : undefined,
    advertisedSubtitleLanguages: source.advertisedSubtitleLanguages
      ? [...source.advertisedSubtitleLanguages]
      : undefined
  }));
}

function safeProviderError(error: unknown): string {
  const message = errorMessage(error);
  return message.replace(/https?:\/\/\S+/gi, "[provider URL]").replace(/[\r\n\0]+/g, " ").slice(0, 300);
}

function parseStremioResponse(text: string): StremioResponse {
  try {
    return JSON.parse(text) as StremioResponse;
  } catch (error) {
    throw new Error("response was not valid JSON", { cause: error });
  }
}
