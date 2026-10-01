import type { AppSettings } from "../../main/settingsService";
import type { MediaWorkflowConfig, WorkflowProfile, WorkflowProfileDraft } from "../../main/workflowProfileService";

/** Deep copy of plain settings data, so drafts never share nested objects with live settings. */
export function cloneSettings(settings: AppSettings): AppSettings {
  return JSON.parse(JSON.stringify(settings)) as AppSettings;
}

/** A new workflow with every part enabled, seeded from the current translation settings. */
export function createWorkflowProfileDraft(settings: AppSettings): WorkflowProfileDraft {
  return {
    name: "",
    kind: "workflow",
    config: {
      translation: {
        enabled: true,
        settings: cloneSettings(settings),
        sampleMode: "none",
        trackPreference: "english"
      },
      media: {
        enabled: true,
        audioEnabled: true,
        audioProfileId: "ac3-5-1",
        audioGainDb: 0,
        keepOnlySelectedAudioTrack: false,
        subtitlesEnabled: true,
        subtitleEncodingId: "utf-8",
        keepOnlyNewSubtitleTrack: false,
        outputConflictMode: settings.outputConflictMode,
        outputMode: "new-file",
        outputContainerId: "mkv"
      }
    }
  };
}

/** Flattens a workflow profile into the media job configuration it describes. */
export function workflowProfileToMediaConfig(profile: Pick<WorkflowProfile, "config">): MediaWorkflowConfig {
  const { translation, media } = profile.config;
  const audioProfileId = media.audioEnabled ? media.audioProfileId : "copy";
  return {
    audioProfileId,
    audioGainDb: audioProfileId === "copy" ? 0 : media.audioGainDb,
    keepOnlySelectedAudioTrack: media.keepOnlySelectedAudioTrack,
    subtitleWorkflow: media.subtitlesEnabled
      ? translation.enabled ? "translate" : "existing"
      : "none",
    subtitleTrackPreference: translation.trackPreference,
    subtitleEncodingId: media.subtitleEncodingId,
    keepOnlyNewSubtitleTrack: media.subtitlesEnabled && media.keepOnlyNewSubtitleTrack,
    outputConflictMode: media.outputConflictMode,
    outputMode: media.outputMode,
    outputContainerId: media.outputMode === "replace-original" ? "mkv" : media.outputContainerId
  };
}

/**
 * The translation settings a profile runs with. The batch unlock is earned by the user,
 * not stored per profile, so it always comes from the live settings.
 */
export function profileTranslationSettings(profile: Pick<WorkflowProfile, "config">, current: AppSettings | undefined): AppSettings {
  const settings = profile.config.translation.settings;
  return { ...settings, batchUnlocked: current?.batchUnlocked ?? settings.batchUnlocked };
}
