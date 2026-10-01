import type { WorkflowProfile, WorkflowProfileDraft } from "../main/workflowProfileService";
import type { SubtitleTranslatorApi } from "../preload";
import type {
  CatalogDetails,
  CatalogItem,
  DiscoveryInteraction,
  DiscoveryPreferences,
  DownloadProgress,
  StreamingCatalogueRequest,
  TorrentSource
} from "../core/discovery/DiscoveryTypes";
import { catalogItemKey } from "../core/discovery/DiscoveryTypes";
import { discoveryGenreId } from "../core/discovery/DiscoveryFilters";
import type { AppSettings } from "../main/settingsService";
import type { DownloadLocationState } from "../core/downloads/DownloadLocations";

const demoItems: CatalogItem[] = [
  demoItem("tt1727587", "Sintel", "movie", ["Animation", "Adventure"], "2010-09-27", 7.4),
  demoItem("tt1254207", "Big Buck Bunny", "movie", ["Animation", "Comedy"], "2008-04-10", 7.1),
  demoItem("tt2395695", "Cosmos: A Spacetime Odyssey", "series", ["Documentary"], "2014-03-09", 8.5),
  demoItem("tt0017925", "The General", "movie", ["Comedy", "Adventure"], "1926-12-25", 8.0),
  demoItem("tt0063350", "Night of the Living Dead", "movie", ["Horror"], "1968-10-04", 7.6),
  demoItem("tt1748166", "Pioneer One", "series", ["Sci-Fi", "Drama"], "2010-06-16", 6.9),
  demoItem("tt3268458", "The Internet's Own Boy", "movie", ["Documentary"], "2014-06-27", 8.0),
  demoItem("tt0807840", "Elephants Dream", "movie", ["Animation", "Sci-Fi"], "2006-03-24", 6.5)
];

let preferences: DiscoveryPreferences = {
  language: "en-US",
  region: "BG",
  preferredMediaType: "all",
  preferredQuality: "1080p",
  maxSizeGb: 30,
  minSeeders: 0,
  defaultDownloadDirectory: "D:\\Downloads"
};
let interactions: DiscoveryInteraction[] = [];
const downloadListeners = new Set<(progress: DownloadProgress) => void>();
let activeDemoDownload: Pick<DownloadProgress, "id" | "filename" | "receivedBytes" | "totalBytes"> | undefined;
let downloadLocationState: DownloadLocationState = {
  defaultLocationId: "demo-main",
  scannedAt: new Date().toISOString(),
  locations: [{
    id: "demo-main",
    label: "Downloads",
    path: "D:\\Downloads",
    isExternal: false,
    isAvailable: true,
    isDefault: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString()
  }]
};

export function installDevSubtitleTranslatorMock(): void {
  if (window.subtitleTranslator) {
    return;
  }
  const notAvailable = async (): Promise<never> => {
    throw new Error("This action requires the Electron desktop runtime.");
  };
  const demoSettings: AppSettings = {
    targetLanguage: "Bulgarian",
    targetLanguageCode: "bg",
    providerId: "mock",
    quality: "balanced",
    contextMode: "auto",
    outputConflictMode: "versioned",
    batchUnlocked: false,
    gemini: {
      modelId: "gemini-3.1-flash-lite",
      thinkingLevel: "auto",
      qualityTuningVersion: 1,
      temperature: 0.1,
      maxOutputTokens: 8192,
      useStructuredJson: true,
      apiSurface: "models.generateContent",
      rateLimitMode: "auto-safe",
      manualRateLimits: {
        rpmLimit: 15,
        tpmLimit: 250_000,
        rpdLimit: 500,
        stopAfterDailyPercentage: 90,
        maxConcurrentRequests: 1
      }
    },
    vercel: {
      modelId: "google/gemini-3.1-flash-lite",
      temperature: 0.2,
      maxOutputTokens: 8192,
      apiSurface: "openai.chat.completions",
      rateLimitMode: "auto-safe",
      manualRateLimits: {
        rpmLimit: 15,
        tpmLimit: 250_000,
        rpdLimit: 500,
        stopAfterDailyPercentage: 90,
        maxConcurrentRequests: 1
      }
    }
  };
  let demoWorkflows: WorkflowProfile[] = [];
  const api = {
    getSettings: async () => demoSettings,
    hasGeminiApiKey: async () => false,
    hasVercelApiKey: async () => false,
    getLatestSession: async () => undefined,
    getWorkflowProfiles: async () => demoWorkflows,
    onProgress: () => () => undefined,
    onBatchProgress: () => () => undefined,
    onMediaProgress: () => () => undefined,
    getDiscoveryCredentialStatus: async () => ({ hasRealDebridToken: true, hasMdblistApiKey: true }),
    setRealDebridApiToken: async () => ({ connected: true, username: "demo-user", accountType: "premium" }),
    clearRealDebridApiToken: async () => undefined,
    setOtherDebridApiToken: async () => ({ connected: true, username: "demo-user" }),
    clearOtherDebridApiToken: async () => undefined,
    setMdblistApiKey: async () => undefined,
    clearMdblistApiKey: async () => undefined,
    getRealDebridStatus: async () => ({
      connected: true,
      username: "demo-user",
      accountType: "premium",
      premiumUntil: "2027-01-01T00:00:00.000Z"
    }),
    getDiscoveryState: async () => ({ preferences, interactions }),
    saveDiscoveryPreferences: async (next: DiscoveryPreferences) => {
      preferences = next;
      return preferences;
    },
    setDiscoveryInteraction: async (item: CatalogItem, action: keyof Pick<DiscoveryInteraction, "liked" | "disliked" | "watched" | "watchlisted" | "hidden">, active: boolean) => {
      const key = catalogItemKey(item);
      const existing = interactions.find((entry) => entry.key === key);
      const saved: DiscoveryInteraction = {
        key,
        item,
        liked: existing?.liked ?? false,
        disliked: existing?.disliked ?? false,
        watched: existing?.watched ?? false,
        watchedEpisodes: existing?.watchedEpisodes ?? [],
        knownEpisodeCount: existing?.knownEpisodeCount,
        watchedManually: existing?.watchedManually ?? false,
        watchlisted: existing?.watchlisted ?? false,
        hidden: existing?.hidden ?? false,
        updatedAt: new Date().toISOString(),
        [action]: active
      };
      if (action === "liked" && active) {
        saved.disliked = false;
      }
      if (action === "disliked" && active) {
        saved.liked = false;
      }
      if (action === "watched") {
        saved.watchedManually = active;
        if (!active) {
          saved.watchedEpisodes = [];
          saved.knownEpisodeCount = undefined;
        }
      }
      interactions = [saved, ...interactions.filter((entry) => entry.key !== key)];
      return saved;
    },
    setDiscoveryEpisodeWatched: async (
      media: CatalogDetails,
      season: number,
      episode: number,
      active: boolean
    ) => {
      const key = catalogItemKey(media);
      const existing = interactions.find((entry) => entry.key === key);
      const knownEpisodes = media.seasons
        .filter((item) => item.seasonNumber > 0)
        .flatMap((item) => Array.from(
          { length: item.episodeCount },
          (_, index) => `s${item.seasonNumber}e${index + 1}`
        ));
      const watchedEpisodes = new Set(existing?.watchedEpisodes ?? []);
      if (existing?.watchedManually) {
        knownEpisodes.forEach((episodeId) => watchedEpisodes.add(episodeId));
      }
      const episodeId = `s${season}e${episode}`;
      if (active) watchedEpisodes.add(episodeId);
      else watchedEpisodes.delete(episodeId);
      const saved: DiscoveryInteraction = {
        key,
        item: media,
        liked: existing?.liked ?? false,
        disliked: existing?.disliked ?? false,
        watched: knownEpisodes.length > 0 && knownEpisodes.every((id) => watchedEpisodes.has(id)),
        watchedEpisodes: [...watchedEpisodes],
        knownEpisodeCount: knownEpisodes.length,
        watchedManually: false,
        watchlisted: existing?.watchlisted ?? false,
        hidden: existing?.hidden ?? false,
        updatedAt: new Date().toISOString()
      };
      interactions = [saved, ...interactions.filter((entry) => entry.key !== key)];
      return saved;
    },
    clearDiscoveryInteractions: async () => {
      interactions = [];
    },
    getDiscoveryHome: async () => ({
      generatedAt: new Date().toISOString(),
      sections: [
        {
          id: "recommended-movies",
          title: "Recommended movies",
          subtitle: "Development preview using lawfully distributed and public-domain titles.",
          items: demoItems.filter((item) => item.mediaType === "movie")
        },
        {
          id: "recommended-series",
          title: "Recommended TV shows",
          subtitle: "Development preview using lawfully distributed and public-domain titles.",
          items: demoItems.filter((item) => item.mediaType === "series")
        },
        { id: "open-films", title: "Open and public releases", items: [...demoItems].reverse() }
      ]
    }),
    searchDiscoveryCatalog: async (query: string) =>
      demoItems.filter((item) => item.title.toLowerCase().includes(query.toLowerCase())),
    getDiscoveryDetails: async (mediaType: CatalogItem["mediaType"], id: string) =>
      detailsFor(demoItems.find((item) => item.id === id && item.mediaType === mediaType) ?? demoItems[0]),
    getDiscoveryStreamingAvailability: async (items: Array<Pick<CatalogItem, "id" | "mediaType">>) => ({
      entries: items.map((item, index) => ({
        key: catalogItemKey(item),
        services: index % 2 === 0 ? ["netflix" as const, "prime-video" as const] : ["mubi" as const]
      })),
      checkedItems: items.length,
      failedItems: 0
    }),
    getDiscoveryStreamingCatalogue: async (request: StreamingCatalogueRequest) => {
      const items = demoItems.filter((item) =>
        (request.mediaType === "all" || item.mediaType === request.mediaType)
        && (request.genreIds.length === 0 || request.genreIds.some((id) => item.genreIds.includes(id)))
        && item.voteAverage >= request.minimumRating
        && (!request.query || item.title.toLocaleLowerCase().includes(request.query.toLocaleLowerCase()))
      );
      return {
        items: request.skip === 0 ? items : [],
        nextSkip: request.skip + 100,
        hasMore: request.skip === 0,
        scannedItems: demoItems.length,
        failedItems: 0
      };
    },
    getDiscoveryRatings: async (items: Array<Pick<CatalogItem, "id" | "mediaType">>) => ({
      entries: items.map((item) => ({
        key: catalogItemKey(item),
        ratings: [
          { source: "tomatoes" as const, value: 84 },
          { source: "popcorn" as const, value: 79 },
          { source: "metacritic" as const, value: 74 }
        ]
      })),
      checkedItems: items.length,
      failedItems: 0
    }),
    openMdblistApiKeyPage: async () => undefined,
    searchTorrentSources: async () => ({
      sources: demoSources(),
      providerErrors: [],
      searchedAt: new Date().toISOString()
    }),
    getVerifiedRealDebridSources: async ({ sources }: { sources: TorrentSource[] }) =>
      sources.filter((source) => source.providerClaimedCached).map((source) => ({
        ...source,
        cacheStatus: "provider-claimed-cached" as const
      })),
    getTorrentClientStatus: async () => ({ available: true, applicationName: "Demo Torrent Client" }),
    openTorrentSource: async () => true,
    startTorrentDownload: async ({ source }: { source: TorrentSource }) => {
      const id = "demo-torrent-download";
      downloadListeners.forEach((listener) => listener({
        id, method: "torrent", filename: source.name,
        receivedBytes: 2 * 1024 ** 3, totalBytes: 2 * 1024 ** 3,
        percent: 100, status: "completed", outputPath: `Demo/Movies/${source.name}.mkv`
      }));
      return `Demo/Movies/${source.name}.mkv`;
    },
    cancelTorrentDownload: async () => undefined,
    getTorrentSeedStatus: async () => "unavailable" as const,
    startTorrentSeeding: async () => undefined,
    stopTorrentSeeding: async () => undefined,
    startRealDebridDownload: async ({ source }: { source: TorrentSource }) => {
      const id = "demo-download";
      activeDemoDownload = {
        id,
        filename: source.name,
        receivedBytes: 512 * 1024 ** 2,
        totalBytes: 2 * 1024 ** 3
      };
      downloadListeners.forEach((listener) => listener({
        ...activeDemoDownload!,
        percent: 25,
        status: "downloading"
      }));
      return undefined;
    },
    cancelRealDebridDownload: async () => {
      if (!activeDemoDownload) {
        return;
      }
      downloadListeners.forEach((listener) => listener({
        ...activeDemoDownload!,
        percent: 25,
        status: "cancelled",
        message: "Download cancelled in the development preview."
      }));
      activeDemoDownload = undefined;
    },
    chooseDiscoveryDownloadDirectory: async () => "D:\\Downloads",
    getDownloadLocations: async () => downloadLocationState,
    addDownloadLocation: async () => {
      const now = new Date().toISOString();
      downloadLocationState = {
        ...downloadLocationState,
        scannedAt: now,
        locations: [...downloadLocationState.locations, {
          id: `demo-${downloadLocationState.locations.length + 1}`,
          label: "External Media",
          path: "E:\\SubsTranslate",
          isExternal: false,
          isAvailable: true,
          isDefault: false,
          createdAt: now,
          updatedAt: now,
          lastSeenAt: now
        }]
      };
      return downloadLocationState;
    },
    setDefaultDownloadLocation: async (id: string) => {
      downloadLocationState = {
        ...downloadLocationState,
        defaultLocationId: id,
        locations: downloadLocationState.locations.map((location) => ({
          ...location,
          isDefault: location.id === id
        }))
      };
      return downloadLocationState;
    },
    setDownloadLocationExternal: async (id: string, external: boolean) => {
      downloadLocationState = {
        ...downloadLocationState,
        locations: downloadLocationState.locations.map((location) =>
          location.id === id ? { ...location, isExternal: external } : location
        )
      };
      return downloadLocationState;
    },
    removeDownloadLocation: async (id: string) => {
      downloadLocationState = {
        ...downloadLocationState,
        locations: downloadLocationState.locations.filter((location) => location.id !== id)
      };
      return downloadLocationState;
    },
    scanExternalDownloadLocations: async () => ({
      ...downloadLocationState,
      scannedAt: new Date().toISOString()
    }),
    getDownloadedLibrary: async () => ({
      rootDirectory: "D:\\Downloads",
      moviesDirectory: "D:\\Downloads\\Movies",
      seriesDirectory: "D:\\Downloads\\TV Shows",
      scannedAt: new Date().toISOString(),
      locations: downloadLocationState.locations,
      titles: []
    }),
    rescanDownloadedLibrary: async () => ({
      rootDirectory: "D:\\Downloads",
      moviesDirectory: "D:\\Downloads\\Movies",
      seriesDirectory: "D:\\Downloads\\TV Shows",
      scannedAt: new Date().toISOString(),
      locations: downloadLocationState.locations,
      titles: []
    }),
    deleteDownloadedFile: notAvailable,
    openDiscoveryTrailer: async () => undefined,
    onDiscoveryDownloadProgress: (listener: (progress: DownloadProgress) => void) => {
      downloadListeners.add(listener);
      return () => downloadListeners.delete(listener);
    },
    openPath: async () => undefined,
    showItemInFolder: async () => undefined,
    chooseVideo: notAvailable,
    chooseVideos: notAvailable,
    chooseOutputFolder: notAvailable,
    chooseSubtitleFile: notAvailable,
    chooseSubtitleFiles: notAvailable,
    probeVideo: notAvailable,
    saveSettings: notAvailable,
    setGeminiApiKey: notAvailable,
    setVercelApiKey: notAvailable,
    saveWorkflowProfile: async (draft: WorkflowProfileDraft) => {
      const now = new Date().toISOString();
      const saved: WorkflowProfile = { ...draft, id: draft.id ?? crypto.randomUUID(), createdAt: now, updatedAt: now };
      demoWorkflows = [...demoWorkflows.filter((profile) => profile.id !== saved.id), saved];
      return saved;
    },
    deleteWorkflowProfile: async (id: string) => { demoWorkflows = demoWorkflows.filter((profile) => profile.id !== id); },
    getResumableMediaBatch: async () => undefined,
    saveMediaBatchCheckpoint: notAvailable,
    discardMediaBatchCheckpoint: notAvailable,
    dryRun: notAvailable,
    getTranslationStats: async () => ({
      runs: [],
      latestExchanges: [],
      selectedExchanges: [],
      pricingNotes: ["Development preview data."],
      storageDirectory: ""
    }),
    exportSubtitleTrack: notAvailable,
    exportSubtitleTracks: notAvailable,
    startMediaTransform: notAvailable,
    prepareMediaForTranslation: notAvailable,
    finalizeMediaTranslation: notAvailable,
    discardMediaTranslationPreparation: async () => undefined,
    cancelMediaTransform: notAvailable,
    startTranslation: notAvailable,
    startBatch: notAvailable,
    cancelTranslation: notAvailable
  };
  window.subtitleTranslator = api as SubtitleTranslatorApi;
}

function demoItem(
  id: string,
  title: string,
  mediaType: CatalogItem["mediaType"],
  genreNames: string[],
  releaseDate: string,
  voteAverage: number
): CatalogItem {
  return {
    id,
    title,
    mediaType,
    genreIds: genreNames.map(discoveryGenreId),
    releaseDate,
    voteAverage,
    voteCount: 2_000,
    popularity: 80,
    posterPath: `https://images.metahub.space/poster/small/${id}/img`,
    backdropPath: `https://images.metahub.space/background/medium/${id}/img`,
    overview: `${title} is included as a development fixture for the Discover interface.`
  };
}

function detailsFor(item: CatalogItem): CatalogDetails {
  return {
    ...item,
    imdbId: item.id,
    runtimeMinutes: item.mediaType === "movie" ? 92 : 48,
    genres: item.genreIds.map((id) => ({ id, name: "Demo genre" })),
    cast: [
      { id: 1, name: "Development Cast" },
      { id: 2, name: "Open Media Contributor" }
    ],
    crew: [{ id: 3, name: "Demo Director", job: "Director" }],
    videos: [{ key: "aqz-KE-bpKQ", name: "Trailer", site: "YouTube", type: "Trailer", official: true }],
    seasons: item.mediaType === "series"
      ? [
        { seasonNumber: 1, name: "Season 1", episodeCount: 8 },
        { seasonNumber: 2, name: "Season 2", episodeCount: 6 }
      ]
      : [],
    recommendations: demoItems.filter((candidate) => candidate.id !== item.id).slice(0, 5),
    tagline: "A safe development preview"
  };
}

function demoSources(): TorrentSource[] {
  return [
    {
      id: "demo-source-1",
      provider: "Built-in torrent search",
      infoHash: "a".repeat(40),
      fileIndex: 0,
      name: "Open.Media.Release.2026.1080p.HEVC.HDR10.mkv",
      sizeBytes: 2 * 1024 ** 3,
      seeders: 142,
      quality: "1080p",
      codec: "HEVC",
      hdr: "HDR10",
      audio: "AAC",
      audioLanguages: ["English"],
      trackers: [],
      observedAt: new Date().toISOString(),
      providerClaimedCached: true,
      cacheStatus: "provider-claimed-cached"
    },
    {
      id: "demo-source-2",
      provider: "Built-in torrent search",
      infoHash: "b".repeat(40),
      fileIndex: 0,
      name: "Open.Media.Release.2026.720p.H264.mkv",
      sizeBytes: 950 * 1024 ** 2,
      seeders: 36,
      quality: "720p",
      codec: "H264",
      audio: "AAC",
      audioLanguages: ["English"],
      trackers: [],
      observedAt: new Date().toISOString(),
      providerClaimedCached: false,
      cacheStatus: "unknown"
    }
  ];
}
