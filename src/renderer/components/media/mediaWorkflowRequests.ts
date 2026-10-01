import { audioTransformProfiles, type AudioTransformProfile } from "../../../core/media/AudioProfiles";
import type { SubtitleTrack } from "../../../core/video/SubtitleTrack";
import type { MediaTransformRequest, MediaTranslationPreparationRequest } from "../../../main/mediaTransformService";
import type { MediaWorkflowConfig } from "../../../main/workflowProfileService";

export { workflowProfileToMediaConfig } from "../../../core/workflow/WorkflowProfiles";

const BULGARIAN_SUBTITLE = { subtitleLanguage: "bul", subtitleTitle: "Bulgarian" } as const;

/** Manual Media page defaults: AC3 5.1 audio, an existing subtitle file, and a new MKV. */
export function defaultMediaConfig(outputConflictMode: MediaWorkflowConfig["outputConflictMode"]): MediaWorkflowConfig {
  return {
    audioProfileId: "ac3-5-1",
    audioGainDb: 0,
    keepOnlySelectedAudioTrack: false,
    subtitleWorkflow: "existing",
    subtitleTrackPreference: "selected",
    subtitleEncodingId: "utf-8",
    keepOnlyNewSubtitleTrack: false,
    outputConflictMode,
    outputMode: "new-file",
    outputContainerId: "mkv"
  };
}

export function findAudioProfile(id: MediaWorkflowConfig["audioProfileId"]): AudioTransformProfile {
  return audioTransformProfiles.find((profile) => profile.id === id) ?? audioTransformProfiles[0];
}

/** Converting audio or dropping other audio tracks both need a concrete source track. */
export function requiresAudioTrack(config: MediaWorkflowConfig): boolean {
  return findAudioProfile(config.audioProfileId).codec !== "copy" || config.keepOnlySelectedAudioTrack;
}

export function buildMediaTransformRequest(
  videoPath: string,
  audioTrackIndex: number | undefined,
  config: MediaWorkflowConfig,
  subtitlePath: string | undefined,
  outputDirectory: string | undefined
): MediaTransformRequest {
  return {
    videoPath,
    audioTrackIndex,
    audioProfileId: config.audioProfileId,
    audioGainDb: config.audioGainDb,
    keepOnlySelectedAudioTrack: config.keepOnlySelectedAudioTrack,
    subtitlePath: config.subtitleWorkflow === "none" ? undefined : subtitlePath,
    keepOnlyNewSubtitleTrack: config.keepOnlyNewSubtitleTrack,
    subtitleEncodingId: config.subtitleWorkflow === "existing" ? config.subtitleEncodingId : "utf-8",
    ...BULGARIAN_SUBTITLE,
    outputDirectory: config.outputMode === "new-file" ? outputDirectory : undefined,
    outputConflictMode: config.outputConflictMode,
    outputMode: config.outputMode,
    outputContainerId: config.outputContainerId
  };
}

export function buildMediaPreparationRequest(
  videoPath: string,
  audioTrackIndex: number | undefined,
  config: MediaWorkflowConfig,
  subtitleTrack: SubtitleTrack,
  outputDirectory: string | undefined
): MediaTranslationPreparationRequest {
  return {
    videoPath,
    audioTrackIndex,
    audioProfileId: config.audioProfileId,
    audioGainDb: config.audioGainDb,
    keepOnlySelectedAudioTrack: config.keepOnlySelectedAudioTrack,
    keepOnlyNewSubtitleTrack: config.keepOnlyNewSubtitleTrack,
    ...BULGARIAN_SUBTITLE,
    outputDirectory,
    outputConflictMode: config.outputConflictMode,
    outputMode: config.outputMode,
    outputContainerId: config.outputContainerId,
    subtitleTrack
  };
}
