import { measuredWorkProgress } from "../core/media/MeasuredProgress";
import { app } from "electron";
import { basename, dirname, extname, join } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { createSceneChunks, splitIntoScenes } from "../core/chunking/SceneChunker";
import { TranslationCache, createCacheKey, hashStable, hashText } from "../core/cache/TranslationCache";
import { GeminiRateLimiter, settingsFromManualLimits, unknownFreeTierSettings } from "../core/rateLimit/GeminiRateLimiter";
import { parseSubtitle } from "../core/subtitle/SubtitleParser";
import { SubtitleCue } from "../core/subtitle/SubtitleCue";
import { writeSrt } from "../core/subtitle/SrtWriter";
import { MockTranslationProvider } from "../core/translation/MockTranslationProvider";
import { ModelExchangeRecorder, requestFromChunk, TranslationProvider, TranslationRequest, TranslationResult } from "../core/translation/TranslationProvider";
import {
  getAutomaticTranslationThinkingLevel,
  getTranslationQualityProfile
} from "../core/translation/TranslationQualityProfile";
import { looksLikeUnreadableSource, UNREADABLE_SUBTITLE_PLACEHOLDER } from "../core/translation/TranslationQuality";
import { validateTranslationResult } from "../core/translation/TranslationValidator";
import { SubtitleTrack } from "../core/video/SubtitleTrack";
import { extractSubtitleTrack } from "./subtitleExtractionService";
import { AppSettings, SettingsService } from "./settingsService";
import { isRecoverableQuotaOrCreditError } from "../core/batch/BatchResume";
import { canWriteToDirectory, getDefaultOutputPath, writeSrtSafely } from "./fileSystemService";
import { SavedTranslationSession, TranslationSessionStore } from "./translationSessionStore";
import { TranslationHistoryStore, TranslationStatsView } from "./translationHistoryStore";
import { electronFetch } from "./electronFetch";
import { errorMessage as formatError, isAbortError } from "../core/util/errors";

const TRANSLATION_PROMPT_VERSION = "2026-07-24-v9-quality-auto-fidelity";

export type SampleMode = "none" | "first20" | "firstScene" | "first3Minutes";

export interface TranslationJobRequest {
  videoPath: string;
  track: SubtitleTrack;
  settings: AppSettings;
  sampleMode: SampleMode;
  alternateOutputDirectory?: string;
  extractedSubtitlePath?: string;
}

export interface DryRunRequest {
  videoPath: string;
  track: SubtitleTrack;
  settings: AppSettings;
  sampleMode: SampleMode;
}

export interface DryRunResult {
  cueCount: number;
  chunkCount: number;
  estimatedInputTokens: number;
  estimatedRequests: number;
  canLikelyFinishToday: boolean;
  dailyRequestLimit: number;
}

export interface TranslationJobResult {
  outputPath: string;
  cueCount: number;
  chunkCount: number;
  cacheHits: number;
  warnings: string[];
}

export type BatchStatus =
  | "Waiting"
  | "Probing"
  | "Extracting"
  | "Translating"
  | "Waiting for Gemini quota"
  | "Done"
  | "Failed"
  | "Paused until quota reset";

export interface BatchItemProgress {
  file: string;
  subtitleTrack?: string;
  chunks: number;
  completedChunks: number;
  status: BatchStatus;
  lastError?: string;
  outputPath?: string;
}

export interface BatchJobRequest {
  folderPath: string;
  settings: AppSettings;
  alternateOutputDirectory?: string;
  resumeItems?: BatchItemProgress[];
}

export interface BatchJobResult {
  items: BatchItemProgress[];
}

export type ProgressStage =
  | "Profile ready"
  | "Probing video"
  | "Exporting subtitles"
  | "Extracting subtitles"
  | "Parsing subtitles"
  | "Creating chunks"
  | "Translating"
  | "Waiting for rate limit"
  | "Retrying after rate limit"
  | "Repairing translation"
  | "Validating"
  | "Saving output"
  | "Complete";

export interface ProgressMessage {
  stage: ProgressStage;
  message: string;
  completedChunks?: number;
  totalChunks?: number;
  currentStep?: number;
  totalSteps?: number;
  progressPercent?: number;
}

export class TranslationManager {
  private abortController: AbortController | undefined;
  private translationCache?: TranslationCache;

  constructor(
    private readonly settingsService: SettingsService,
    private sessionStore?: TranslationSessionStore,
    private historyStore?: TranslationHistoryStore
  ) {}

  cancel(): void {
    this.abortController?.abort();
  }

  async getLatestSession(): Promise<SavedTranslationSession | undefined> {
    return this.getSessionStore().getLatestSession();
  }

  async getStats(sessionId?: string): Promise<TranslationStatsView> {
    return this.getHistoryStore().getStats(sessionId);
  }

  async dryRun(request: DryRunRequest): Promise<DryRunResult> {
    const extracted = await extractSubtitleTrack(request.videoPath, request.track);
    const cues = selectSampleCues(parseSubtitle(extracted.content, extracted.format).cues, request.sampleMode);
    const chunks = createSceneChunks(cues, chunkerOptionsForSettings(request.settings));
    const dailyRequestLimit = getDailyRequestLimit(request.settings);
    const estimatedRequests = chunks.length;

    return {
      cueCount: cues.length,
      chunkCount: chunks.length,
      estimatedInputTokens: chunks.reduce((sum, chunk) => sum + chunk.estimatedInputTokens, 0),
      estimatedRequests,
      dailyRequestLimit,
      canLikelyFinishToday: estimatedRequests <= dailyRequestLimit
    };
  }

  async translate(
    request: TranslationJobRequest,
    onProgress: (message: ProgressMessage) => void
  ): Promise<TranslationJobResult> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    const sessionStore = this.getSessionStore();
    const session = await sessionStore.startOrResumeSession(request);
    const historyStore = this.getHistoryStore();
    await historyStore.startRun({
      sessionId: session.id,
      videoPath: request.videoPath,
      track: request.track,
      settings: request.settings,
      sampleMode: request.sampleMode
    });
    let sessionWriteQueue: Promise<unknown> = Promise.resolve();
    const warnings: string[] = [];
    let cacheHits = 0;

    const queueSessionWrite = (write: () => Promise<void>): Promise<unknown> => {
      sessionWriteQueue = sessionWriteQueue.then(write).catch(() => undefined);
      return sessionWriteQueue;
    };
    const emitProgress = (message: ProgressMessage): void => {
      onProgress(message);
      void queueSessionWrite(() => sessionStore.appendProgress(session.id, message));
    };

    const translationStartPercent = request.track.requiresOcr && !request.extractedSubtitlePath ? 30 : 0;
    try {
      emitProgress({
        stage: "Extracting subtitles",
        message: request.extractedSubtitlePath
          ? "Using subtitle text extracted during media preparation."
          : "Extracting selected subtitle track.",
        progressPercent: 0
      });
      const extracted = request.extractedSubtitlePath
        ? {
            filePath: request.extractedSubtitlePath,
            format: request.track.supportedFormat!,
            content: await readFile(request.extractedSubtitlePath, "utf8")
          }
        : await extractSubtitleTrack(request.videoPath, request.track, {
            signal,
            onProgress: (progress) => {
              emitProgress({
                stage: "Extracting subtitles",
                message: `Local OCR processed ${progress.completedImages}/${progress.totalImages} subtitle image(s); ${progress.readableCues} readable cue(s).`,
                currentStep: progress.completedImages,
                totalSteps: progress.totalImages,
                progressPercent: measuredWorkProgress(progress.completedImages, progress.totalImages, 0, translationStartPercent)
              });
            }
          });

      emitProgress({
        stage: "Extracting subtitles",
        message: "Subtitle track extracted.",
        progressPercent: translationStartPercent
      });

      emitProgress({ stage: "Parsing subtitles", message: "Parsing subtitle cues.", progressPercent: translationStartPercent });
      const subtitleDocument = parseSubtitle(extracted.content, extracted.format);
      const selectedCues = selectSampleCues(subtitleDocument.cues, request.sampleMode);

      emitProgress({ stage: "Creating chunks", message: "Creating scene-aware chunks.", progressPercent: translationStartPercent });
      const chunks = createSceneChunks(selectedCues, chunkerOptionsForSettings(request.settings));
      const subtitleFileHash = hashText(extracted.content);
      await queueSessionWrite(() =>
        sessionStore.setSubtitlePlan(session.id, {
          extractedFilePath: extracted.filePath,
          subtitleFileHash,
          cueCount: selectedCues.length,
          chunkCount: chunks.length,
          estimatedInputTokens: chunks.reduce((sum, chunk) => sum + chunk.estimatedInputTokens, 0)
        })
      );
      await queueSessionWrite(() => sessionStore.setChunkPlan(session.id, chunks));

      const provider = await this.createProvider(
        request.settings,
        emitProgress,
        (exchange) => historyStore.recordExchange(session.id, request.settings.providerId, exchange)
      );
      const cache = this.getTranslationCache();
      const translatedTextById = new Map(selectedCues.map((cue) => [cue.id, cue.text]));
      const translationProfile = getTranslationQualityProfile(request.settings.quality);
      // Identical for every chunk of this run.
      const modelId = getModelIdForSettings(request.settings, provider);
      const translationSettingsHash = hashStable({
        quality: request.settings.quality,
        contextMode: request.settings.contextMode,
        providerId: request.settings.providerId,
        modelParameters: translationModelParameters(request.settings)
      });

      let completedCues = 0;
      for (const [index, chunk] of chunks.entries()) {
        signal.throwIfAborted();

        const cacheKey = createCacheKey({
          subtitleFileHash,
          cueIds: chunk.cues.map((cue) => cue.id),
          originalCueTextHash: hashStable(chunk.cues.map((cue) => cue.text)),
          targetLanguage: request.settings.targetLanguage,
          modelId,
          translationSettingsHash,
          promptVersion: TRANSLATION_PROMPT_VERSION
        });
        const translationRequest = {
          ...requestFromChunk(chunk, {
            targetLanguage: request.settings.targetLanguage,
            style: translationProfile.style
          }),
          chunkId: chunk.id,
          chunkIndex: index,
          cacheKey
        };

        emitProgress({
          stage: "Translating",
          message: `Translating chunk ${index + 1}/${chunks.length} · ${completedCues}/${selectedCues.length} cues complete.`,
          completedChunks: index,
          totalChunks: chunks.length,
          progressPercent: measuredWorkProgress(completedCues, selectedCues.length, translationStartPercent)
        });
        await queueSessionWrite(() => sessionStore.markChunk(session.id, chunk.id, "translating", { cacheKey }));

        let result: TranslationResult;
        try {
          const cached = await cache.get(cacheKey);
          if (cached) {
            cacheHits += 1;
            result = cached.result;
            await queueSessionWrite(() =>
              sessionStore.markChunk(session.id, chunk.id, "cache-hit", {
                cacheKey,
                warningCount: result.warnings.length
              })
            );
            emitProgress({
              stage: "Translating",
              message: `Loaded cached chunk ${index + 1}/${chunks.length}.`,
              completedChunks: index + 1,
              totalChunks: chunks.length,
              progressPercent: measuredWorkProgress(completedCues + chunk.cues.length, selectedCues.length, translationStartPercent)
            });
          } else {
            result = await this.translateChunkWithRecovery(provider, translationRequest, signal, emitProgress);
            await cache.set(cacheKey, {
              result,
              timestamp: new Date().toISOString(),
              provider: provider.name,
              model: modelId,
              appVersion: app.getVersion()
            });
            await queueSessionWrite(() =>
              sessionStore.markChunk(session.id, chunk.id, "translated", {
                cacheKey,
                warningCount: result.warnings.length
              })
            );
            emitProgress({
              stage: "Translating",
              message: `Translated ${completedCues + chunk.cues.length}/${selectedCues.length} cues.`,
              completedChunks: index + 1,
              totalChunks: chunks.length,
              progressPercent: measuredWorkProgress(completedCues + chunk.cues.length, selectedCues.length, translationStartPercent)
            });
          }
        } catch (chunkError) {
          await queueSessionWrite(() =>
            sessionStore.markChunk(session.id, chunk.id, "failed", {
              cacheKey,
              error: formatError(chunkError)
            })
          );
          throw chunkError;
        }

        for (const entry of result.translations) {
          translatedTextById.set(entry.id, entry.translation);
        }
        completedCues += chunk.cues.length;
        warnings.push(...result.warnings);
      }

      emitProgress({
        stage: "Validating",
        message: "Rebuilding SRT with original timings.",
        completedChunks: chunks.length,
        totalChunks: chunks.length,
        progressPercent: 99
      });
      const translatedCues = selectedCues.map((cue) => ({
        ...cue,
        text: translatedTextById.get(cue.id) ?? cue.text
      }));
      const output = writeSrt(translatedCues, { rewrap: true });
      const outputPath = await this.resolveOutputPath(request);

      emitProgress({
        stage: "Saving output",
        message: "Saving translated subtitle file.",
        completedChunks: chunks.length,
        totalChunks: chunks.length,
        progressPercent: 99
      });
      const savedPath = await writeSrtSafely(outputPath, output, request.settings.outputConflictMode);

      if (request.sampleMode === "none" && !request.settings.batchUnlocked) {
        await this.settingsService.saveSettings({ ...request.settings, batchUnlocked: true });
      }

      emitProgress({
        stage: "Complete",
        message: "Translation complete.",
        completedChunks: chunks.length,
        totalChunks: chunks.length,
        progressPercent: 100
      });
      await queueSessionWrite(() =>
        sessionStore.completeSession(session.id, {
          outputPath: savedPath,
          cacheHits,
          warnings
        })
      );
      await historyStore.completeRun(session.id, {
        outputPath: savedPath,
        cueCount: selectedCues.length,
        chunkCount: chunks.length,
        cacheHits,
        warningCount: warnings.length
      });
      await sessionWriteQueue;
      return {
        outputPath: savedPath,
        cueCount: selectedCues.length,
        chunkCount: chunks.length,
        cacheHits,
        warnings
      };
    } catch (error) {
      const errorMessage = formatError(error);
      if (isCancellation(error)) {
        await queueSessionWrite(() => sessionStore.cancelSession(session.id, errorMessage));
        await historyStore.cancelRun(session.id, errorMessage);
      } else {
        await queueSessionWrite(() => sessionStore.failSession(session.id, errorMessage));
        await historyStore.failRun(session.id, errorMessage);
      }
      await sessionWriteQueue;
      throw error;
    } finally {
      if (this.abortController?.signal === signal) {
        this.abortController = undefined;
      }
    }
  }

  async batchTranslate(
    request: BatchJobRequest,
    onBatchProgress: (items: BatchItemProgress[]) => void,
    onProgress: (message: ProgressMessage) => void
  ): Promise<BatchJobResult> {
    const files = await detectVideoFiles(request.folderPath);
    const previousByFile = new Map(request.resumeItems?.map((item) => [item.file, item]) ?? []);
    const items: BatchItemProgress[] = files.map((file) => {
      const previous = previousByFile.get(file);
      if (previous?.status === "Done") {
        return { ...previous };
      }
      return {
        file,
        subtitleTrack: previous?.subtitleTrack,
        chunks: previous?.chunks ?? 0,
        completedChunks: previous?.completedChunks ?? 0,
        status: "Waiting"
      };
    });
    onBatchProgress(items);

    for (const item of items) {
      if (item.status === "Done") {
        continue;
      }
      try {
        item.status = "Probing";
        onBatchProgress([...items]);
        const probe = await import("./ffprobeService").then((module) => module.probeVideo(item.file));
        const track = selectLikelyEnglishTrack(probe.subtitleTracks);
        if (!track) {
          throw new Error("No supported text-based English subtitle track found.");
        }

        item.subtitleTrack = `${track.index} / ${track.language} / ${track.codecName}`;
        item.status = "Translating";
        onBatchProgress([...items]);

        const result = await this.translate(
          {
            videoPath: item.file,
            track,
            settings: request.settings,
            sampleMode: "none",
            alternateOutputDirectory: request.alternateOutputDirectory
          },
          (progress) => {
            item.chunks = progress.totalChunks ?? item.chunks;
            item.completedChunks = progress.completedChunks ?? item.completedChunks;
            onProgress(progress);
            onBatchProgress([...items]);
          }
        );

        item.status = "Done";
        item.chunks = result.chunkCount;
        item.completedChunks = result.chunkCount;
        item.outputPath = result.outputPath;
        onBatchProgress([...items]);
      } catch (error) {
        item.status = isRecoverableQuotaOrCreditError(error) ? "Paused until quota reset" : "Failed";
        item.lastError = formatError(error);
        onBatchProgress([...items]);
        if (item.status === "Paused until quota reset") {
          break;
        }
      }
    }

    return { items };
  }

  private getSessionStore(): TranslationSessionStore {
    this.sessionStore ??= new TranslationSessionStore(join(app.getPath("userData"), "translation-sessions.json"));
    return this.sessionStore;
  }

  /** One instance per app session, so the cache file is parsed once rather than per job. */
  private getTranslationCache(): TranslationCache {
    this.translationCache ??= new TranslationCache(join(app.getPath("userData"), "translation-cache.json"));
    return this.translationCache;
  }

  private getHistoryStore(): TranslationHistoryStore {
    this.historyStore ??= new TranslationHistoryStore(
      join(app.getPath("userData"), "translation-history.json"),
      join(app.getPath("userData"), "model-exchanges")
    );
    return this.historyStore;
  }

  private async createProvider(
    settings: AppSettings,
    onProgress?: (message: ProgressMessage) => void,
    onExchange?: ModelExchangeRecorder
  ): Promise<TranslationProvider> {
    if (settings.providerId === "mock") {
      return new MockTranslationProvider();
    }

    if (settings.providerId === "gemini") {
      const { GeminiTranslationProvider } = await import("../core/translation/GeminiTranslationProvider");
      const apiKey = await this.settingsService.getGeminiApiKey();
      if (!apiKey) {
        throw new Error("Gemini API key is missing. Add it in Settings before using Gemini.");
      }

      return new GeminiTranslationProvider({
        apiKey,
        model: settings.gemini.modelId,
        temperature: settings.gemini.temperature,
        maxOutputTokens: settings.gemini.maxOutputTokens,
        thinkingLevel: resolveGeminiThinkingLevel(settings),
        rateLimiter: new GeminiRateLimiter(
          rateLimitSettingsForSettings(settings),
          undefined,
          (ms) => {
            onProgress?.({
              stage: "Waiting for rate limit",
              message: `Waiting ${Math.ceil(ms / 1000)} second(s) before the next Gemini request.`
            });
          },
          "Gemini"
        ),
        onRetry: (message) => {
          onProgress?.({ stage: "Retrying after rate limit", message });
        },
        onExchange
      });
    }

    const { VercelTranslationProvider } = await import("../core/translation/VercelTranslationProvider");
    const apiKey = await this.settingsService.getVercelApiKey();
    if (!apiKey) {
      throw new Error("Vercel AI Gateway API key is missing. Add it in Settings before using Vercel.");
    }

    return new VercelTranslationProvider({
      apiKey,
      model: settings.vercel.modelId,
      temperature: settings.vercel.temperature,
      maxOutputTokens: settings.vercel.maxOutputTokens,
      fetchImpl: electronFetch,
      rateLimiter: new GeminiRateLimiter(
        rateLimitSettingsForSettings(settings),
        undefined,
        (ms) => {
          onProgress?.({
            stage: "Waiting for rate limit",
            message: `Waiting ${Math.ceil(ms / 1000)} second(s) before the next Vercel request.`
          });
        },
        "Vercel"
      ),
      onRetry: (message) => {
        onProgress?.({ stage: "Retrying after rate limit", message });
      },
      onExchange
    });
  }

  private async translateChunkWithRecovery(
    provider: TranslationProvider,
    translationRequest: TranslationRequest,
    signal: AbortSignal,
    onProgress: (message: ProgressMessage) => void
  ): Promise<TranslationResult> {
    try {
      return validateTranslationResult(await provider.translateChunk(translationRequest, signal), translationRequest);
    } catch (firstError) {
      const unusableCueId = getUnusableTranslationId(firstError);
      if (unusableCueId !== undefined) {
        if (translationRequest.targetLines.length <= 1) {
          onProgress({
            stage: "Repairing translation",
            message: `${formatError(firstError)} Retrying this single cue once.`
          });
          return this.retrySingleCueOrKeepOriginal(provider, translationRequest, signal, onProgress);
        }

        onProgress({
          stage: "Repairing translation",
          message: `${formatError(firstError)} Isolating cue ${unusableCueId} and retrying the surrounding lines separately.`
        });
        return this.retryChunkAroundProblemCue(provider, translationRequest, unusableCueId, signal, onProgress);
      }

      onProgress({
        stage: "Repairing translation",
        message: `Retrying chunk after validation/provider error: ${formatError(firstError)}`
      });
    }

    try {
      return validateTranslationResult(await provider.translateChunk(translationRequest, signal), translationRequest);
    } catch (secondError) {
      if (translationRequest.targetLines.length <= 1) {
        if (isUnusableTranslationError(secondError)) {
          return fallbackSingleCueTranslation(translationRequest, formatError(secondError));
        }
        throw secondError;
      }
      onProgress({ stage: "Repairing translation", message: "Splitting failed chunk in half and retrying." });
    }

    return this.splitChunkAndRetry(provider, translationRequest, signal, onProgress);
  }

  private async splitChunkAndRetry(
    provider: TranslationProvider,
    translationRequest: TranslationRequest,
    signal: AbortSignal,
    onProgress: (message: ProgressMessage) => void
  ): Promise<TranslationResult> {
    const midpoint = Math.ceil(translationRequest.targetLines.length / 2);
    const firstHalf = await this.translateChunkWithRecovery(
      provider,
      {
        ...translationRequest,
        targetLines: translationRequest.targetLines.slice(0, midpoint),
        estimatedInputTokens: Math.max(1, Math.ceil(translationRequest.estimatedInputTokens / 2))
      },
      signal,
      onProgress
    );
    const secondHalf = await this.translateChunkWithRecovery(
      provider,
      {
        ...translationRequest,
        targetLines: translationRequest.targetLines.slice(midpoint),
        estimatedInputTokens: Math.max(1, Math.ceil(translationRequest.estimatedInputTokens / 2))
      },
      signal,
      onProgress
    );

    return {
      translations: [...firstHalf.translations, ...secondHalf.translations],
      warnings: [...firstHalf.warnings, ...secondHalf.warnings]
    };
  }

  private async retryChunkAroundProblemCue(
    provider: TranslationProvider,
    translationRequest: TranslationRequest,
    cueId: number,
    signal: AbortSignal,
    onProgress: (message: ProgressMessage) => void
  ): Promise<TranslationResult> {
    const problemIndex = translationRequest.targetLines.findIndex((line) => line.id === cueId);
    if (problemIndex < 0) {
      onProgress({
        stage: "Repairing translation",
        message: `Could not find cue ${cueId} in this chunk; falling back to half-split repair.`
      });
      return this.splitChunkAndRetry(provider, translationRequest, signal, onProgress);
    }

    const before = translationRequest.targetLines.slice(0, problemIndex);
    const problem = translationRequest.targetLines.slice(problemIndex, problemIndex + 1);
    const after = translationRequest.targetLines.slice(problemIndex + 1);
    const results: TranslationResult[] = [];

    if (before.length > 0) {
      results.push(
        await this.translateChunkWithRecovery(
          provider,
          withTargetLines(translationRequest, before),
          signal,
          onProgress
        )
      );
    }

    results.push(
      await this.retrySingleCueOrKeepOriginal(
        provider,
        withTargetLines(translationRequest, problem),
        signal,
        onProgress
      )
    );

    if (after.length > 0) {
      results.push(
        await this.translateChunkWithRecovery(
          provider,
          withTargetLines(translationRequest, after),
          signal,
          onProgress
        )
      );
    }

    return mergeTranslationResults(results);
  }

  private async retrySingleCueOrKeepOriginal(
    provider: TranslationProvider,
    translationRequest: TranslationRequest,
    signal: AbortSignal,
    onProgress: (message: ProgressMessage) => void
  ): Promise<TranslationResult> {
    try {
      return validateTranslationResult(await provider.translateChunk(translationRequest, signal), translationRequest);
    } catch (error) {
      if (!isUnusableTranslationError(error)) {
        throw error;
      }

      const fallback = fallbackSingleCueTranslation(translationRequest, formatError(error));
      const fallbackText = fallback.translations[0]?.translation;
      const fallbackAction =
        fallbackText === UNREADABLE_SUBTITLE_PLACEHOLDER ? "using an unreadable-subtitle placeholder" : "keeping the original text";
      onProgress({
        stage: "Repairing translation",
        message: `Provider still could not produce a usable cue ${translationRequest.targetLines[0]?.id ?? "unknown"} translation; ${fallbackAction} for that cue.`
      });
      return fallback;
    }
  }

  private async resolveOutputPath(request: TranslationJobRequest): Promise<string> {
    const defaultOutputPath = getDefaultOutputPath(request.videoPath, request.settings.targetLanguageCode);
    const defaultDirectory = dirname(defaultOutputPath);
    if (await canWriteToDirectory(defaultDirectory)) {
      return defaultOutputPath;
    }

    if (request.alternateOutputDirectory) {
      return join(request.alternateOutputDirectory, defaultOutputPath.split(/[\\/]/).pop() ?? "translated.bg.srt");
    }

    throw new Error("The video folder is not writable. Choose another output folder.");
  }
}

function selectSampleCues(cues: SubtitleCue[], sampleMode: SampleMode): SubtitleCue[] {
  if (sampleMode === "first20") {
    return cues.slice(0, 20);
  }

  if (sampleMode === "firstScene") {
    return splitIntoScenes(cues)[0]?.cues ?? [];
  }

  if (sampleMode === "first3Minutes") {
    return cues.filter((cue) => cue.startMs < 180_000);
  }

  return cues;
}

function chunkerOptionsForSettings(settings: AppSettings) {
  const profile = getTranslationQualityProfile(settings.quality);

  if (settings.contextMode === "minimal") {
    return {
      contextCueCount: Math.min(profile.contextCueCount, 2),
      maxCharacters: Math.min(profile.maxCharacters, 3000),
      maxCueCount: Math.min(profile.maxCueCount, 50),
      maxScenesPerChunk: profile.maxScenesPerChunk
    };
  }

  if (settings.contextMode === "larger") {
    return {
      contextCueCount: Math.max(profile.contextCueCount, 6),
      maxCharacters: Math.max(profile.maxCharacters, 7000),
      maxCueCount: Math.max(profile.maxCueCount, 100),
      maxScenesPerChunk: Math.max(profile.maxScenesPerChunk, 16)
    };
  }

  return {
    contextCueCount: profile.contextCueCount,
    maxCharacters: profile.maxCharacters,
    maxCueCount: profile.maxCueCount,
    maxScenesPerChunk: profile.maxScenesPerChunk
  };
}

function rateLimitSettingsForSettings(settings: AppSettings) {
  const providerSettings = settings.providerId === "vercel" ? settings.vercel : settings.gemini;
  if (providerSettings.rateLimitMode === "manual") {
    const manual = providerSettings.manualRateLimits;
    return settingsFromManualLimits(
      manual.rpmLimit,
      manual.tpmLimit,
      Math.floor(manual.rpdLimit * (manual.stopAfterDailyPercentage / 100)),
      manual.maxConcurrentRequests
    );
  }

  if (providerSettings.rateLimitMode === "aggressive") {
    return settingsFromManualLimits(10, 500_000, 100, 2);
  }

  return unknownFreeTierSettings;
}

function getDailyRequestLimit(settings: AppSettings): number {
  const rateLimitSettings = rateLimitSettingsForSettings(settings);
  return Math.max(1, Math.floor(rateLimitSettings.rpdLimit * rateLimitSettings.rpdSafetyMultiplier));
}

function getModelIdForSettings(settings: AppSettings, provider: TranslationProvider): string {
  if (settings.providerId === "gemini") {
    return settings.gemini.modelId;
  }

  if (settings.providerId === "vercel") {
    return settings.vercel.modelId;
  }

  return provider.name;
}

function translationModelParameters(settings: AppSettings): object {
  if (settings.providerId === "gemini") {
    return {
      thinkingLevel: resolveGeminiThinkingLevel(settings),
      temperature: settings.gemini.temperature,
      maxOutputTokens: settings.gemini.maxOutputTokens
    };
  }

  if (settings.providerId === "vercel") {
    return {
      temperature: settings.vercel.temperature,
      maxOutputTokens: settings.vercel.maxOutputTokens
    };
  }

  return {};
}

export function resolveGeminiThinkingLevel(
  settings: AppSettings
): "minimal" | "low" | "medium" | "high" {
  if (settings.gemini.thinkingLevel !== "auto") {
    return settings.gemini.thinkingLevel;
  }

  return getAutomaticTranslationThinkingLevel(settings.quality);
}

async function detectVideoFiles(folderPath: string): Promise<string[]> {
  const entries = await readdir(folderPath, { withFileTypes: true });
  const supportedExtensions = new Set([".mkv", ".mp4", ".mov", ".avi", ".webm"]);
  return entries
    .filter((entry) => entry.isFile() && supportedExtensions.has(extname(entry.name).toLowerCase()))
    .map((entry) => join(folderPath, entry.name))
    .sort((left, right) => basename(left).localeCompare(basename(right)));
}

function selectLikelyEnglishTrack(tracks: SubtitleTrack[]): SubtitleTrack | undefined {
  const supported = tracks.filter((track) => track.isSupported);
  return (
    supported.find((track) => /^(eng|en)$/i.test(track.language)) ??
    supported.find((track) => /english/i.test(track.title)) ??
    supported[0]
  );
}

/** Broader than an AbortError: providers and ffmpeg report cancellation as plain messages. */
function isCancellation(error: unknown): boolean {
  return isAbortError(error) || /aborted|aborterror|cancelled|canceled/i.test(formatError(error));
}

export function isEmptyTranslationError(error: unknown): boolean {
  return getEmptyTranslationId(error) !== undefined;
}

export function getEmptyTranslationId(error: unknown): number | undefined {
  const match = /^Translation (\d+) is empty\.$/.exec(formatError(error));
  return match ? Number(match[1]) : undefined;
}

export function isUnusableTranslationError(error: unknown): boolean {
  return getUnusableTranslationId(error) !== undefined;
}

export function getUnusableTranslationId(error: unknown): number | undefined {
  const message = formatError(error);
  const match = /^Translation (\d+) (?:is empty|looks unreadable)\.$/.exec(message);
  return match ? Number(match[1]) : undefined;
}

export function fallbackSingleCueTranslation(request: TranslationRequest, reason: string): TranslationResult {
  const line = request.targetLines[0];
  if (!line) {
    throw new Error(reason);
  }

  const shouldUsePlaceholder = /looks unreadable/i.test(reason) || looksLikeUnreadableSource(line.text);
  const translation = shouldUsePlaceholder ? UNREADABLE_SUBTITLE_PLACEHOLDER : line.text;
  const action = shouldUsePlaceholder ? "marked as unreadable" : "kept its original text";

  return {
    translations: [
      {
        id: line.id,
        translation
      }
    ],
    warnings: [`Cue ${line.id} ${action} because the provider could not produce a usable translation. ${reason}`]
  };
}

function withTargetLines(request: TranslationRequest, targetLines: TranslationRequest["targetLines"]): TranslationRequest {
  return {
    ...request,
    targetLines,
    estimatedInputTokens: estimateSubRequestTokens(request, targetLines.length)
  };
}

function estimateSubRequestTokens(request: TranslationRequest, targetLineCount: number): number {
  const originalLineCount = Math.max(1, request.targetLines.length);
  return Math.max(1, Math.ceil((request.estimatedInputTokens * Math.max(1, targetLineCount)) / originalLineCount));
}

function mergeTranslationResults(results: TranslationResult[]): TranslationResult {
  return {
    translations: results.flatMap((result) => result.translations),
    warnings: results.flatMap((result) => result.warnings)
  };
}
