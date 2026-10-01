import { KeyedTaskQueue } from "../core/async/KeyedTaskQueue";
import { app } from "electron";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { audioTransformProfiles, validateAudioGainDb, type AudioProfileId } from "../core/media/AudioProfiles";
import { getMediaContainerProfile, type MediaContainerId } from "../core/media/MediaContainers";
import { getSubtitleEncodingProfile, type SubtitleEncodingId } from "../core/media/SubtitleEncodings";
import type { SampleMode } from "./translationManager";
import { normalizeAppSettings, type AppSettings } from "./settingsService";
import type { MediaOutputMode } from "./mediaTransformService";
import { readJsonWithBackup, replaceJsonWithBackup } from "./durableFileStore";
import {
  createWorkflowProfileDraft,
  workflowProfileToMediaConfig as toMediaWorkflowConfig
} from "../core/workflow/WorkflowProfiles";

export { createWorkflowProfileDraft };

export type ProfileSubtitleWorkflow = "existing" | "translate" | "none";
export type ProfileSubtitleTrackPreference = "selected" | "english";

export interface TranslationWorkflowConfig {
  settings: AppSettings;
  sampleMode: SampleMode;
}

export interface MediaWorkflowConfig {
  audioProfileId: AudioProfileId;
  audioGainDb: number;
  keepOnlySelectedAudioTrack: boolean;
  subtitleWorkflow: ProfileSubtitleWorkflow;
  subtitleTrackPreference?: ProfileSubtitleTrackPreference;
  subtitleEncodingId: SubtitleEncodingId;
  keepOnlyNewSubtitleTrack: boolean;
  outputConflictMode: AppSettings["outputConflictMode"];
  outputMode: MediaOutputMode;
  outputContainerId: MediaContainerId;
}

export interface WorkflowTranslationSection extends TranslationWorkflowConfig {
  enabled: boolean;
  trackPreference: ProfileSubtitleTrackPreference;
}

export interface WorkflowMediaSection {
  enabled: boolean;
  audioEnabled: boolean;
  audioProfileId: AudioProfileId;
  audioGainDb: number;
  keepOnlySelectedAudioTrack: boolean;
  subtitlesEnabled: boolean;
  subtitleEncodingId: SubtitleEncodingId;
  keepOnlyNewSubtitleTrack: boolean;
  outputConflictMode: AppSettings["outputConflictMode"];
  outputMode: MediaOutputMode;
  outputContainerId: MediaContainerId;
}

export interface WorkflowProfileConfig {
  translation: WorkflowTranslationSection;
  media: WorkflowMediaSection;
}

export interface WorkflowProfile {
  id: string;
  name: string;
  kind: "workflow";
  config: WorkflowProfileConfig;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowProfileDraft {
  id?: string;
  name: string;
  kind: "workflow";
  config: WorkflowProfileConfig;
}

interface WorkflowProfileStoreData {
  version: 2;
  profiles: WorkflowProfile[];
}

interface LegacyTranslationProfile {
  id: string;
  name: string;
  kind: "translation";
  config: TranslationWorkflowConfig;
  createdAt: string;
  updatedAt: string;
}

interface LegacyMediaWorkflowConfig extends MediaWorkflowConfig {
  translationProfileId?: string;
}

interface LegacyMediaProfile {
  id: string;
  name: string;
  kind: "media";
  config: LegacyMediaWorkflowConfig;
  createdAt: string;
  updatedAt: string;
}

export class WorkflowProfileService {
  private readonly operations = new KeyedTaskQueue();
  private readonly storePath: string;

  constructor(storePath = join(app.getPath("userData"), "workflow-profiles.json")) {
    this.storePath = storePath;
  }

  async list(): Promise<WorkflowProfile[]> {
    return this.operations.run("store", async () => {
      return (await this.readStore()).profiles;
    });
  }

  async save(draft: WorkflowProfileDraft): Promise<WorkflowProfile> {
    return this.operations.run("store", async () => {
      const store = await this.readStore();
      const now = new Date().toISOString();
      const existing = draft.id ? store.profiles.find((profile) => profile.id === draft.id) : undefined;
      const normalized = normalizeDraft(draft);
      const profile: WorkflowProfile = {
        ...normalized,
        id: existing?.id ?? randomUUID(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      };

      store.profiles = existing
        ? store.profiles.map((item) => item.id === existing.id ? profile : item)
        : [...store.profiles, profile];
      await this.writeStore(store);
      return profile;
    });
  }

  async delete(id: string): Promise<void> {
    return this.operations.run("store", async () => {
      const store = await this.readStore();
      const nextProfiles = store.profiles.filter((profile) => profile.id !== id);
      if (nextProfiles.length === store.profiles.length) {
        return;
      }
      store.profiles = nextProfiles;
      await this.writeStore(store);
    });
  }

  private async readStore(): Promise<WorkflowProfileStoreData> {
    return (await readJsonWithBackup(this.storePath, normalizeStore)) ?? { version: 2, profiles: [] };
  }

  private async writeStore(store: WorkflowProfileStoreData): Promise<void> {
    await replaceJsonWithBackup(this.storePath, store);
  }
}

export function workflowProfileToMediaConfig(profile: Pick<WorkflowProfile, "config">): MediaWorkflowConfig {
  return normalizeMediaWorkflowConfig(toMediaWorkflowConfig(profile));
}

export function normalizeMediaWorkflowConfig(config: MediaWorkflowConfig): MediaWorkflowConfig {
  if (!audioTransformProfiles.some((profile) => profile.id === config.audioProfileId)) {
    throw new Error("Unknown media audio profile.");
  }
  getSubtitleEncodingProfile(config.subtitleEncodingId);
  getMediaContainerProfile(config.outputContainerId);
  if (!["existing", "translate", "none"].includes(config.subtitleWorkflow)) {
    throw new Error("Unknown subtitle workflow.");
  }
  const subtitleTrackPreference = config.subtitleTrackPreference ?? "selected";
  if (!["selected", "english"].includes(subtitleTrackPreference)) {
    throw new Error("Unknown subtitle track preference.");
  }
  if (!["new-file", "replace-original"].includes(config.outputMode)) {
    throw new Error("Unknown media output mode.");
  }
  if (!["overwrite", "versioned", "cancel"].includes(config.outputConflictMode)) {
    throw new Error("Unknown output conflict mode.");
  }

  const outputContainerId = config.outputMode === "replace-original" ? "mkv" : config.outputContainerId;
  const audioGainDb = config.audioProfileId === "copy" ? 0 : validateAudioGainDb(config.audioGainDb);
  return {
    audioProfileId: config.audioProfileId,
    audioGainDb,
    keepOnlySelectedAudioTrack: config.keepOnlySelectedAudioTrack === true,
    subtitleWorkflow: config.subtitleWorkflow,
    subtitleTrackPreference,
    subtitleEncodingId: config.subtitleEncodingId,
    keepOnlyNewSubtitleTrack: config.subtitleWorkflow !== "none" && config.keepOnlyNewSubtitleTrack === true,
    outputConflictMode: config.outputConflictMode,
    outputMode: config.outputMode,
    outputContainerId
  };
}

function normalizeStore(value: unknown): WorkflowProfileStoreData {
  const parsed = value && typeof value === "object"
    ? value as { version?: unknown; profiles?: unknown }
    : {};
  const rawProfiles = Array.isArray(parsed.profiles) ? parsed.profiles : [];
  const legacyTranslations = new Map<string, LegacyTranslationProfile>();
  for (const rawProfile of rawProfiles) {
    if (isLegacyTranslationProfile(rawProfile)) {
      legacyTranslations.set(rawProfile.id, rawProfile);
    }
  }

  const profiles = rawProfiles.flatMap((profile) => {
    try {
      return [normalizeStoredProfile(profile, legacyTranslations)];
    } catch {
      return [];
    }
  });
  return { version: 2, profiles };
}

function normalizeStoredProfile(
  value: unknown,
  legacyTranslations: Map<string, LegacyTranslationProfile>
): WorkflowProfile {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid workflow profile.");
  }
  const stored = value as Record<string, unknown>;
  if (
    typeof stored.id !== "string"
    || typeof stored.name !== "string"
    || typeof stored.createdAt !== "string"
    || typeof stored.updatedAt !== "string"
  ) {
    throw new Error("Incomplete workflow profile.");
  }

  let draft: WorkflowProfileDraft;
  if (stored.kind === "workflow") {
    draft = {
      id: stored.id,
      name: stored.name,
      kind: "workflow",
      config: stored.config as WorkflowProfileConfig
    };
  } else if (stored.kind === "translation") {
    draft = migrateTranslationProfile(stored as unknown as LegacyTranslationProfile);
  } else if (stored.kind === "media") {
    draft = migrateMediaProfile(stored as unknown as LegacyMediaProfile, legacyTranslations);
  } else {
    throw new Error("Unknown workflow profile type.");
  }

  return {
    ...normalizeDraft(draft),
    id: stored.id,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt
  };
}

function normalizeDraft(draft: WorkflowProfileDraft): Omit<WorkflowProfile, "id" | "createdAt" | "updatedAt"> {
  const name = draft.name.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!name) {
    throw new Error("Profile name is required.");
  }
  if (draft.kind !== "workflow" || !draft.config) {
    throw new Error("Unknown workflow profile type.");
  }

  const translation = normalizeTranslationSection(draft.config.translation);
  const media = normalizeMediaSection(draft.config.media);
  if (!translation.enabled && !media.enabled) {
    throw new Error("Enable Translation or Media output before saving the profile.");
  }
  return {
    kind: "workflow",
    name,
    config: { translation, media }
  };
}

function normalizeTranslationSection(section: WorkflowTranslationSection): WorkflowTranslationSection {
  if (!section || typeof section !== "object") {
    throw new Error("Translation settings are missing.");
  }
  const sampleModes: SampleMode[] = ["none", "first20", "firstScene", "first3Minutes"];
  if (!sampleModes.includes(section.sampleMode)) {
    throw new Error("Unknown translation sample mode.");
  }
  const trackPreference = section.trackPreference ?? "selected";
  if (!["selected", "english"].includes(trackPreference)) {
    throw new Error("Unknown subtitle track preference.");
  }
  return {
    enabled: section.enabled === true,
    settings: normalizeAppSettings(section.settings),
    sampleMode: section.sampleMode,
    trackPreference
  };
}

function normalizeMediaSection(section: WorkflowMediaSection): WorkflowMediaSection {
  if (!section || typeof section !== "object") {
    throw new Error("Media settings are missing.");
  }
  const preservedAudioProfileId = audioTransformProfiles.some((profile) => profile.id === section.audioProfileId)
    ? section.audioProfileId
    : "ac3-5-1";
  const normalized = normalizeMediaWorkflowConfig({
    audioProfileId: section.audioEnabled ? preservedAudioProfileId : "copy",
    audioGainDb: section.audioEnabled ? section.audioGainDb : 0,
    keepOnlySelectedAudioTrack: section.keepOnlySelectedAudioTrack === true,
    subtitleWorkflow: section.subtitlesEnabled ? "existing" : "none",
    subtitleTrackPreference: "selected",
    subtitleEncodingId: section.subtitleEncodingId,
    keepOnlyNewSubtitleTrack: section.subtitlesEnabled && section.keepOnlyNewSubtitleTrack === true,
    outputConflictMode: section.outputConflictMode,
    outputMode: section.outputMode,
    outputContainerId: section.outputContainerId
  });
  return {
    enabled: section.enabled === true,
    audioEnabled: section.audioEnabled === true,
    audioProfileId: section.audioEnabled ? normalized.audioProfileId : preservedAudioProfileId,
    audioGainDb: section.audioEnabled ? normalized.audioGainDb : 0,
    keepOnlySelectedAudioTrack: normalized.keepOnlySelectedAudioTrack,
    subtitlesEnabled: section.subtitlesEnabled === true,
    subtitleEncodingId: normalized.subtitleEncodingId,
    keepOnlyNewSubtitleTrack: normalized.keepOnlyNewSubtitleTrack,
    outputConflictMode: normalized.outputConflictMode,
    outputMode: normalized.outputMode,
    outputContainerId: normalized.outputContainerId
  };
}

function migrateTranslationProfile(profile: LegacyTranslationProfile): WorkflowProfileDraft {
  const defaults = createWorkflowProfileDraft(normalizeAppSettings(profile.config?.settings));
  return {
    id: profile.id,
    name: profile.name,
    kind: "workflow",
    config: {
      translation: {
        enabled: true,
        settings: profile.config.settings,
        sampleMode: profile.config.sampleMode,
        trackPreference: "selected"
      },
      media: { ...defaults.config.media, enabled: false }
    }
  };
}

function migrateMediaProfile(
  profile: LegacyMediaProfile,
  legacyTranslations: Map<string, LegacyTranslationProfile>
): WorkflowProfileDraft {
  const linkedTranslation = profile.config.translationProfileId
    ? legacyTranslations.get(profile.config.translationProfileId)
    : undefined;
  const defaultSettings = linkedTranslation?.config.settings ?? normalizeAppSettings({});
  const mediaConfig = normalizeMediaWorkflowConfig(profile.config);
  return {
    id: profile.id,
    name: profile.name,
    kind: "workflow",
    config: {
      translation: {
        enabled: mediaConfig.subtitleWorkflow === "translate",
        settings: defaultSettings,
        sampleMode: linkedTranslation?.config.sampleMode ?? "none",
        trackPreference: mediaConfig.subtitleTrackPreference ?? "selected"
      },
      media: {
        enabled: true,
        audioEnabled: true,
        audioProfileId: mediaConfig.audioProfileId,
        audioGainDb: mediaConfig.audioGainDb,
        keepOnlySelectedAudioTrack: mediaConfig.keepOnlySelectedAudioTrack,
        subtitlesEnabled: mediaConfig.subtitleWorkflow !== "none",
        subtitleEncodingId: mediaConfig.subtitleEncodingId,
        keepOnlyNewSubtitleTrack: mediaConfig.keepOnlyNewSubtitleTrack,
        outputConflictMode: mediaConfig.outputConflictMode,
        outputMode: mediaConfig.outputMode,
        outputContainerId: mediaConfig.outputContainerId
      }
    }
  };
}

function isLegacyTranslationProfile(value: unknown): value is LegacyTranslationProfile {
  return Boolean(
    value
    && typeof value === "object"
    && (value as { kind?: unknown }).kind === "translation"
    && typeof (value as { id?: unknown }).id === "string"
  );
}
