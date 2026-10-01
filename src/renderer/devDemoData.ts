import type { DownloadedLibraryTitle } from "../core/downloads/DownloadedLibrary";
import type { ProbeResult } from "../core/video/ProbeResult";
import type { SubtitleTrack } from "../core/video/SubtitleTrack";
import type { ModelExchangeAuditRecord, TranslationRunSummary } from "../main/translationHistoryStore";
import type { ProgressMessage } from "../main/translationManager";
import type { WorkflowProfile } from "../main/workflowProfileService";

/**
 * Richer fixtures for previewing the renderer in a plain browser (`vite dev`).
 * Only main.tsx installs these; tests keep using the minimal mock.
 */
export function installDevDemoData(): void {
  const api = window.subtitleTranslator;
  const progressListeners = new Set<(message: ProgressMessage) => void>();
  const demoVideos = [
    "D:\\Downloads\\Movies\\Sintel (2010)\\Sintel.2010.1080p.mkv",
    "D:\\Downloads\\Movies\\Big Buck Bunny (2008)\\Big.Buck.Bunny.2008.1080p.mkv"
  ];
  let workflows = demoWorkflows();

  Object.assign(api, {
    chooseVideo: async () => demoVideos[0],
    chooseVideos: async () => demoVideos,
    chooseOutputFolder: async () => "D:\\Subtitles",
    chooseSubtitleFile: async () => "D:\\Subtitles\\Sintel.2010.1080p.bg.srt",
    chooseSubtitleFiles: async () => ["D:\\Subtitles\\Sintel.2010.1080p.bg.srt"],
    probeVideo: async (filePath: string) => demoProbe(filePath),
    saveSettings: async (settings: unknown) => settings,
    setGeminiApiKey: async () => undefined,
    setVercelApiKey: async () => undefined,
    getWorkflowProfiles: async () => workflows,
    saveWorkflowProfile: async (draft: WorkflowProfile) => {
      const now = new Date().toISOString();
      const saved = { ...draft, id: draft.id ?? crypto.randomUUID(), createdAt: now, updatedAt: now };
      workflows = [...workflows.filter((profile) => profile.id !== saved.id), saved];
      return saved;
    },
    deleteWorkflowProfile: async (id: string) => {
      workflows = workflows.filter((profile) => profile.id !== id);
    },
    dryRun: async () => ({
      cueCount: 1_184,
      chunkCount: 24,
      estimatedInputTokens: 48_200,
      estimatedRequests: 24,
      canLikelyFinishToday: true,
      dailyRequestLimit: 500
    }),
    onProgress: (listener: (message: ProgressMessage) => void) => {
      progressListeners.add(listener);
      return () => progressListeners.delete(listener);
    },
    startTranslation: async (request: { videoPath: string }) => {
      for (let chunk = 1; chunk <= 6; chunk += 1) {
        await delay(350);
        progressListeners.forEach((listener) => listener({
          stage: "Translating",
          message: `Translated chunk ${chunk} of 6.`,
          completedChunks: chunk,
          totalChunks: 6,
          progressPercent: (chunk / 6) * 100
        } as ProgressMessage));
      }
      return {
        outputPath: request.videoPath.replace(/\.[^.\\]+$/, ".bg.srt"),
        cueCount: 1_184,
        chunkCount: 6,
        cacheHits: 2,
        warnings: []
      };
    },
    cancelTranslation: async () => undefined,
    getDownloadedLibrary: async () => demoLibrary(),
    rescanDownloadedLibrary: async () => demoLibrary(),
    getTorrentSeedStatus: async () => "stopped" as const,
    getTranslationStats: async (sessionId?: string) => demoStats(sessionId)
  });

  function demoLibrary() {
    return {
      rootDirectory: "D:\\Downloads",
      moviesDirectory: "D:\\Downloads\\Movies",
      seriesDirectory: "D:\\Downloads\\TV Shows",
      scannedAt: new Date().toISOString(),
      locations: [
        {
          id: "demo-main",
          label: "Downloads",
          path: "D:\\Downloads",
          isExternal: false,
          isAvailable: true,
          isDefault: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString()
        },
        {
          id: "demo-backup",
          label: "Backup Drive",
          path: "E:\\Media",
          isExternal: true,
          isAvailable: false,
          isDefault: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString()
        }
      ],
      titles: demoTitles()
    };
  }
}

function demoProbe(filePath: string): ProbeResult {
  const subtitle = (index: number, language: string, codecName: string, title: string): SubtitleTrack => {
    const image = codecName === "hdmv_pgs_subtitle";
    return {
      index,
      codecName,
      codecType: "subtitle",
      language,
      title,
      isSupported: true,
      isTextBased: !image,
      isImageBased: image,
      requiresOcr: image,
      supportedFormat: image ? "pgs" : "srt"
    };
  };
  return {
    filePath,
    formatName: "matroska,webm",
    durationSeconds: 888,
    videoTracks: [{ index: 0, codecName: "hevc", codecType: "video" }],
    audioTracks: [
      { index: 1, codecName: "eac3", codecType: "audio", language: "eng", title: "English 5.1", channels: 6, channelLayout: "5.1(side)", bitRate: 640_000 },
      { index: 2, codecName: "aac", codecType: "audio", language: "eng", title: "Commentary", channels: 2, bitRate: 160_000 }
    ],
    subtitleTracks: [
      subtitle(3, "eng", "subrip", "English"),
      subtitle(4, "eng", "subrip", "English SDH"),
      subtitle(5, "fre", "hdmv_pgs_subtitle", "Français"),
      { ...subtitle(6, "ger", "dvd_subtitle", "Deutsch"), isSupported: false, isTextBased: false, isImageBased: true, requiresOcr: false, supportedFormat: undefined, reason: "Unsupported image subtitle codec." }
    ],
    otherStreams: []
  };
}

function demoWorkflows(): WorkflowProfile[] {
  const now = new Date().toISOString();
  const settings = {
    targetLanguage: "Bulgarian",
    targetLanguageCode: "bg",
    providerId: "mock",
    quality: "balanced",
    contextMode: "auto",
    outputConflictMode: "versioned",
    batchUnlocked: false
  } as unknown as WorkflowProfile["config"]["translation"]["settings"];
  const media = {
    enabled: true,
    audioEnabled: true,
    audioProfileId: "ac3-5-1",
    audioGainDb: 0,
    keepOnlySelectedAudioTrack: false,
    subtitlesEnabled: true,
    subtitleEncodingId: "utf-8",
    keepOnlyNewSubtitleTrack: false,
    outputConflictMode: "versioned",
    outputMode: "new-file",
    outputContainerId: "mkv"
  } as const;
  return [
    {
      id: "demo-tv",
      name: "TV night · Bulgarian subs + AC-3",
      kind: "workflow",
      createdAt: now,
      updatedAt: now,
      config: {
        translation: { enabled: true, settings, sampleMode: "none", trackPreference: "english" },
        media
      }
    },
    {
      id: "demo-subs",
      name: "Subtitles only",
      kind: "workflow",
      createdAt: now,
      updatedAt: now,
      config: {
        translation: { enabled: true, settings, sampleMode: "none", trackPreference: "english" },
        media: { ...media, enabled: false }
      }
    }
  ];
}

function demoTitles(): DownloadedLibraryTitle[] {
  const now = new Date().toISOString();
  const file = (id: string, path: string, sizeBytes: number, season?: number, episode?: number) => ({
    id,
    path,
    filename: path.split("\\").pop()!,
    sizeBytes,
    modifiedAt: now,
    downloadedAt: now,
    season,
    episode,
    processedDirectoryPath: path.slice(0, path.lastIndexOf("\\")) + "\\Processed"
  });
  return [
    {
      key: "movie:tt1727587",
      catalogId: "tt1727587",
      imdbId: "tt1727587",
      mediaType: "movie",
      title: "Sintel",
      releaseDate: "2010-09-27",
      overview: "A lonely young woman helps and befriends a dragon, whom she calls Scales.",
      posterPath: "https://images.metahub.space/poster/small/tt1727587/img",
      directoryPath: "D:\\Downloads\\Movies\\Sintel (2010)",
      processedDirectoryPath: "D:\\Downloads\\Movies\\Sintel (2010)\\Processed",
      downloadedAt: now,
      totalBytes: 2.1 * 1024 ** 3,
      files: [file("f-sintel", "D:\\Downloads\\Movies\\Sintel (2010)\\Sintel.2010.1080p.mkv", 2.1 * 1024 ** 3)],
      libraryLocationId: "demo-main",
      libraryLocationLabel: "Downloads"
    },
    {
      key: "series:tt2395695",
      catalogId: "tt2395695",
      imdbId: "tt2395695",
      mediaType: "series",
      title: "Cosmos: A Spacetime Odyssey",
      releaseDate: "2014-03-09",
      overview: "An exploration of our discovery of the laws of nature and coordinates in space and time.",
      posterPath: "https://images.metahub.space/poster/small/tt2395695/img",
      directoryPath: "D:\\Downloads\\TV Shows\\Cosmos",
      processedDirectoryPath: "D:\\Downloads\\TV Shows\\Cosmos\\Processed",
      downloadedAt: now,
      totalBytes: 4.4 * 1024 ** 3,
      files: [1, 2, 3, 4].map((episode) => file(
        `f-cosmos-${episode}`,
        `D:\\Downloads\\TV Shows\\Cosmos\\Season 01\\Cosmos.S01E0${episode}.1080p.mkv`,
        1.1 * 1024 ** 3,
        1,
        episode
      )),
      libraryLocationId: "demo-main",
      libraryLocationLabel: "Downloads"
    },
    {
      key: "movie:tt1254207",
      catalogId: "tt1254207",
      imdbId: "tt1254207",
      mediaType: "movie",
      title: "Big Buck Bunny",
      releaseDate: "2008-04-10",
      directoryPath: "D:\\Downloads\\Movies\\Big Buck Bunny (2008)",
      processedDirectoryPath: "D:\\Downloads\\Movies\\Big Buck Bunny (2008)\\Processed",
      downloadedAt: now,
      totalBytes: 0.9 * 1024 ** 3,
      files: [file("f-bunny", "D:\\Downloads\\Movies\\Big Buck Bunny (2008)\\Big.Buck.Bunny.2008.1080p.mkv", 0.9 * 1024 ** 3)],
      libraryLocationId: "demo-main",
      libraryLocationLabel: "Downloads"
    }
  ];
}

function demoStats(sessionId?: string) {
  const runs: TranslationRunSummary[] = [0, 1, 2].map((index) => ({
    sessionId: `demo-run-${index}`,
    status: index === 1 ? "failed" : "completed",
    startedAt: new Date(Date.now() - index * 86_400_000).toISOString(),
    completedAt: new Date(Date.now() - index * 86_400_000 + 420_000).toISOString(),
    durationMs: 420_000,
    videoPath: `D:\\Downloads\\Movies\\Demo ${index + 1}.mkv`,
    fileName: ["Sintel.2010.1080p.mkv", "Cosmos.S01E02.1080p.mkv", "Big.Buck.Bunny.2008.1080p.mkv"][index],
    outputPath: `D:\\Downloads\\Movies\\Demo ${index + 1}.bg.srt`,
    track: { index: 3, codecName: "subrip", language: "eng", title: "English" },
    providerId: "gemini",
    providerName: "Gemini",
    modelId: "gemini-3.1-flash-lite",
    sampleMode: "none",
    requestCount: 24 - index * 5,
    failedRequestCount: index === 1 ? 3 : 0,
    usage: { inputTokens: 48_200 - index * 9_000, outputTokens: 31_050 - index * 6_000, totalTokens: 79_250 - index * 15_000 },
    estimatedCostUsd: 0.0214 - index * 0.004,
    pricingSource: "Google AI pricing, September 2026",
    cueCount: 1_184,
    chunkCount: 24,
    cacheHits: 2 + index,
    warningCount: 0,
    auditFilePath: `C:\\Users\\Demo\\AppData\\Roaming\\SubsTranslate\\model-exchanges\\demo-run-${index}.jsonl`,
    lastError: index === 1 ? "429 RESOURCE_EXHAUSTED: daily quota reached." : undefined
  }));
  const selected = runs.find((run) => run.sessionId === sessionId) ?? runs[0];
  const exchanges: ModelExchangeAuditRecord[] = Array.from({ length: 6 }, (_, index) => ({
    id: `${selected.sessionId}-exchange-${index}`,
    sessionId: selected.sessionId,
    providerId: "gemini",
    provider: "Gemini",
    model: selected.modelId,
    startedAt: new Date(Date.now() - (6 - index) * 30_000).toISOString(),
    completedAt: new Date(Date.now() - (6 - index) * 30_000 + 4_200).toISOString(),
    durationMs: 4_200,
    status: index === 4 && selected.failedRequestCount > 0 ? "failed" : "success",
    chunkIndex: index,
    request: {} as ModelExchangeAuditRecord["request"],
    prompt: `Translate the following English subtitle cues into natural Bulgarian.\n\n[${index * 50 + 1}] Where are you going?\n[${index * 50 + 2}] To find the dragon.`,
    rawOutput: `{"cues":[{"id":${index * 50 + 1},"text":"Къде отиваш?"},{"id":${index * 50 + 2},"text":"Да намеря дракона."}]}`,
    usage: { inputTokens: 2_010, outputTokens: 1_290, totalTokens: 3_300 },
    estimatedCostUsd: 0.0009,
    pricingSource: "Google AI pricing, September 2026"
  }));
  return {
    latest: runs[0],
    selected,
    runs,
    latestExchanges: exchanges,
    selectedExchanges: exchanges,
    storageDirectory: "C:\\Users\\Demo\\AppData\\Roaming\\SubsTranslate",
    pricingNotes: ["Costs are estimates based on published per-token prices."]
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
