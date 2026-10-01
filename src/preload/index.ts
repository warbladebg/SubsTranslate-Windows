import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings } from "../main/settingsService";
import type {
  MediaTransformProgress,
  MediaTransformRequest,
  MediaTransformResult,
  MediaTranslationPreparationRequest
} from "../main/mediaTransformService";
import type { SubtitleExportManyRequest, SubtitleExportManyResult, SubtitleExportRequest, SubtitleExportResult } from "../main/subtitleExportService";
import type { BatchItemProgress, BatchJobRequest, BatchJobResult, DryRunRequest, DryRunResult, ProgressMessage, TranslationJobRequest, TranslationJobResult } from "../main/translationManager";
import type { TranslationStatsView } from "../main/translationHistoryStore";
import type { SavedTranslationSession } from "../main/translationSessionStore";
import type { ProbeResult } from "../core/video/ProbeResult";
import type { WorkflowProfile, WorkflowProfileDraft } from "../main/workflowProfileService";
import type { MediaBatchSession, MediaBatchSessionCheckpoint } from "../main/mediaBatchSessionService";
import type { DeleteDownloadedFileRequest, DownloadedLibrarySnapshot } from "../core/downloads/DownloadedLibrary";
import type { DownloadLocationState } from "../core/downloads/DownloadLocations";
import type {
  CatalogDetails,
  CatalogItem,
  DiscoveryAction,
  DiscoveryCredentialStatus,
  DiscoveryHome,
  DiscoveryInteraction,
  DiscoveryPreferences,
  DiscoveryRatingsResult,
  DiscoveryState,
  DownloadProgress,
  MediaType,
  RealDebridConnectionStatus,
  RealDebridDownloadRequest,
  SourceSearchRequest,
  SourceSearchResult,
  StreamingAvailabilityItem,
  StreamingAvailabilityResult,
  StreamingCataloguePage,
  StreamingCatalogueRequest,
  TorrentClientStatus,
  TorrentSource,
  VerifyCachedSourcesRequest
} from "../core/discovery/DiscoveryTypes";

const api = {
  chooseVideo: (): Promise<string | undefined> => ipcRenderer.invoke("dialog:chooseVideo"),
  chooseVideos: (): Promise<string[]> => ipcRenderer.invoke("dialog:chooseVideos"),
  chooseOutputFolder: (): Promise<string | undefined> => ipcRenderer.invoke("dialog:chooseOutputFolder"),
  chooseSubtitleFile: (): Promise<string | undefined> => ipcRenderer.invoke("dialog:chooseSubtitleFile"),
  chooseSubtitleFiles: (): Promise<string[]> => ipcRenderer.invoke("dialog:chooseSubtitleFiles"),
  probeVideo: (filePath: string): Promise<ProbeResult> => ipcRenderer.invoke("video:probe", filePath),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: AppSettings): Promise<AppSettings> => ipcRenderer.invoke("settings:save", settings),
  setGeminiApiKey: (apiKey: string): Promise<void> => ipcRenderer.invoke("settings:setGeminiApiKey", apiKey),
  hasGeminiApiKey: (): Promise<boolean> => ipcRenderer.invoke("settings:hasGeminiApiKey"),
  setVercelApiKey: (apiKey: string): Promise<void> => ipcRenderer.invoke("settings:setVercelApiKey", apiKey),
  hasVercelApiKey: (): Promise<boolean> => ipcRenderer.invoke("settings:hasVercelApiKey"),
  getDiscoveryCredentialStatus: (): Promise<DiscoveryCredentialStatus> => ipcRenderer.invoke("discovery:credentials:get"),
  setRealDebridApiToken: (token: string): Promise<RealDebridConnectionStatus> =>
    ipcRenderer.invoke("discovery:credentials:setRealDebrid", token),
  clearRealDebridApiToken: (): Promise<void> => ipcRenderer.invoke("discovery:credentials:clearRealDebrid"),
  setMdblistApiKey: (apiKey: string): Promise<void> =>
    ipcRenderer.invoke("discovery:credentials:setMdblist", apiKey),
  clearMdblistApiKey: (): Promise<void> => ipcRenderer.invoke("discovery:credentials:clearMdblist"),
  getRealDebridStatus: (): Promise<RealDebridConnectionStatus> => ipcRenderer.invoke("discovery:realDebrid:status"),
  setOtherDebridApiToken: (provider: "all-debrid" | "premiumize" | "torbox" | "debrid-link", token: string): Promise<RealDebridConnectionStatus> =>
    ipcRenderer.invoke("discovery:credentials:setOtherDebrid", provider, token),
  clearOtherDebridApiToken: (provider: "all-debrid" | "premiumize" | "torbox" | "debrid-link"): Promise<void> =>
    ipcRenderer.invoke("discovery:credentials:clearOtherDebrid", provider),
  getDiscoveryState: (): Promise<DiscoveryState> => ipcRenderer.invoke("discovery:state:get"),
  saveDiscoveryPreferences: (preferences: DiscoveryPreferences): Promise<DiscoveryPreferences> =>
    ipcRenderer.invoke("discovery:preferences:save", preferences),
  setDiscoveryInteraction: (
    item: CatalogItem,
    action: DiscoveryAction,
    active: boolean
  ): Promise<DiscoveryInteraction> => ipcRenderer.invoke("discovery:interaction:set", item, action, active),
  setDiscoveryEpisodeWatched: (
    media: CatalogDetails,
    season: number,
    episode: number,
    active: boolean
  ): Promise<DiscoveryInteraction> =>
    ipcRenderer.invoke("discovery:episode:setWatched", media, season, episode, active),
  clearDiscoveryInteractions: (): Promise<void> => ipcRenderer.invoke("discovery:interactions:clear"),
  getDiscoveryHome: (): Promise<DiscoveryHome> => ipcRenderer.invoke("discovery:home"),
  searchDiscoveryCatalog: (query: string): Promise<CatalogItem[]> => ipcRenderer.invoke("discovery:search", query),
  getDiscoveryDetails: (mediaType: MediaType, id: string): Promise<CatalogDetails> =>
    ipcRenderer.invoke("discovery:details", mediaType, id),
  getDiscoveryStreamingAvailability: (
    items: StreamingAvailabilityItem[]
  ): Promise<StreamingAvailabilityResult> => ipcRenderer.invoke("discovery:streamingAvailability", items),
  getDiscoveryStreamingCatalogue: (
    request: StreamingCatalogueRequest
  ): Promise<StreamingCataloguePage> => ipcRenderer.invoke("discovery:streamingCatalogue", request),
  getDiscoveryRatings: (
    items: StreamingAvailabilityItem[]
  ): Promise<DiscoveryRatingsResult> => ipcRenderer.invoke("discovery:ratings", items),
  openMdblistApiKeyPage: (): Promise<void> => ipcRenderer.invoke("discovery:ratings:openApiKeyPage"),
  searchTorrentSources: (request: SourceSearchRequest): Promise<SourceSearchResult> =>
    ipcRenderer.invoke("discovery:sources:search", request),
  getVerifiedRealDebridSources: (request: VerifyCachedSourcesRequest): Promise<TorrentSource[]> =>
    ipcRenderer.invoke("discovery:sources:verifiedRealDebrid", request),
  getTorrentClientStatus: (): Promise<TorrentClientStatus> => ipcRenderer.invoke("discovery:torrentClient:status"),
  openTorrentSource: (source: TorrentSource): Promise<boolean> => ipcRenderer.invoke("discovery:torrent:open", source),
  startTorrentDownload: (request: RealDebridDownloadRequest): Promise<string> =>
    ipcRenderer.invoke("discovery:torrent:download", request),
  cancelTorrentDownload: (): Promise<void> => ipcRenderer.invoke("discovery:torrent:cancel"),
  getTorrentSeedStatus: (locationId: string, filePath: string): Promise<"unavailable" | "stopped" | "seeding"> =>
    ipcRenderer.invoke("discovery:torrent:seedStatus", locationId, filePath),
  startTorrentSeeding: (locationId: string, filePath: string): Promise<void> =>
    ipcRenderer.invoke("discovery:torrent:seedStart", locationId, filePath),
  stopTorrentSeeding: (): Promise<void> => ipcRenderer.invoke("discovery:torrent:seedStop"),
  startRealDebridDownload: (request: RealDebridDownloadRequest): Promise<string | undefined> =>
    ipcRenderer.invoke("discovery:download:start", request),
  cancelRealDebridDownload: (): Promise<void> => ipcRenderer.invoke("discovery:download:cancel"),
  chooseDiscoveryDownloadDirectory: (): Promise<string | undefined> =>
    ipcRenderer.invoke("discovery:downloadDirectory:choose"),
  getDownloadLocations: (): Promise<DownloadLocationState> =>
    ipcRenderer.invoke("downloads:locations:list"),
  addDownloadLocation: (): Promise<DownloadLocationState> =>
    ipcRenderer.invoke("downloads:locations:add"),
  setDefaultDownloadLocation: (id: string): Promise<DownloadLocationState> =>
    ipcRenderer.invoke("downloads:locations:setDefault", id),
  setDownloadLocationExternal: (id: string, external: boolean): Promise<DownloadLocationState> =>
    ipcRenderer.invoke("downloads:locations:setExternal", id, external),
  removeDownloadLocation: (id: string): Promise<DownloadLocationState> =>
    ipcRenderer.invoke("downloads:locations:remove", id),
  scanExternalDownloadLocations: (): Promise<DownloadLocationState> =>
    ipcRenderer.invoke("downloads:locations:scan"),
  getDownloadedLibrary: (): Promise<DownloadedLibrarySnapshot> =>
    ipcRenderer.invoke("downloads:library:get"),
  rescanDownloadedLibrary: (): Promise<DownloadedLibrarySnapshot> =>
    ipcRenderer.invoke("downloads:library:rescan"),
  deleteDownloadedFile: (request: DeleteDownloadedFileRequest): Promise<DownloadedLibrarySnapshot> =>
    ipcRenderer.invoke("downloads:library:deleteFile", request),
  openDiscoveryTrailer: (key: string): Promise<void> => ipcRenderer.invoke("discovery:trailer:open", key),
  getWorkflowProfiles: (): Promise<WorkflowProfile[]> => ipcRenderer.invoke("profiles:list"),
  saveWorkflowProfile: (profile: WorkflowProfileDraft): Promise<WorkflowProfile> => ipcRenderer.invoke("profiles:save", profile),
  deleteWorkflowProfile: (id: string): Promise<void> => ipcRenderer.invoke("profiles:delete", id),
  getResumableMediaBatch: (): Promise<MediaBatchSession | undefined> => ipcRenderer.invoke("media:batch:getResumable"),
  saveMediaBatchCheckpoint: (checkpoint: MediaBatchSessionCheckpoint): Promise<MediaBatchSession> => ipcRenderer.invoke("media:batch:save", checkpoint),
  discardMediaBatchCheckpoint: (id?: string): Promise<boolean> => ipcRenderer.invoke("media:batch:discard", id),
  dryRun: (request: DryRunRequest): Promise<DryRunResult> => ipcRenderer.invoke("translation:dryRun", request),
  getLatestSession: (): Promise<SavedTranslationSession | undefined> => ipcRenderer.invoke("translation:session:getLatest"),
  getTranslationStats: (sessionId?: string): Promise<TranslationStatsView> => ipcRenderer.invoke("translation:stats:get", sessionId),
  exportSubtitleTrack: (request: SubtitleExportRequest): Promise<SubtitleExportResult> => ipcRenderer.invoke("subtitle:exportTrack", request),
  exportSubtitleTracks: (request: SubtitleExportManyRequest): Promise<SubtitleExportManyResult> => ipcRenderer.invoke("subtitle:exportTracks", request),
  startMediaTransform: (request: MediaTransformRequest): Promise<MediaTransformResult> => ipcRenderer.invoke("media:start", request),
  prepareMediaForTranslation: (
    request: MediaTranslationPreparationRequest
  ): Promise<{ id: string; extractedSubtitlePath: string }> =>
    ipcRenderer.invoke("media:translation:prepare", request),
  finalizeMediaTranslation: (id: string, subtitlePath: string): Promise<MediaTransformResult> =>
    ipcRenderer.invoke("media:translation:finalize", id, subtitlePath),
  discardMediaTranslationPreparation: (id: string): Promise<void> =>
    ipcRenderer.invoke("media:translation:discard", id),
  cancelMediaTransform: (): Promise<void> => ipcRenderer.invoke("media:cancel"),
  startTranslation: (request: TranslationJobRequest): Promise<TranslationJobResult> => ipcRenderer.invoke("translation:start", request),
  startBatch: (request: BatchJobRequest): Promise<BatchJobResult> => ipcRenderer.invoke("batch:start", request),
  cancelTranslation: (): Promise<void> => ipcRenderer.invoke("translation:cancel"),
  openPath: (path: string): Promise<void> => ipcRenderer.invoke("shell:openPath", path),
  showItemInFolder: (path: string): Promise<void> => ipcRenderer.invoke("shell:showItemInFolder", path),
  onProgress: (listener: (message: ProgressMessage) => void): (() => void) => {
    const channelListener = (_event: Electron.IpcRendererEvent, message: ProgressMessage): void => listener(message);
    ipcRenderer.on("translation:progress", channelListener);
    return () => ipcRenderer.removeListener("translation:progress", channelListener);
  },
  onBatchProgress: (listener: (items: BatchItemProgress[]) => void): (() => void) => {
    const channelListener = (_event: Electron.IpcRendererEvent, items: BatchItemProgress[]): void => listener(items);
    ipcRenderer.on("batch:progress", channelListener);
    return () => ipcRenderer.removeListener("batch:progress", channelListener);
  },
  onMediaProgress: (listener: (message: MediaTransformProgress) => void): (() => void) => {
    const channelListener = (_event: Electron.IpcRendererEvent, message: MediaTransformProgress): void => listener(message);
    ipcRenderer.on("media:progress", channelListener);
    return () => ipcRenderer.removeListener("media:progress", channelListener);
  },
  onDiscoveryDownloadProgress: (listener: (message: DownloadProgress) => void): (() => void) => {
    const channelListener = (_event: Electron.IpcRendererEvent, message: DownloadProgress): void => listener(message);
    ipcRenderer.on("discovery:download:progress", channelListener);
    return () => ipcRenderer.removeListener("discovery:download:progress", channelListener);
  }
};

contextBridge.exposeInMainWorld("subtitleTranslator", api);

export type SubtitleTranslatorApi = typeof api;
