import { isRecoverableQuotaOrCreditError } from "../../../core/batch/BatchResume";
import {
  fileName,
  findBatchOutputCollisions,
  matchBatchAudioTrack,
  matchBatchSubtitleTrack
} from "../../../core/media/MediaBatch";
import { getWorkflowPhaseProgressRanges, type WorkflowProgressRange } from "../../../core/media/WorkflowProgress";
import type { ProbeResult } from "../../../core/video/ProbeResult";
import type { SubtitleTrack } from "../../../core/video/SubtitleTrack";
import type { MediaBatchSessionItem } from "../../../main/mediaBatchSessionService";
import type { MediaTransformProgress } from "../../../main/mediaTransformService";
import type { AppSettings } from "../../../main/settingsService";
import type { MediaWorkflowConfig } from "../../../main/workflowProfileService";
import type { SubtitleTranslatorApi } from "../../../preload";
import { isAbortError } from "../../../core/util/errors";
import { formatError } from "../../format";
import { missingProviderKeyError } from "../../providerKeys";
import { findLatestProgressPercent } from "./mediaFormatting";
import { buildMediaPreparationRequest, buildMediaTransformRequest, requiresAudioTrack } from "./mediaWorkflowRequests";

export type MediaBatchApi = Pick<
  SubtitleTranslatorApi,
  | "probeVideo"
  | "prepareMediaForTranslation"
  | "startTranslation"
  | "finalizeMediaTranslation"
  | "startMediaTransform"
  | "discardMediaTranslationPreparation"
  | "saveMediaBatchCheckpoint"
>;

export interface MediaBatchRunRequest {
  translateFirst: boolean;
  config: MediaWorkflowConfig;
  resume: boolean;
  resumeSessionId?: string;
  previousItems: MediaBatchSessionItem[];
  translationSettings: AppSettings;
  outputDirectory?: string;
  audioTrackIndex?: number;
  subtitleTrack?: SubtitleTrack;
  videoPaths: string[];
  subtitlePaths: string[];
  subtitleMatches: Record<string, string>;
  referenceVideoPath: string;
  referenceProbe: ProbeResult;
}

export interface MediaBatchRunHooks {
  api: MediaBatchApi;
  isCancelled: () => boolean;
  markCancelled: () => void;
  onItems: (items: MediaBatchSessionItem[]) => void;
  appendProgress: (entry: MediaTransformProgress | ((current: MediaTransformProgress[]) => MediaTransformProgress)) => void;
  setActiveFile: (path: string | undefined) => void;
  setTranslationActive: (active: boolean) => void;
  setTranslationRange: (range: WorkflowProgressRange) => void;
  setMediaRange: (range: WorkflowProgressRange) => void;
}

export type MediaBatchRunOutcome =
  | { kind: "paused"; sessionId: string; reason: string; completed: number; failed: number }
  | { kind: "finished"; cancelled: boolean; completed: number; failed: number };

export interface MediaBatchStartCheck {
  videoPaths: string[];
  referenceVideoPath: string;
  referenceProbe?: ProbeResult;
  config: MediaWorkflowConfig;
  audioTrackIndex?: number;
  missingSubtitleVideoPaths: string[];
  translateFirst: boolean;
  providerId: AppSettings["providerId"];
  hasGeminiKey: boolean;
  hasVercelKey: boolean;
  outputDirectory?: string;
}

/** Returns the reason a media batch cannot start, or undefined when it is ready. */
export function findMediaBatchStartError(check: MediaBatchStartCheck): string | undefined {
  if (check.videoPaths.length === 0) {
    return "Choose at least one video for the media batch.";
  }
  if (!check.referenceProbe || !check.videoPaths.includes(check.referenceVideoPath)) {
    return "Choose a batch reference file before starting.";
  }
  if (requiresAudioTrack(check.config) && check.audioTrackIndex === undefined) {
    return "Choose an audio track before converting or removing other audio tracks.";
  }
  if (check.config.subtitleWorkflow === "existing" && check.missingSubtitleVideoPaths.length > 0) {
    return "Choose one matching subtitle file for every batch video. Names must match the video name, with an optional .bg suffix.";
  }
  const keyError = check.translateFirst ? missingProviderKeyError(check.providerId, check, "batch") : undefined;
  if (keyError) {
    return keyError;
  }
  if (check.config.outputMode === "new-file") {
    const outputCollisions = findBatchOutputCollisions(check.videoPaths, check.outputDirectory);
    if (outputCollisions.length > 0) {
      return `Some files would use the same output name (${outputCollisions.map(({ outputStem }) => outputStem).join(", ")}). ` +
        "Rename those source files or process them with separate output folders.";
    }
  }
  return undefined;
}

function batchCancelledError(): DOMException {
  return new DOMException("Media batch cancelled.", "AbortError");
}

/**
 * Runs every file in a media batch, checkpointing after each state change so a
 * quota or credit failure can pause the batch and resume it later.
 * Checkpoint write failures propagate to the caller.
 */
export async function runMediaBatch(
  request: MediaBatchRunRequest,
  hooks: MediaBatchRunHooks
): Promise<MediaBatchRunOutcome> {
  const { api } = hooks;
  const { config, translateFirst, videoPaths, referenceVideoPath, referenceProbe } = request;
  const audioTrackRequired = requiresAudioTrack(config);
  let workingItems: MediaBatchSessionItem[] = request.resume
    ? request.previousItems.map((item) => ({ ...item }))
    : videoPaths.map((path) => ({ videoPath: path, status: "Queued" }));
  let sessionId = request.resume ? request.resumeSessionId : undefined;
  const previousStatusByPath = new Map(workingItems.map((item) => [item.videoPath, item.status]));
  let completed = workingItems.filter((item) => item.status === "Complete").length;
  let failed = workingItems.filter((item) => item.status === "Failed").length;
  let pauseReason: string | undefined;

  const saveCheckpoint = async (
    status: "running" | "paused" | "completed" | "cancelled",
    reason?: string
  ): Promise<void> => {
    const saved = await api.saveMediaBatchCheckpoint({
      id: sessionId,
      status,
      videoPaths,
      subtitlePaths: request.subtitlePaths,
      referenceVideoPath,
      referenceAudioTrackIndex: request.audioTrackIndex,
      referenceSubtitleTrack: request.subtitleTrack,
      config,
      translateFirst,
      translationSettings: request.translationSettings,
      outputDirectory: request.outputDirectory,
      items: workingItems,
      pauseReason: reason
    });
    sessionId = saved.id;
  };

  const checkpointItem = async (
    path: string,
    updates: Partial<MediaBatchSessionItem>,
    status: "running" | "paused" = "running",
    reason?: string
  ): Promise<void> => {
    workingItems = workingItems.map((item) => item.videoPath === path ? { ...item, ...updates } : item);
    hooks.onItems(workingItems);
    await saveCheckpoint(status, reason);
  };

  hooks.onItems(workingItems);
  await saveCheckpoint("running");
  for (const path of videoPaths) {
    const previousStatus = previousStatusByPath.get(path);
    if (request.resume && (previousStatus === "Complete" || previousStatus === "Failed")) {
      continue;
    }
    if (hooks.isCancelled()) {
      await checkpointItem(path, { status: "Cancelled", error: undefined });
      continue;
    }

    hooks.setActiveFile(path);
    const itemIndex = videoPaths.indexOf(path);
    const itemStart = (itemIndex / videoPaths.length) * 100;
    const itemEnd = ((itemIndex + 1) / videoPaths.length) * 100;
    const itemSpan = itemEnd - itemStart;
    const phaseRanges = getWorkflowPhaseProgressRanges(itemIndex, videoPaths.length, translateFirst);
    if (phaseRanges.translation) {
      hooks.setTranslationRange(phaseRanges.translation);
    }
    hooks.setMediaRange(phaseRanges.media);
    hooks.appendProgress({
      stage: "Preparing",
      message: `${fileName(path)}: Starting file ${itemIndex + 1}/${videoPaths.length}.`,
      progressPercent: phaseRanges.translation?.start ?? phaseRanges.media.start
    });
    await checkpointItem(path, { status: "Probing", error: undefined, outputPath: undefined });

    let itemPreparationId: string | undefined;
    try {
      const isReference = path === referenceVideoPath;
      const itemProbe = isReference ? referenceProbe : await api.probeVideo(path);
      if (hooks.isCancelled()) {
        throw batchCancelledError();
      }
      const itemAudioTrack = isReference
        ? itemProbe.audioTracks.find((track) => track.index === request.audioTrackIndex)
        : matchBatchAudioTrack(referenceProbe.audioTracks, request.audioTrackIndex, itemProbe.audioTracks);
      if (audioTrackRequired && !itemAudioTrack) {
        throw new Error("The selected audio-track position does not exist in this file.");
      }

      let externalSubtitlePath = workingItems.find((item) => item.videoPath === path)?.translatedSubtitlePath;
      if (translateFirst && !externalSubtitlePath) {
        const itemSubtitleTrack = isReference
          ? itemProbe.subtitleTracks.find((track) => track.index === request.subtitleTrack?.index)
          : matchBatchSubtitleTrack(request.subtitleTrack, referenceProbe.subtitleTracks, itemProbe.subtitleTracks);
        if (!itemSubtitleTrack) {
          throw new Error("No supported subtitle track matches the selected reference track.");
        }

        // Text tracks are extracted during the media pass so the source is read only once.
        const combineTextExtraction = itemSubtitleTrack.isTextBased && config.outputMode === "new-file";
        let extractedSubtitlePath: string | undefined;
        if (combineTextExtraction) {
          hooks.setMediaRange({ start: itemStart, end: itemStart + itemSpan * 0.55 });
          hooks.setTranslationRange({
            start: itemStart + itemSpan * 0.55,
            end: itemStart + itemSpan * 0.95
          });
          await checkpointItem(path, { status: "Building" });
          const preparation = await api.prepareMediaForTranslation(buildMediaPreparationRequest(
            path,
            itemAudioTrack?.index,
            config,
            itemSubtitleTrack,
            request.outputDirectory
          ));
          itemPreparationId = preparation.id;
          extractedSubtitlePath = preparation.extractedSubtitlePath;
        }

        await checkpointItem(path, { status: "Translating" });
        hooks.setTranslationActive(true);
        const translation = await api.startTranslation({
          videoPath: path,
          track: itemSubtitleTrack,
          settings: request.translationSettings,
          sampleMode: "none",
          alternateOutputDirectory: request.outputDirectory,
          extractedSubtitlePath
        });
        hooks.setTranslationActive(false);
        externalSubtitlePath = translation.outputPath;
        await checkpointItem(path, { status: "Translating", translatedSubtitlePath: externalSubtitlePath });
      } else if (config.subtitleWorkflow === "existing") {
        externalSubtitlePath = request.subtitleMatches[path];
      }

      if (hooks.isCancelled()) {
        throw batchCancelledError();
      }

      await checkpointItem(path, { status: "Building" });
      if (itemPreparationId) {
        hooks.setMediaRange({ start: itemStart + itemSpan * 0.95, end: itemEnd });
      }
      const mediaResult = itemPreparationId
        ? await api.finalizeMediaTranslation(itemPreparationId, externalSubtitlePath!)
        : await api.startMediaTransform(buildMediaTransformRequest(
          path,
          itemAudioTrack?.index,
          config,
          externalSubtitlePath,
          request.outputDirectory
        ));
      itemPreparationId = undefined;
      await checkpointItem(path, { status: "Complete", outputPath: mediaResult.outputPath, error: undefined });
      completed += 1;
    } catch (itemError) {
      hooks.setTranslationActive(false);
      if (itemPreparationId) {
        await api.discardMediaTranslationPreparation(itemPreparationId).catch(() => undefined);
      }
      if (hooks.isCancelled() || isAbortError(itemError)) {
        await checkpointItem(path, { status: "Cancelled", error: undefined });
        hooks.markCancelled();
      } else if (isRecoverableQuotaOrCreditError(itemError)) {
        pauseReason = formatError(itemError);
        await checkpointItem(path, { status: "Paused", error: pauseReason }, "paused", pauseReason);
        break;
      } else {
        await checkpointItem(path, { status: "Failed", error: formatError(itemError) });
        failed += 1;
      }
    }
  }

  if (pauseReason !== undefined) {
    hooks.appendProgress((current) => ({
      stage: "Preparing",
      message: `Media batch paused at ${completed}/${videoPaths.length} file(s). Add credits or wait for quota, then press Continue batch.`,
      progressPercent: findLatestProgressPercent(current)
    }));
    return { kind: "paused", sessionId: sessionId!, reason: pauseReason, completed, failed };
  }

  const cancelled = hooks.isCancelled();
  await saveCheckpoint(cancelled ? "cancelled" : "completed");
  hooks.appendProgress((current) => ({
    stage: "Complete",
    message: cancelled
      ? `Batch cancelled after ${completed}/${videoPaths.length} file(s).`
      : `Media batch complete: ${completed}/${videoPaths.length} file(s) built.`,
    progressPercent: completed === videoPaths.length ? 100 : Math.min(99, findLatestProgressPercent(current))
  }));
  return { kind: "finished", cancelled, completed, failed };
}
