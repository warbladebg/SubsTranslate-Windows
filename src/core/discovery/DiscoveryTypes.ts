export type MediaType = "movie" | "series";
export type DiscoveryAction = "liked" | "disliked" | "watched" | "watchlisted" | "hidden";
export type PreferredMediaType = "all" | MediaType;
export type PreferredQuality = "any" | "2160p" | "1080p" | "720p";
export type StreamingServiceId =
  | "netflix"
  | "prime-video"
  | "disney-plus"
  | "max"
  | "apple-tv-plus"
  | "hulu"
  | "paramount-plus"
  | "peacock"
  | "crunchyroll"
  | "mubi";
export type RatingSourceId =
  | "imdb"
  | "trakt"
  | "tmdb"
  | "letterboxd"
  | "tomatoes"
  | "popcorn"
  | "metacritic"
  | "metacritic-user"
  | "rogerebert"
  | "myanimelist";

export interface CatalogItem {
  id: string;
  mediaType: MediaType;
  title: string;
  originalTitle?: string;
  overview: string;
  posterPath?: string;
  backdropPath?: string;
  releaseDate?: string;
  genreIds: number[];
  voteAverage: number;
  voteCount: number;
  popularity: number;
  originalLanguage?: string;
  runtimeMinutes?: number;
}

export interface CatalogPerson {
  id: number;
  name: string;
  character?: string;
  job?: string;
  profilePath?: string;
}

export interface CatalogVideo {
  key: string;
  name: string;
  site: string;
  type: string;
  official: boolean;
}

export interface SeasonSummary {
  seasonNumber: number;
  name: string;
  episodeCount: number;
  airDate?: string;
  posterPath?: string;
}

export interface CatalogDetails extends CatalogItem {
  imdbId?: string;
  genres: Array<{ id: number; name: string }>;
  cast: CatalogPerson[];
  crew: CatalogPerson[];
  videos: CatalogVideo[];
  seasons: SeasonSummary[];
  recommendations: CatalogItem[];
  homepage?: string;
  status?: string;
  tagline?: string;
}

export interface DiscoverySection {
  id: string;
  title: string;
  subtitle?: string;
  items: CatalogItem[];
}

export interface DiscoveryHome {
  sections: DiscoverySection[];
  generatedAt: string;
}

export interface StreamingAvailabilityItem {
  id: string;
  mediaType: MediaType;
}

export interface StreamingAvailabilityEntry {
  key: string;
  services: StreamingServiceId[];
}

export interface StreamingAvailabilityResult {
  entries: StreamingAvailabilityEntry[];
  checkedItems: number;
  failedItems: number;
}

export interface StreamingCatalogueRequest {
  streamingServices: StreamingServiceId[];
  mediaType: "all" | MediaType;
  genreIds: number[];
  minimumRating: number;
  query: string;
  skip: number;
  showAll?: boolean;
}

export interface StreamingCataloguePage {
  items: CatalogItem[];
  nextSkip: number;
  hasMore: boolean;
  scannedItems: number;
  failedItems: number;
}

export interface ExternalRating {
  source: RatingSourceId;
  value: number;
  votes?: number;
}

export interface TitleRatings {
  key: string;
  ratings: ExternalRating[];
}

export interface DiscoveryRatingsResult {
  entries: TitleRatings[];
  checkedItems: number;
  failedItems: number;
}

export interface DiscoveryInteraction {
  key: string;
  item: CatalogItem;
  liked: boolean;
  disliked: boolean;
  watched: boolean;
  watchedEpisodes?: string[];
  knownEpisodeCount?: number;
  watchedManually?: boolean;
  watchlisted: boolean;
  hidden: boolean;
  updatedAt: string;
}

export interface DiscoveryPreferences {
  language: string;
  region: string;
  preferredMediaType: PreferredMediaType;
  preferredQuality: PreferredQuality;
  maxSizeGb: number;
  minSeeders: number;
  sourceProvider?: "torrentio" | "comet" | "mediafusion";
  debridProvider?: DebridProvider;
  defaultDownloadDirectory?: string;
}

export type DebridProvider = "real-debrid" | "all-debrid" | "premiumize" | "torbox" | "debrid-link";
/** Debrid services other than Real-Debrid, which has its own richer integration. */
export type OtherDebridProvider = Exclude<DebridProvider, "real-debrid">;

const DEBRID_PROVIDER_NAMES: Record<DebridProvider, string> = {
  "real-debrid": "Real-Debrid",
  "all-debrid": "AllDebrid",
  premiumize: "Premiumize",
  torbox: "TorBox",
  "debrid-link": "Debrid-Link"
};

export const DEBRID_PROVIDERS = Object.keys(DEBRID_PROVIDER_NAMES) as DebridProvider[];

export function debridProviderName(provider: DebridProvider): string {
  return DEBRID_PROVIDER_NAMES[provider];
}

export interface DiscoveryState {
  preferences: DiscoveryPreferences;
  interactions: DiscoveryInteraction[];
}

export type SourceCacheStatus = "verified-account-cached" | "verified-provider-cached" | "provider-claimed-cached" | "unknown";

export interface TorrentSource {
  id: string;
  provider: string;
  infoHash: string;
  fileIndex?: number;
  selectedFileIndices?: number[];
  name: string;
  description?: string;
  sizeBytes?: number;
  seeders?: number;
  quality?: string;
  codec?: string;
  hdr?: string;
  audio?: string;
  audioLanguages?: string[];
  advertisedSubtitleLanguages?: string[];
  isSeasonPack?: boolean;
  releaseGroup?: string;
  trackers: string[];
  observedAt: string;
  providerClaimedCached: boolean;
  cacheStatus: SourceCacheStatus;
  realDebridTorrentId?: string;
  realDebridFileId?: number;
  verifiedAt?: string;
}

export interface SourceSearchRequest {
  episodes?: number[];
  media: CatalogDetails;
  season?: number;
  episode?: number;
}

export interface SourceSearchResult {
  sources: TorrentSource[];
  providerErrors: Array<{ provider: string; message: string }>;
  searchedAt: string;
}

export interface TorrentClientStatus {
  available: boolean;
  applicationName?: string;
}

export interface RealDebridConnectionStatus {
  connected: boolean;
  username?: string;
  accountType?: string;
  premiumUntil?: string;
  message?: string;
}

export interface DiscoveryCredentialStatus {
  hasRealDebridToken: boolean;
  hasDebridTokens?: Partial<Record<"all-debrid" | "premiumize" | "torbox" | "debrid-link", boolean>>;
  hasMdblistApiKey: boolean;
}

export interface RealDebridDownloadRequest {
  episodes?: number[];
  source: TorrentSource;
  media: CatalogDetails;
  season?: number;
  episode?: number;
  destinationLocationId?: string;
}

export interface VerifyCachedSourcesRequest {
  sources: TorrentSource[];
  media: CatalogDetails;
  season?: number;
  episode?: number;
}

export interface DownloadProgress {
  id: string;
  method?: "torrent" | "debrid";
  filename: string;
  receivedBytes: number;
  totalBytes?: number;
  percent?: number;
  bytesPerSecond?: number;
  elapsedSeconds?: number;
  estimatedRemainingSeconds?: number;
  status: "starting" | "downloading" | "completed" | "cancelled" | "failed";
  outputPath?: string;
  message?: string;
}

export function catalogItemKey(item: Pick<CatalogItem, "mediaType" | "id">): string {
  return `${item.mediaType}:${item.id}`;
}
