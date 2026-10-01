import { KeyedTaskQueue } from "../core/async/KeyedTaskQueue";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { hashStable } from "../core/cache/TranslationCache";
import type { SubtitleChunk } from "../core/chunking/ChunkTypes";
import type { SubtitleTrack } from "../core/video/SubtitleTrack";
import type { AppSettings, ContextMode, TranslationProviderId, TranslationQuality } from "./settingsService";

const MAX_SAVED_SESSIONS = 20;
const MAX_SAVED_PROGRESS_MESSAGES = 120;

export type SavedTranslationSessionStatus = "running" | "completed" | "failed" | "cancelled";
export type SavedTranslationChunkStatus = "waiting" | "translating" | "translated" | "cache-hit" | "failed";

export interface SavedProgressMessage {
  stage: string;
  message: string;
  completedChunks?: number;
  totalChunks?: number;
  currentStep?: number;
  totalSteps?: number;
  progressPercent?: number;
}

export interface TranslationSessionRequestInput {
  videoPath: string;
  track: SubtitleTrack;
  settings: AppSettings;
  sampleMode: string;
  alternateOutputDirectory?: string;
}

export interface SavedTranslationSessionRequest {
  videoPath: string;
  track: SubtitleTrack;
  sampleMode: string;
  targetLanguage: string;
  targetLanguageCode: string;
  providerId: TranslationProviderId;
  modelId: string;
  quality: TranslationQuality;
  contextMode: ContextMode;
  outputConflictMode: AppSettings["outputConflictMode"];
  alternateOutputDirectory?: string;
}

export interface SavedTranslationChunkProgress {
  chunkId: number;
  chunkIndex: number;
  sceneId: number;
  cueIds: number[];
  status: SavedTranslationChunkStatus;
  cacheKey?: string;
  warningCount?: number;
  error?: string;
  updatedAt: string;
}

export interface SavedTranslationSession {
  id: string;
  fingerprint: string;
  status: SavedTranslationSessionStatus;
  createdAt: string;
  updatedAt: string;
  request: SavedTranslationSessionRequest;
  subtitle?: {
    extractedFilePath?: string;
    subtitleFileHash?: string;
    cueCount?: number;
    chunkCount?: number;
    estimatedInputTokens?: number;
  };
  progress: {
    percent: number;
    stage?: string;
    message?: string;
    completedChunks: number;
    totalChunks?: number;
    currentStep?: number;
    totalSteps?: number;
    messages: SavedProgressMessage[];
  };
  chunks: SavedTranslationChunkProgress[];
  cacheHits: number;
  warnings: string[];
  outputPath?: string;
  lastError?: string;
}

interface SavedTranslationSessionFile {
  latestSessionId?: string;
  sessions: Record<string, SavedTranslationSession>;
}

export class TranslationSessionStore {
  private readonly operations = new KeyedTaskQueue();
  constructor(private readonly sessionFilePath: string) {}

  async getLatestSession(): Promise<SavedTranslationSession | undefined> {
    return this.operations.run("store", async () => {
      const store = await this.readStore();
      if (store.latestSessionId && store.sessions[store.latestSessionId]) {
        return store.sessions[store.latestSessionId];
      }

      return Object.values(store.sessions).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    });
  }

  async startOrResumeSession(input: TranslationSessionRequestInput): Promise<SavedTranslationSession> {
    return this.operations.run("store", async () => {
      const store = await this.readStore();
      const fingerprint = createSessionFingerprint(input);
      const existing = Object.values(store.sessions)
        .filter((session) => session.fingerprint === fingerprint && session.status !== "completed")
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
      const now = new Date().toISOString();

      if (existing) {
        existing.status = "running";
        existing.updatedAt = now;
        existing.request = summarizeRequest(input);
        delete existing.lastError;
        store.latestSessionId = existing.id;
        await this.writeStore(trimStore(store));
        return existing;
      }

      const session: SavedTranslationSession = {
        id: createSessionId(input, now),
        fingerprint,
        status: "running",
        createdAt: now,
        updatedAt: now,
        request: summarizeRequest(input),
        progress: {
          percent: 0,
          completedChunks: 0,
          messages: []
        },
        chunks: [],
        cacheHits: 0,
        warnings: []
      };

      store.sessions[session.id] = session;
      store.latestSessionId = session.id;
      await this.writeStore(trimStore(store));
      return session;
    });
  }

  async appendProgress(sessionId: string, message: SavedProgressMessage): Promise<void> {
    await this.updateSession(sessionId, (session) => {
      session.progress.stage = message.stage;
      session.progress.message = message.message;
      session.progress.percent = clampProgressPercent(message.progressPercent ?? session.progress.percent);
      session.progress.completedChunks = message.completedChunks ?? session.progress.completedChunks;
      session.progress.totalChunks = message.totalChunks ?? session.progress.totalChunks;
      session.progress.currentStep = message.currentStep ?? session.progress.currentStep;
      session.progress.totalSteps = message.totalSteps ?? session.progress.totalSteps;
      session.progress.messages = [...session.progress.messages, message].slice(-MAX_SAVED_PROGRESS_MESSAGES);
    });
  }

  async setSubtitlePlan(
    sessionId: string,
    subtitle: NonNullable<SavedTranslationSession["subtitle"]>
  ): Promise<void> {
    await this.updateSession(sessionId, (session) => {
      session.subtitle = {
        ...session.subtitle,
        ...subtitle
      };
      session.progress.totalChunks = subtitle.chunkCount ?? session.progress.totalChunks;
    });
  }

  async setChunkPlan(sessionId: string, chunks: SubtitleChunk[]): Promise<void> {
    await this.updateSession(sessionId, (session) => {
      const existingByChunk = new Map(
        session.chunks.map((chunk) => [`${chunk.chunkId}:${chunk.cueIds.join(",")}`, chunk])
      );

      session.chunks = chunks.map((chunk, index) => {
        const existing = existingByChunk.get(`${chunk.id}:${chunk.cues.map((cue) => cue.id).join(",")}`);
        const preservedStatus =
          existing?.status === "translated" || existing?.status === "cache-hit" ? existing.status : "waiting";

        return {
          chunkId: chunk.id,
          chunkIndex: index,
          sceneId: chunk.sceneId,
          cueIds: chunk.cues.map((cue) => cue.id),
          status: preservedStatus,
          cacheKey: existing?.cacheKey,
          warningCount: existing?.warningCount,
          updatedAt: existing?.updatedAt ?? new Date().toISOString()
        };
      });
    });
  }

  async markChunk(
    sessionId: string,
    chunkId: number,
    status: SavedTranslationChunkStatus,
    details: { cacheKey?: string; warningCount?: number; error?: string } = {}
  ): Promise<void> {
    await this.updateSession(sessionId, (session) => {
      const chunk = session.chunks.find((item) => item.chunkId === chunkId);
      if (!chunk) {
        return;
      }

      chunk.status = status;
      chunk.updatedAt = new Date().toISOString();
      chunk.cacheKey = details.cacheKey ?? chunk.cacheKey;
      chunk.warningCount = details.warningCount ?? chunk.warningCount;
      chunk.error = details.error;
    });
  }

  async completeSession(
    sessionId: string,
    details: { outputPath: string; cacheHits: number; warnings: string[] }
  ): Promise<void> {
    await this.updateSession(sessionId, (session) => {
      session.status = "completed";
      session.outputPath = details.outputPath;
      session.cacheHits = details.cacheHits;
      session.warnings = details.warnings;
      session.progress.percent = 100;
      delete session.lastError;
    });
  }

  async failSession(sessionId: string, error: string): Promise<void> {
    await this.updateSession(sessionId, (session) => {
      session.status = "failed";
      session.lastError = error;
    });
  }

  async cancelSession(sessionId: string, error: string): Promise<void> {
    await this.updateSession(sessionId, (session) => {
      session.status = "cancelled";
      session.lastError = error;
    });
  }

  private async updateSession(
    sessionId: string,
    update: (session: SavedTranslationSession) => void
  ): Promise<void> {
    return this.operations.run("store", async () => {
      const store = await this.readStore();
      const session = store.sessions[sessionId];
      if (!session) {
        return;
      }

      update(session);
      session.updatedAt = new Date().toISOString();
      store.latestSessionId = sessionId;
      await this.writeStore(trimStore(store));
    });
  }

  private async readStore(): Promise<SavedTranslationSessionFile> {
    try {
      return normalizeStore(JSON.parse(await readFile(this.sessionFilePath, "utf8")) as Partial<SavedTranslationSessionFile>);
    } catch {
      return { sessions: {} };
    }
  }

  private async writeStore(store: SavedTranslationSessionFile): Promise<void> {
    await mkdir(dirname(this.sessionFilePath), { recursive: true });
    const tempPath = `${this.sessionFilePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tempPath, JSON.stringify(store, null, 2), "utf8");
    await rename(tempPath, this.sessionFilePath);
  }
}

export function createSessionFingerprint(input: TranslationSessionRequestInput): string {
  return hashStable({
    videoPath: input.videoPath,
    trackIndex: input.track.index,
    trackCodec: input.track.codecName,
    trackLanguage: input.track.language,
    sampleMode: input.sampleMode,
    targetLanguage: input.settings.targetLanguage,
    targetLanguageCode: input.settings.targetLanguageCode,
    providerId: input.settings.providerId,
    modelId: getModelId(input.settings),
    quality: input.settings.quality,
    contextMode: input.settings.contextMode
  });
}

function summarizeRequest(input: TranslationSessionRequestInput): SavedTranslationSessionRequest {
  return {
    videoPath: input.videoPath,
    track: input.track,
    sampleMode: input.sampleMode,
    targetLanguage: input.settings.targetLanguage,
    targetLanguageCode: input.settings.targetLanguageCode,
    providerId: input.settings.providerId,
    modelId: getModelId(input.settings),
    quality: input.settings.quality,
    contextMode: input.settings.contextMode,
    outputConflictMode: input.settings.outputConflictMode,
    alternateOutputDirectory: input.alternateOutputDirectory
  };
}

function getModelId(settings: AppSettings): string {
  if (settings.providerId === "gemini") {
    return settings.gemini.modelId;
  }

  if (settings.providerId === "vercel") {
    return settings.vercel.modelId;
  }

  return "mock";
}

function createSessionId(input: TranslationSessionRequestInput, timestamp: string): string {
  return `${Date.parse(timestamp)}-${hashStable({
    videoPath: input.videoPath,
    trackIndex: input.track.index,
    providerId: input.settings.providerId,
    modelId: getModelId(input.settings)
  }).slice(0, 12)}`;
}

function normalizeStore(store: Partial<SavedTranslationSessionFile>): SavedTranslationSessionFile {
  return {
    latestSessionId: store.latestSessionId,
    sessions: store.sessions ?? {}
  };
}

function trimStore(store: SavedTranslationSessionFile): SavedTranslationSessionFile {
  const newest = Object.values(store.sessions).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const keep = new Set(newest.slice(0, MAX_SAVED_SESSIONS).map((session) => session.id));
  const sessions = Object.fromEntries(Object.entries(store.sessions).filter(([id]) => keep.has(id)));

  return {
    latestSessionId: store.latestSessionId && sessions[store.latestSessionId] ? store.latestSessionId : newest[0]?.id,
    sessions
  };
}

function clampProgressPercent(percent: number): number {
  return Math.max(0, Math.min(100, Math.round(percent)));
}
