import { KeyedTaskQueue } from "../core/async/KeyedTaskQueue";
import { app } from "electron";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { SubtitleTrack } from "../core/video/SubtitleTrack";
import { readJsonWithBackup, removeFileAndBackup, replaceJsonWithBackup } from "./durableFileStore";
import { normalizeAppSettings, type AppSettings } from "./settingsService";
import { normalizeMediaWorkflowConfig, type MediaWorkflowConfig } from "./workflowProfileService";

export type MediaBatchSessionStatus = "running" | "paused" | "completed" | "cancelled";
export type MediaBatchItemStatus = "Queued" | "Probing" | "Translating" | "Building" | "Paused" | "Complete" | "Failed" | "Cancelled";

export interface MediaBatchSessionItem {
  videoPath: string;
  status: MediaBatchItemStatus;
  translatedSubtitlePath?: string;
  outputPath?: string;
  error?: string;
}

export interface MediaBatchSession {
  id: string;
  status: MediaBatchSessionStatus;
  createdAt: string;
  updatedAt: string;
  videoPaths: string[];
  subtitlePaths: string[];
  referenceVideoPath: string;
  referenceAudioTrackIndex?: number;
  referenceSubtitleTrack?: SubtitleTrack;
  config: MediaWorkflowConfig;
  translateFirst: boolean;
  translationSettings: AppSettings;
  outputDirectory?: string;
  items: MediaBatchSessionItem[];
  pauseReason?: string;
}

export type MediaBatchSessionCheckpoint = Omit<MediaBatchSession, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
};

export class MediaBatchSessionService {
  private readonly operations = new KeyedTaskQueue();
  private readonly storePath: string;

  constructor(storePath = join(app.getPath("userData"), "media-batch-session.json")) {
    this.storePath = storePath;
  }

  async getResumable(): Promise<MediaBatchSession | undefined> {
    return this.operations.run("store", async () => {
      const session = await this.read();
      if (!session || session.status === "completed" || session.status === "cancelled") {
        return undefined;
      }

      const normalizedItems = session.items.map((item) =>
        ["Probing", "Translating", "Building"].includes(item.status)
          ? { ...item, status: "Paused" as const, error: item.error ?? "The app closed while this file was active." }
          : item
      );
      const normalized = {
        ...session,
        status: "paused" as const,
        items: normalizedItems,
        pauseReason: session.pauseReason ?? "The previous media batch stopped before completion."
      };
      if (JSON.stringify(normalized) !== JSON.stringify(session)) {
        await this.write(normalized);
      }
      return normalized;
    });
  }

  async save(checkpoint: MediaBatchSessionCheckpoint): Promise<MediaBatchSession> {
    return this.operations.run("store", async () => {
      const existing = await this.read();
      const now = new Date().toISOString();
      const session = normalizeSession({
        ...checkpoint,
        id: checkpoint.id ?? (existing?.status !== "completed" && existing?.status !== "cancelled" ? existing?.id : undefined) ?? randomUUID(),
        createdAt: checkpoint.id && existing?.id === checkpoint.id ? existing.createdAt : now,
        updatedAt: now
      });
      await this.write(session);
      return session;
    });
  }

  async discard(id?: string): Promise<boolean> {
    return this.operations.run("store", async () => {
      const existing = await this.read();
      if (!existing || (id !== undefined && existing.id !== id)) {
        return false;
      }
      await removeFileAndBackup(this.storePath);
      return true;
    });
  }

  private async read(): Promise<MediaBatchSession | undefined> {
    return readJsonWithBackup(this.storePath, normalizeSession);
  }

  private async write(session: MediaBatchSession): Promise<void> {
    await replaceJsonWithBackup(this.storePath, session);
  }
}

function normalizeSession(value: unknown): MediaBatchSession {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid media batch checkpoint.");
  }
  const session = value as MediaBatchSession;
  if (!session.id || !session.createdAt || !session.updatedAt || !session.referenceVideoPath) {
    throw new Error("Incomplete media batch checkpoint.");
  }
  if (!["running", "paused", "completed", "cancelled"].includes(session.status)) {
    throw new Error("Unknown media batch status.");
  }
  const videoPaths = stringArray(session.videoPaths);
  const subtitlePaths = stringArray(session.subtitlePaths);
  const allowedItemStatuses: MediaBatchItemStatus[] = [
    "Queued", "Probing", "Translating", "Building", "Paused", "Complete", "Failed", "Cancelled"
  ];
  const items = Array.isArray(session.items)
    ? session.items.map((item) => {
        if (!item?.videoPath || !allowedItemStatuses.includes(item.status)) {
          throw new Error("Invalid media batch item.");
        }
        return { ...item };
      })
    : [];

  return {
    ...session,
    videoPaths,
    subtitlePaths,
    config: normalizeMediaWorkflowConfig(session.config),
    translationSettings: normalizeAppSettings(session.translationSettings),
    items
  };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("Invalid media batch file list.");
  }
  return [...new Set(value)];
}
