import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell, type IpcMainInvokeEvent, type OpenDialogOptions } from "electron";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { buildSanitizedMagnetUri } from "../core/discovery/MagnetLinks";
import { probeVideo } from "./ffprobeService";
import {
  discardMediaTranslationPreparation,
  finalizeMediaTranslation,
  MediaTransformProgress,
  type MediaTranslationPreparation,
  prepareMediaForTranslation,
  transformMedia
} from "./mediaTransformService";
import { SettingsService } from "./settingsService";
import { exportSubtitleTrack, exportSubtitleTracks, SubtitleExportManyRequest, SubtitleExportRequest } from "./subtitleExportService";
import type { BatchItemProgress, ProgressMessage, TranslationManager } from "./translationManager";
import { TranslationSessionStore } from "./translationSessionStore";
import { WorkflowProfileService } from "./workflowProfileService";
import { MediaBatchSessionService } from "./mediaBatchSessionService";
import { selectTrustedDevServerUrl } from "./devServerUrl";
import { DiscoveryStore } from "./discoveryStore";
import { CatalogService } from "./catalogService";
import { SourceAggregatorService } from "./sourceAggregatorService";
import { RealDebridService } from "./realDebridService";
import { OtherDebridService } from "./otherDebridService";
import { DownloadManager } from "./downloadManager";
import { TorrentDownloadService } from "./torrentDownloadService";
import { StreamingAvailabilityService } from "./streamingAvailabilityService";
import { MultiSourceRatingsService } from "./multiSourceRatingsService";
import { StreamingCatalogueService } from "./streamingCatalogueService";
import { DownloadedLibraryService, isDownloadedLibraryFile } from "./downloadedLibraryService";
import { DownloadLocationService } from "./downloadLocationService";
import { electronFetch } from "./electronFetch";
import {
  expectAppSettings,
  expectBatchJobRequest,
  expectBoolean,
  expectCatalogDetails,
  expectCatalogItem,
  expectDeleteDownloadedFileRequest,
  expectDiscoveryAction,
  expectDiscoveryPreferences,
  expectDownloadRequest,
  expectDryRunRequest,
  expectId,
  expectInteger,
  expectMediaBatchCheckpoint,
  expectMediaPreparationRequest,
  expectMediaTransformRequest,
  expectMediaType,
  expectOptionalId,
  expectOtherDebridProvider,
  expectPath,
  expectSourceSearchRequest,
  expectStreamingCatalogueRequest,
  expectStreamingItems,
  expectString,
  expectSubtitleExportManyRequest,
  expectSubtitleExportRequest,
  expectTorrentSource,
  expectTranslationJobRequest,
  expectVerifyCachedSourcesRequest,
  expectWorkflowProfileDraft,
  OTHER_DEBRID_PROVIDERS
} from "./ipcValidation";

// The installer names the app "SubsTranslate", which would otherwise move user data to a new
// folder. Pin it to the original one so settings, keys and history carry over. This must run
// before the services below read the path.
app.setPath("userData", join(app.getPath("appData"), "bulgarian-subtitle-translator"));
if (app.isPackaged && !process.env.SUBS_TRANSLATE_WORK_DIR) {
  // The working directory of an installed app is not writable, so extract subtitles under user data.
  process.env.SUBS_TRANSLATE_WORK_DIR = join(app.getPath("userData"), "work", "extracted");
}

const settingsService = new SettingsService();
const workflowProfileService = new WorkflowProfileService();
const mediaBatchSessionService = new MediaBatchSessionService();
const discoveryStore = new DiscoveryStore();
const catalogService = new CatalogService();
const sourceAggregatorService = new SourceAggregatorService();
const realDebridService = new RealDebridService(() => settingsService.getRealDebridApiToken());
const otherDebridService = new OtherDebridService((provider) => settingsService.getOtherDebridToken(provider));
const downloadManager = new DownloadManager();
const streamingAvailabilityService = new StreamingAvailabilityService();
const multiSourceRatingsService = new MultiSourceRatingsService(() => settingsService.getMdblistApiKey());
const streamingCatalogueService = new StreamingCatalogueService(catalogService, streamingAvailabilityService);
const downloadedLibraryService = new DownloadedLibraryService();
const torrentDownloadService = new TorrentDownloadService(downloadedLibraryService);
const downloadLocationService = new DownloadLocationService({ libraryService: downloadedLibraryService });

let mainWindow: BrowserWindow | undefined;
let subtitleExportAbortController: AbortController | undefined;
let mediaAbortController: AbortController | undefined;
let translationManagerPromise: Promise<TranslationManager> | undefined;
const mediaTranslationPreparations = new Map<string, MediaTranslationPreparation>();

const VIDEO_FILE_FILTERS = [
  { name: "Video files", extensions: ["mkv", "mp4", "mov", "avi", "webm"] },
  { name: "All files", extensions: ["*"] }
];
const SUBTITLE_FILE_FILTERS = [
  { name: "Subtitle files", extensions: ["srt", "ass", "ssa", "vtt"] },
  { name: "All files", extensions: ["*"] }
];

/** Shows an open dialog over the main window and returns the chosen paths (empty when cancelled). */
async function pickPaths(options: OpenDialogOptions): Promise<string[]> {
  const result = await dialog.showOpenDialog(mainWindow!, options);
  return result.canceled ? [] : result.filePaths;
}

/** Media jobs share one ffmpeg pipeline and one cancel button, so only one may run at a time. */
async function runExclusiveMediaJob<T>(job: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (mediaAbortController) {
    throw new Error("A media job is already running.");
  }
  const controller = new AbortController();
  mediaAbortController = controller;
  try {
    return await job(controller.signal);
  } finally {
    if (mediaAbortController === controller) {
      mediaAbortController = undefined;
    }
  }
}

async function findAvailableLocation(locationId: string) {
  return (await downloadLocationService.list()).locations.find((item) => item.id === locationId && item.isAvailable);
}

async function requireAvailableLocation(locationId: string) {
  const location = await findAvailableLocation(locationId);
  if (!location) throw new Error("The download location is not available.");
  return location;
}

function sendDownloadProgress(event: IpcMainInvokeEvent) {
  return (progress: unknown) => {
    if (!event.sender.isDestroyed()) event.sender.send("discovery:download:progress", progress);
  };
}

function getTranslationManager(): Promise<TranslationManager> {
  translationManagerPromise ??= import("./translationManager").then(
    ({ TranslationManager: Manager }) => new Manager(settingsService)
  );
  return translationManagerPromise;
}

function isYouTubeUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && /^(?:www\.|m\.)?(?:youtube\.com|youtube-nocookie\.com|youtu\.be)$/.test(hostname);
  } catch {
    return false;
  }
}

/**
 * The packaged renderer is loaded from file://, which sends no Referer, and YouTube
 * refuses to play embeds without one (player error 153). Supply one for the embed page.
 */
function allowYouTubeEmbedsFromFilePages(): void {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ["https://www.youtube-nocookie.com/embed/*"] },
    (details, callback) => {
      const headers = details.requestHeaders;
      if (!headers.Referer && !headers.referer) headers.Referer = "https://www.youtube-nocookie.com/";
      callback({ requestHeaders: headers });
    }
  );
}

async function createWindow(): Promise<void> {
  Menu.setApplicationMenu(null);
  const icon = join(app.getAppPath(), "public", "app-logo.png");
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 980,
    minHeight: 680,
    title: "Bulgarian Subtitle Translator",
    icon,
    // Matches the default dark theme so the window never flashes white while loading.
    backgroundColor: "#0d0f14",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Links inside the embedded trailer player ("Watch on YouTube") open in the browser.
    if (isYouTubeUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());

  const devServerUrl = selectTrustedDevServerUrl(process.env.SUBSTRANSLATE_DEV_SERVER_URL, app.isPackaged);
  const window = mainWindow;
  try {
    await (devServerUrl ? window.loadURL(devServerUrl) : window.loadFile(join(__dirname, "../../dist/index.html")));
  } finally {
    // Never leave the window hidden if the page failed before "ready-to-show".
    if (!window.isDestroyed() && !window.isVisible()) window.show();
  }
}

app.whenReady().then(async () => {
  globalThis.fetch = electronFetch;
  allowYouTubeEmbedsFromFilePages();
  registerIpcHandlers();
  const discoveryState = await discoveryStore.getState();
  await downloadLocationService.ensureInitialLocation(
    discoveryState.preferences.defaultDownloadDirectory || app.getPath("downloads")
  );
  await downloadLocationService.scanExternalLocations();
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => torrentDownloadService.shutdown());

function registerIpcHandlers(): void {
  ipcMain.handle("dialog:chooseVideo", async () =>
    (await pickPaths({ title: "Choose video", properties: ["openFile"], filters: VIDEO_FILE_FILTERS }))[0]
  );
  ipcMain.handle("dialog:chooseVideos", () =>
    pickPaths({ title: "Choose videos", properties: ["openFile", "multiSelections"], filters: VIDEO_FILE_FILTERS })
  );
  ipcMain.handle("dialog:chooseOutputFolder", async () =>
    (await pickPaths({ title: "Choose output folder", properties: ["openDirectory", "createDirectory"] }))[0]
  );
  ipcMain.handle("dialog:chooseSubtitleFile", async () =>
    (await pickPaths({ title: "Choose subtitle file", properties: ["openFile"], filters: SUBTITLE_FILE_FILTERS }))[0]
  );
  ipcMain.handle("dialog:chooseSubtitleFiles", () =>
    pickPaths({ title: "Choose subtitle files", properties: ["openFile", "multiSelections"], filters: SUBTITLE_FILE_FILTERS })
  );

  ipcMain.handle("video:probe", (_event, filePath: unknown) => probeVideo(expectPath(filePath, "video path")));
  ipcMain.handle("settings:get", () => settingsService.getSettings());
  ipcMain.handle("settings:save", (_event, settings: unknown) => settingsService.saveSettings(expectAppSettings(settings)));
  ipcMain.handle("settings:setGeminiApiKey", (_event, apiKey: unknown) => settingsService.setGeminiApiKey(expectString(apiKey, "Gemini API key")));
  ipcMain.handle("settings:hasGeminiApiKey", () => settingsService.hasGeminiApiKey());
  ipcMain.handle("settings:setVercelApiKey", (_event, apiKey: unknown) => settingsService.setVercelApiKey(expectString(apiKey, "Vercel API key")));
  ipcMain.handle("settings:hasVercelApiKey", () => settingsService.hasVercelApiKey());
  ipcMain.handle("discovery:credentials:get", async () => {
    const [hasRealDebridToken, hasMdblistApiKey, ...otherTokens] = await Promise.all([
      settingsService.hasRealDebridApiToken(),
      settingsService.hasMdblistApiKey(),
      ...OTHER_DEBRID_PROVIDERS.map((provider) => settingsService.getOtherDebridToken(provider).then(Boolean))
    ]);
    return { hasRealDebridToken, hasMdblistApiKey,
      hasDebridTokens: Object.fromEntries(OTHER_DEBRID_PROVIDERS.map((provider, index) => [provider, otherTokens[index]])) };
  });
  ipcMain.handle("discovery:credentials:setOtherDebrid", async (_event, providerInput: unknown, tokenInput: unknown) => {
    const provider = expectOtherDebridProvider(providerInput);
    const token = expectString(tokenInput, "debrid API token");
    const status = await otherDebridService.getConnectionStatus(provider, token);
    if (!status.connected) throw new Error(status.message ?? "Debrid connection failed.");
    await settingsService.setOtherDebridToken(provider, token);
    sourceAggregatorService.clearCache();
    return status;
  });
  ipcMain.handle("discovery:credentials:clearOtherDebrid", async (_event, providerInput: unknown) => {
    await settingsService.clearOtherDebridToken(expectOtherDebridProvider(providerInput));
    sourceAggregatorService.clearCache();
  });
  ipcMain.handle("discovery:credentials:setRealDebrid", async (_event, token: unknown) => {
    await settingsService.setRealDebridApiToken(expectString(token, "Real-Debrid API token"));
    realDebridService.clearCachedAccountData();
    sourceAggregatorService.clearCache();
    const status = await realDebridService.getConnectionStatus();
    if (!status.connected) {
      await settingsService.clearRealDebridApiToken();
      throw new Error(status.message ?? "Real-Debrid connection failed.");
    }
    return status;
  });
  ipcMain.handle("discovery:credentials:clearRealDebrid", async () => {
    realDebridService.clearCachedAccountData();
    sourceAggregatorService.clearCache();
    await settingsService.clearRealDebridApiToken();
  });
  ipcMain.handle("discovery:credentials:setMdblist", async (_event, apiKeyInput: unknown) => {
    const apiKey = expectString(apiKeyInput, "MDBList API key");
    await multiSourceRatingsService.validateApiKey(apiKey);
    await settingsService.setMdblistApiKey(apiKey);
    multiSourceRatingsService.clearCache();
  });
  ipcMain.handle("discovery:credentials:clearMdblist", async () => {
    multiSourceRatingsService.clearCache();
    await settingsService.clearMdblistApiKey();
  });
  ipcMain.handle("discovery:realDebrid:status", () => realDebridService.getConnectionStatus());
  ipcMain.handle("discovery:state:get", () => discoveryStore.getState());
  ipcMain.handle("discovery:preferences:save", async (_event, preferences: unknown) => {
    return discoveryStore.savePreferences(expectDiscoveryPreferences(preferences));
  });
  ipcMain.handle(
    "discovery:interaction:set",
    (_event, item: unknown, action: unknown, active: unknown) =>
      discoveryStore.recordInteraction(expectCatalogItem(item), expectDiscoveryAction(action), expectBoolean(active, "interaction state"))
  );
  ipcMain.handle(
    "discovery:episode:setWatched",
    (_event, media: unknown, season: unknown, episode: unknown, active: unknown) => discoveryStore.setEpisodeWatched(
      expectCatalogDetails(media),
      expectInteger(season, "season", { max: 10_000 }),
      expectInteger(episode, "episode", { max: 10_000 }),
      expectBoolean(active, "watched state")
    )
  );
  ipcMain.handle("discovery:interactions:clear", () => discoveryStore.clearInteractions());
  ipcMain.handle("discovery:home", async () => {
    const state = await discoveryStore.getState();
    return catalogService.getHome(state.preferences, state.interactions);
  });
  ipcMain.handle("discovery:search", async (_event, queryInput: unknown) => {
    const query = expectString(queryInput, "search", { maxLength: 500 });
    const state = await discoveryStore.getState();
    return catalogService.search(query, state.preferences);
  });
  ipcMain.handle("discovery:details", async (_event, mediaTypeInput: unknown, idInput: unknown) => {
    const mediaType = expectMediaType(mediaTypeInput);
    const id = expectId(idInput, "title id");
    const state = await discoveryStore.getState();
    return catalogService.getDetails(mediaType, id, state.preferences.language);
  });
  ipcMain.handle("discovery:streamingAvailability", (_event, items: unknown) =>
    streamingAvailabilityService.getAvailability(expectStreamingItems(items))
  );
  ipcMain.handle("discovery:streamingCatalogue", (_event, request: unknown) =>
    streamingCatalogueService.browse(expectStreamingCatalogueRequest(request))
  );
  ipcMain.handle("discovery:ratings", (_event, items: unknown) =>
    multiSourceRatingsService.getRatings(expectStreamingItems(items))
  );
  ipcMain.handle("discovery:ratings:openApiKeyPage", () =>
    shell.openExternal("https://mdblist.com/preferences/")
  );
  ipcMain.handle("discovery:sources:search", async (_event, requestInput: unknown) => {
    const request = expectSourceSearchRequest(requestInput);
    const state = await discoveryStore.getState();
    return sourceAggregatorService.search({
      ...request,
      preferences: state.preferences
    });
  });
  ipcMain.handle("discovery:sources:verifiedRealDebrid", async (_event, requestInput: unknown) => {
    const request = expectVerifyCachedSourcesRequest(requestInput);
    const [state, realDebridApiToken] = await Promise.all([
      discoveryStore.getState(),
      settingsService.getRealDebridApiToken()
    ]);
    const debridProvider = state.preferences.debridProvider ?? "real-debrid";
    const providerResult = await sourceAggregatorService.search({
      media: request.media,
      season: request.season,
      episode: request.episode,
      preferences: state.preferences,
      realDebridApiToken: debridProvider === "real-debrid" ? realDebridApiToken : undefined
    });
    if (debridProvider !== "real-debrid") {
      const cached = await otherDebridService.checkCachedSources(debridProvider, providerResult.sources);
      return cached.map((source) => ({ ...source, providerClaimedCached: false,
        cacheStatus: debridProvider === "all-debrid" || debridProvider === "debrid-link"
          ? "unknown" as const : "verified-provider-cached" as const,
        verifiedAt: new Date().toISOString() }));
    }
    const rendererSources = request.sources.map((source) => ({
      ...source,
      providerClaimedCached: false,
      cacheStatus: "unknown" as const,
      realDebridTorrentId: undefined,
      realDebridFileId: undefined,
      verifiedAt: undefined
    }));
    const verified = await realDebridService.getVerifiedCachedSources({
      ...request,
      sources: [...providerResult.sources, ...rendererSources].slice(0, 1_000)
    });
    if (verified.length === 0 && providerResult.providerErrors.length > 0) {
      throw new Error("The selected scraper could not check Real-Debrid sources. Try again shortly.");
    }
    const knownHashes = new Set(verified.map((source) => `${source.infoHash}:${source.fileIndex ?? ""}`));
    const candidates = providerResult.sources.filter((source) =>
      !knownHashes.has(`${source.infoHash}:${source.fileIndex ?? ""}`)
    ).map((source) => ({ ...source, providerClaimedCached: false, cacheStatus: "unknown" as const }));
    return [...verified, ...candidates].slice(0, 1_000);
  });
  ipcMain.handle("discovery:torrentClient:status", async () => {
    try {
      const applicationName = app.getApplicationNameForProtocol("magnet:?xt=urn:btih:0000000000000000000000000000000000000000");
      return { available: Boolean(applicationName), applicationName: applicationName || undefined };
    } catch {
      return { available: false };
    }
  });
  ipcMain.handle("discovery:torrent:open", async (_event, sourceInput: unknown) => {
    const source = expectTorrentSource(sourceInput);
    const magnetUri = buildSanitizedMagnetUri(source, source.selectedFileIndices);
    const result = await dialog.showMessageBox(mainWindow!, {
      type: "question",
      title: "Open torrent",
      message: "Open this magnet link in your default torrent application?",
      detail: source.name.slice(0, 300) + (source.selectedFileIndices
        ? "\nOnly selected episodes are requested. Check the file selection if your torrent application does not support selective magnet links." : ""),
      buttons: ["Open torrent application", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    if (result.response !== 0) {
      return false;
    }
    await shell.openExternal(magnetUri);
    return true;
  });
  ipcMain.handle("discovery:torrent:download", async (event, requestInput: unknown) => {
    const request = expectDownloadRequest(requestInput);
    const destination = await downloadLocationService.resolveDestination(request.destinationLocationId);
    return torrentDownloadService.download(
      request,
      destination.path,
      sendDownloadProgress(event),
      async (episode) => { await discoveryStore.recordCompletedDownload(request.media, request.season, episode); }
    );
  });
  ipcMain.handle("discovery:torrent:cancel", () => torrentDownloadService.cancel());
  ipcMain.handle("discovery:torrent:seedStatus", async (_event, locationIdInput: unknown, filePathInput: unknown) => {
    const locationId = expectId(locationIdInput, "download location");
    const filePath = expectPath(filePathInput, "media file path");
    const location = await findAvailableLocation(locationId);
    return location ? torrentDownloadService.seedStatus(location.path, filePath) : "unavailable";
  });
  ipcMain.handle("discovery:torrent:seedStart", async (_event, locationIdInput: unknown, filePathInput: unknown) => {
    const locationId = expectId(locationIdInput, "download location");
    const filePath = expectPath(filePathInput, "media file path");
    const location = await requireAvailableLocation(locationId);
    await torrentDownloadService.startSeeding(location.path, filePath);
  });
  ipcMain.handle("discovery:torrent:seedStop", () => torrentDownloadService.stopSeeding());
  ipcMain.handle("discovery:download:start", async (event, requestInput: unknown) => {
    const request = expectDownloadRequest(requestInput);
    const state = await discoveryStore.getState();
    const debridProvider = state.preferences.debridProvider ?? "real-debrid";
    const resolved = debridProvider === "real-debrid" ? await realDebridService.resolveVerifiedDownloads(
      request.source,
      request.media,
      request.season,
      request.episode,
      request.episodes
    ) : await otherDebridService.resolveCachedDownloads(debridProvider, request.source, request.media,
      request.season, request.episode, request.episodes);
    const destination = await downloadLocationService.resolveDestination(request.destinationLocationId);
    const onProgress = sendDownloadProgress(event);
    /** Downloads one resolved file into the library and records it for Downloaded and Discover. */
    const downloadIntoLibrary = async (file: (typeof resolved)[number], episode: number | undefined) => {
      const plan = await downloadedLibraryService.planDownload(destination.path, request.media, file.filename, request.season, episode);
      const outputPath = await downloadManager.download(file.url, plan.outputPath, plan.filename, onProgress);
      await downloadedLibraryService.recordCompletedDownload(destination.path, request.media, plan);
      await discoveryStore.recordCompletedDownload(request.media, request.season, episode);
      return { outputPath, directoryPath: plan.directoryPath };
    };

    const entireSeason = request.media.mediaType === "series" && request.episode === undefined;
    if (entireSeason) {
      let seasonDirectory: string | undefined;
      for (const file of resolved) {
        if (!Number.isInteger(file.episodeNumber) || file.episodeNumber! <= 0) {
          throw new Error(`Could not identify the episode number for ${file.filename}.`);
        }
        seasonDirectory = (await downloadIntoLibrary(file, file.episodeNumber)).directoryPath;
      }
      return seasonDirectory;
    }
    const file = resolved[0];
    if (!file) {
      throw new Error("The debrid service did not return a downloadable media file.");
    }
    return (await downloadIntoLibrary(file, request.episode)).outputPath;
  });
  ipcMain.handle("discovery:download:cancel", () => downloadManager.cancel());
  ipcMain.handle("discovery:downloadDirectory:choose", async () => {
    const [directory] = await pickPaths({ title: "Add download location", properties: ["openDirectory", "createDirectory"] });
    if (!directory) {
      return undefined;
    }
    await downloadLocationService.add(directory);
    return directory;
  });
  ipcMain.handle("downloads:locations:list", () => downloadLocationService.list());
  ipcMain.handle("downloads:locations:add", async () => {
    const [directory] = await pickPaths({ title: "Choose a download library folder", properties: ["openDirectory", "createDirectory"] });
    return directory ? downloadLocationService.add(directory) : downloadLocationService.list();
  });
  ipcMain.handle("downloads:locations:setDefault", (_event, id: unknown) =>
    downloadLocationService.setDefault(expectId(id, "download location"))
  );
  ipcMain.handle("downloads:locations:setExternal", (_event, id: unknown, external: unknown) =>
    downloadLocationService.setExternal(expectId(id, "download location"), expectBoolean(external, "external drive setting"))
  );
  ipcMain.handle("downloads:locations:remove", (_event, id: unknown) =>
    downloadLocationService.remove(expectId(id, "download location"))
  );
  ipcMain.handle("downloads:locations:scan", () => downloadLocationService.scanExternalLocations());
  ipcMain.handle("downloads:library:get", () => getCombinedDownloadedLibrary(false));
  ipcMain.handle("downloads:library:rescan", () => getCombinedDownloadedLibrary(true));
  ipcMain.handle("downloads:library:deleteFile", async (_event, requestInput: unknown) => {
    const request = expectDeleteDownloadedFileRequest(requestInput);
    const location = await requireAvailableLocation(request.libraryLocationId);
    const snapshot = await downloadedLibraryService.getLibrary(location.path);
    const filePath = snapshot.titles.find((title) => title.key === request.titleKey)?.files.find((file) => file.id === request.fileId)?.path;
    await downloadedLibraryService.deleteFile(
      location.path,
      request.titleKey,
      request.fileId,
      (path) => shell.trashItem(path)
    );
    if (filePath) await torrentDownloadService.forgetFile(location.path, filePath);
    return getCombinedDownloadedLibrary(false);
  });
  ipcMain.handle("discovery:trailer:open", async (_event, key: unknown) => {
    if (typeof key !== "string" || !/^[A-Za-z0-9_-]{6,20}$/.test(key)) {
      throw new Error("Invalid trailer identifier.");
    }
    await shell.openExternal(`https://www.youtube.com/watch?v=${encodeURIComponent(key)}`);
  });
  ipcMain.handle("profiles:list", () => workflowProfileService.list());
  ipcMain.handle("profiles:save", (_event, profile: unknown) => workflowProfileService.save(expectWorkflowProfileDraft(profile)));
  ipcMain.handle("profiles:delete", (_event, id: unknown) => workflowProfileService.delete(expectId(id, "workflow id")));
  ipcMain.handle("media:batch:getResumable", () => mediaBatchSessionService.getResumable());
  ipcMain.handle("media:batch:save", (_event, checkpoint: unknown) =>
    mediaBatchSessionService.save(expectMediaBatchCheckpoint(checkpoint))
  );
  ipcMain.handle("media:batch:discard", (_event, id: unknown) =>
    mediaBatchSessionService.discard(expectOptionalId(id, "media batch id"))
  );
  ipcMain.handle("translation:session:getLatest", () =>
    new TranslationSessionStore(join(app.getPath("userData"), "translation-sessions.json")).getLatestSession()
  );
  ipcMain.handle("translation:stats:get", async (_event, sessionId: unknown) =>
    (await getTranslationManager()).getStats(expectOptionalId(sessionId, "translation session id"))
  );
  for (const channel of ["subtitle:exportTrack", "subtitle:exportTracks"] as const) {
    ipcMain.handle(channel, async (event, requestInput: unknown) => {
      const request = channel === "subtitle:exportTrack"
        ? expectSubtitleExportRequest(requestInput)
        : expectSubtitleExportManyRequest(requestInput);
      if (subtitleExportAbortController) throw new Error("A subtitle export is already running.");
      const controller = new AbortController();
      subtitleExportAbortController = controller;
      const onProgress = (progress: { completedImages: number; totalImages: number; readableCues: number }) => {
        if (!event.sender.isDestroyed()) event.sender.send("translation:progress", {
          stage: "Exporting subtitles · OCR",
          message: `Recognized ${progress.completedImages}/${progress.totalImages} images (${progress.readableCues} cues). No translation is performed.`
        });
      };
      try {
        return channel === "subtitle:exportTrack"
          ? await exportSubtitleTrack(request as SubtitleExportRequest, controller.signal, onProgress)
          : await exportSubtitleTracks(request as SubtitleExportManyRequest, controller.signal, onProgress);
      } finally {
        if (subtitleExportAbortController === controller) subtitleExportAbortController = undefined;
      }
    });
  }
  ipcMain.handle("translation:dryRun", async (_event, request: unknown) =>
    (await getTranslationManager()).dryRun(expectDryRunRequest(request))
  );
  ipcMain.handle("translation:start", async (event, request: unknown) =>
    (await getTranslationManager()).translate(expectTranslationJobRequest(request), (message: ProgressMessage) => {
      event.sender.send("translation:progress", message);
    })
  );
  ipcMain.handle("batch:start", async (event, request: unknown) =>
    (await getTranslationManager()).batchTranslate(
      expectBatchJobRequest(request),
      (items: BatchItemProgress[]) => {
        event.sender.send("batch:progress", items);
      },
      (message: ProgressMessage) => {
        event.sender.send("translation:progress", message);
      }
    )
  );
  const sendMediaProgress = (event: IpcMainInvokeEvent) => (message: MediaTransformProgress) => {
    if (!event.sender.isDestroyed()) event.sender.send("media:progress", message);
  };
  ipcMain.handle("media:start", (event, requestInput: unknown) => {
    const request = expectMediaTransformRequest(requestInput);
    return runExclusiveMediaJob((signal) => transformMedia(request, sendMediaProgress(event), signal));
  });
  ipcMain.handle("media:translation:prepare", (event, requestInput: unknown) => {
    const request = expectMediaPreparationRequest(requestInput);
    return runExclusiveMediaJob(async (signal) => {
      const preparation = await prepareMediaForTranslation(request, sendMediaProgress(event), signal);
      const id = randomUUID();
      mediaTranslationPreparations.set(id, preparation);
      return { id, extractedSubtitlePath: preparation.extractedSubtitlePath };
    });
  });
  ipcMain.handle("media:translation:finalize", async (event, idInput: unknown, subtitlePathInput: unknown) => {
    const id = expectId(idInput, "prepared media job");
    const subtitlePath = expectPath(subtitlePathInput, "subtitle path");
    const preparation = mediaTranslationPreparations.get(id);
    if (!preparation) {
      throw new Error("The prepared media job is no longer available.");
    }
    return runExclusiveMediaJob(async (signal) => {
      const result = await finalizeMediaTranslation(
        preparation,
        { subtitlePath, subtitleEncodingId: "utf-8", subtitleLanguage: "bul", subtitleTitle: "Bulgarian" },
        sendMediaProgress(event),
        signal
      );
      mediaTranslationPreparations.delete(id);
      return result;
    });
  });
  ipcMain.handle("media:translation:discard", async (_event, idInput: unknown) => {
    const id = expectId(idInput, "prepared media job");
    const preparation = mediaTranslationPreparations.get(id);
    if (!preparation) {
      return;
    }
    mediaTranslationPreparations.delete(id);
    await discardMediaTranslationPreparation(preparation);
  });
  ipcMain.handle("media:cancel", () => {
    mediaAbortController?.abort();
  });
  ipcMain.handle("translation:cancel", async () => {
    subtitleExportAbortController?.abort();
    if (translationManagerPromise) {
      (await translationManagerPromise).cancel();
    }
  });
  ipcMain.handle("shell:openPath", async (_event, pathInput: unknown) => {
    const path = expectPath(pathInput, "media file path");
    // shell.openPath launches executables, so only open files the library tracks.
    const library = await getCombinedDownloadedLibrary(false);
    if (!isDownloadedLibraryFile(library.titles, path)) {
      throw new Error("Only downloaded library files can be opened.");
    }
    const openError = await shell.openPath(path);
    if (openError) {
      throw new Error(openError);
    }
  });
  ipcMain.handle("shell:showItemInFolder", (_event, path: unknown) => shell.showItemInFolder(expectPath(path, "file path")));
}

async function getCombinedDownloadedLibrary(rescan: boolean) {
  const locationState = await downloadLocationService.list();
  const availableLocations = locationState.locations.filter((location) => location.isAvailable);
  const snapshots = await Promise.all(availableLocations.map(async (location) => ({
    location,
    snapshot: rescan
      ? await downloadedLibraryService.rescan(location.path)
      : await downloadedLibraryService.getLibrary(location.path)
  })));
  const defaultLocation = locationState.locations.find((location) => location.isDefault)
    ?? locationState.locations[0];
  const rootDirectory = defaultLocation?.path ?? app.getPath("downloads");
  return {
    rootDirectory,
    moviesDirectory: join(rootDirectory, "Movies"),
    seriesDirectory: join(rootDirectory, "TV Shows"),
    locations: locationState.locations,
    titles: snapshots.flatMap(({ location, snapshot }) =>
      snapshot.titles.map((title) => ({
        ...title,
        libraryLocationId: location.id,
        libraryLocationLabel: location.label
      }))
    ).sort((left, right) => right.downloadedAt.localeCompare(left.downloadedAt)),
    scannedAt: new Date().toISOString()
  };
}
