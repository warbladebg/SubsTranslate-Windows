import { useCallback, useEffect, useMemo, useState } from "react";
import type { DownloadedWorkflowTarget } from "../../../core/downloads/DownloadedLibrary";
import type { ProbeResult } from "../../../core/video/ProbeResult";
import { canExportSubtitleTrack, findEnglishSubtitleTrack, type SubtitleTrack } from "../../../core/video/SubtitleTrack";
import { profileTranslationSettings } from "../../../core/workflow/WorkflowProfiles";
import type { AppSettings } from "../../../main/settingsService";
import type { SubtitleExportResult } from "../../../main/subtitleExportService";
import type {
  BatchItemProgress,
  DryRunResult,
  ProgressMessage,
  ProgressStage,
  SampleMode,
  TranslationJobResult
} from "../../../main/translationManager";
import type { ProfileSubtitleTrackPreference, WorkflowProfile } from "../../../main/workflowProfileService";
import { formatError } from "../../format";
import { missingProviderKeyError, type ProviderKeyStatus } from "../../providerKeys";

export type TranslateMode = "single" | "batch";

interface WorkspaceOptions {
  settings: AppSettings | undefined;
  setSettings: (settings: AppSettings) => void;
  persistSettings: (settings: AppSettings) => Promise<AppSettings>;
  keys: ProviderKeyStatus;
  workflowProfiles: WorkflowProfile[];
  error: string | undefined;
  /** Must be stable (a state setter): the last session is restored when it is first seen. */
  setError: (error: string | undefined) => void;
}

const PAUSED_STATUS: BatchItemProgress["status"] = "Paused until quota reset";
/** Only the newest messages are shown; long jobs emit thousands. */
const PROGRESS_HISTORY_LIMIT = 100;

function withMessage(history: ProgressMessage[], message: ProgressMessage): ProgressMessage[] {
  return [...history.slice(1 - PROGRESS_HISTORY_LIMIT), message];
}

function pickTrack(tracks: SubtitleTrack[], preference: ProfileSubtitleTrackPreference): SubtitleTrack | undefined {
  const supported = tracks.filter((track) => track.isSupported);
  return preference === "english" ? findEnglishSubtitleTrack(supported) : supported[0];
}

/**
 * State and actions behind the Translate page. The selected video, probe and track are
 * shared with the Media page, so they live here rather than inside either page.
 */
export function useTranslationWorkspace({
  settings,
  setSettings,
  persistSettings,
  keys,
  workflowProfiles,
  error,
  setError
}: WorkspaceOptions) {
  const api = window.subtitleTranslator;
  const [mode, setMode] = useState<TranslateMode>("single");
  const [videoPath, setVideoPath] = useState("");
  const [probe, setProbe] = useState<ProbeResult>();
  const [selectedTrack, setSelectedTrack] = useState<SubtitleTrack>();
  const [sampleMode, setSampleMode] = useState<SampleMode>("none");
  const [outputDirectory, setOutputDirectory] = useState<string>();
  const [batchFolder, setBatchFolder] = useState<string>();
  const [batchItems, setBatchItems] = useState<BatchItemProgress[]>([]);
  const [progress, setProgress] = useState<ProgressMessage[]>([]);
  const [dryRun, setDryRun] = useState<DryRunResult>();
  const [result, setResult] = useState<TranslationJobResult>();
  const [exportResult, setExportResult] = useState<SubtitleExportResult[]>();
  const [busy, setBusy] = useState(false);
  const [preferredProfileId, setPreferredProfileId] = useState("");

  const translationProfiles = useMemo(
    () => workflowProfiles.filter((profile) => profile.config.translation.enabled),
    [workflowProfiles]
  );
  // Falls back to the first profile whenever the chosen one is deleted or disabled.
  const selectedProfileId = translationProfiles.some((profile) => profile.id === preferredProfileId)
    ? preferredProfileId
    : translationProfiles[0]?.id ?? "";
  const supportedTracks = useMemo(
    () => probe?.subtitleTracks.filter((track) => track.isSupported) ?? [],
    [probe]
  );

  const appendProgress = useCallback((stage: ProgressStage, message: string) => {
    setProgress((current) => withMessage(current, { stage, message }));
  }, []);

  useEffect(() => api.onProgress((message) => setProgress((current) => withMessage(current, message))), [api]);
  useEffect(() => api.onBatchProgress(setBatchItems), [api]);

  useEffect(() => {
    void api.getLatestSession().then((session) => {
      if (!session) return;
      setVideoPath(session.request.videoPath);
      setSelectedTrack(session.request.track);
      setOutputDirectory(session.request.alternateOutputDirectory);
      setSampleMode(session.request.sampleMode as SampleMode);
      setProgress((session.progress.messages as ProgressMessage[]).slice(-PROGRESS_HISTORY_LIMIT));
      if (session.status === "completed" && session.outputPath) {
        setResult({
          outputPath: session.outputPath,
          cueCount: session.subtitle?.cueCount ?? 0,
          chunkCount: session.subtitle?.chunkCount ?? session.chunks.length,
          cacheHits: session.cacheHits,
          warnings: session.warnings
        });
      } else if (session.status === "failed" && session.lastError) {
        setError(`Last session failed: ${session.lastError}`);
      }
    }, (sessionError) => setError(`Could not restore all saved app data: ${formatError(sessionError)}`));
  }, [api, setError]);

  function clearOutcome(): void {
    setError(undefined);
    setResult(undefined);
    setExportResult(undefined);
    setDryRun(undefined);
  }

  /** Runs a job with the busy flag held, reporting any failure as the page error. */
  async function runBusy(job: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await job();
    } catch (jobError) {
      setError(formatError(jobError));
    } finally {
      setBusy(false);
    }
  }

  async function loadVideo(path: string, intro: string, preference: ProfileSubtitleTrackPreference, outro = ""): Promise<void> {
    setVideoPath(path);
    setProbe(undefined);
    setSelectedTrack(undefined);
    setProgress([{ stage: "Probing video", message: intro }]);
    const probed = await api.probeVideo(path);
    setProbe(probed);
    setSelectedTrack(pickTrack(probed.subtitleTracks, preference));
    appendProgress("Probing video", `${probed.subtitleTracks.length} subtitle track(s) detected.${outro}`);
  }

  async function chooseVideo(): Promise<void> {
    clearOutcome();
    const picked = await api.chooseVideo();
    if (!picked) return;
    try {
      await loadVideo(picked, "Reading embedded subtitle tracks.", "selected");
    } catch (probeError) {
      setError(formatError(probeError));
    }
  }

  /** Adopts a profile's translation settings and remembers it as the selected preset. */
  async function adoptProfile(profile: WorkflowProfile, nextSampleMode: SampleMode): Promise<void> {
    await persistSettings(profileTranslationSettings(profile, settings));
    setPreferredProfileId(profile.id);
    setSampleMode(nextSampleMode);
  }

  /**
   * Loads a Downloaded-library target into the Translate page for review.
   * `reveal` shows the page once settings are applied, before the slower probe.
   */
  async function prepareDownloadedTranslation(
    target: DownloadedWorkflowTarget,
    profile: WorkflowProfile,
    reveal: () => void
  ): Promise<void> {
    await adoptProfile(profile, profile.config.translation.sampleMode);
    setOutputDirectory(target.outputDirectory);
    clearOutcome();
    reveal();

    if (target.videoPaths.length > 1) {
      setMode("batch");
      setBatchFolder(target.sourceDirectory);
      setBatchItems([]);
      setProgress([{
        stage: "Probing video",
        message: `${target.scopeLabel} loaded from Downloaded with the ${profile.name} profile. Review it, then start the batch.`
      }]);
      return;
    }

    setMode("single");
    setBatchFolder(undefined);
    await loadVideo(
      target.videoPaths[0],
      `${target.scopeLabel} loaded from Downloaded.`,
      profile.config.translation.trackPreference,
      " Review, then run the profile."
    );
  }

  /** Readies the translation half of a combined workflow before the Media page takes over. */
  async function prepareMediaProfile(profile: WorkflowProfile): Promise<void> {
    if (profile.config.translation.enabled) {
      await adoptProfile(profile, "none");
    }
  }

  async function applyTranslationProfile(): Promise<void> {
    const profile = translationProfiles.find((item) => item.id === selectedProfileId);
    if (!profile || busy) return;

    setError(undefined);
    const { trackPreference } = profile.config.translation;
    const profileTrack = supportedTracks.length === 0
      ? undefined
      : trackPreference === "english" ? findEnglishSubtitleTrack(supportedTracks) : selectedTrack ?? supportedTracks[0];
    if (supportedTracks.length > 0 && !profileTrack) {
      setError("No supported English subtitle track was found in the selected media.");
      return;
    }
    try {
      await adoptProfile(profile, profile.config.media.enabled ? "none" : profile.config.translation.sampleMode);
      setSelectedTrack(profileTrack);
      appendProgress("Profile ready", `${profile.name} applied. Review the settings, then press Translate.`);
    } catch (profileError) {
      setError(formatError(profileError));
    }
  }

  async function chooseOutputFolder(): Promise<void> {
    const picked = await api.chooseOutputFolder();
    if (picked) setOutputDirectory(picked);
  }

  async function runDryRun(): Promise<void> {
    if (!settings || !selectedTrack || !videoPath) return;
    setDryRun(undefined);
    await runBusy(async () => {
      setDryRun(await api.dryRun({ videoPath, track: selectedTrack, settings, sampleMode }));
    });
  }

  async function translate(): Promise<void> {
    if (!settings || !selectedTrack || !videoPath) return;
    const keyError = missingProviderKeyError(settings.providerId, keys);
    if (keyError) {
      setError(keyError);
      return;
    }

    setResult(undefined);
    setProgress([]);
    const runSettings = settings;
    const runSampleMode = sampleMode;
    await runBusy(async () => {
      setResult(await api.startTranslation({
        videoPath,
        track: selectedTrack,
        settings: runSettings,
        sampleMode: runSampleMode,
        alternateOutputDirectory: outputDirectory
      }));
      // One finished full-file run proves the setup and unlocks folder batches.
      if (runSampleMode === "none") setSettings({ ...runSettings, batchUnlocked: true });
    });
  }

  async function cancel(): Promise<void> {
    await api.cancelTranslation();
    setBusy(false);
  }

  async function exportTracks(tracks: SubtitleTrack[], intro: string, single: boolean): Promise<void> {
    if (!videoPath) return;
    const outputDirectory = await api.chooseOutputFolder();
    if (!outputDirectory) return;

    setExportResult(undefined);
    setProgress([{ stage: "Exporting subtitles", message: intro }]);
    await runBusy(async () => {
      const exported = single
        ? [await api.exportSubtitleTrack({ videoPath, track: tracks[0], outputDirectory })]
        : (await api.exportSubtitleTracks({ videoPath, tracks, outputDirectory })).exported;
      setExportResult(exported);
      appendProgress("Exporting subtitles", single
        ? `Exported subtitle track ${exported[0].trackIndex}.`
        : `Exported ${exported.length} subtitle track(s).`);
    });
  }

  async function exportTrack(track: SubtitleTrack): Promise<void> {
    await exportTracks(
      [track],
      `Exporting subtitle track ${track.index} as SRT${track.requiresOcr ? " using OCR (no translation)" : ""}.`,
      true
    );
  }

  async function exportAllTracks(): Promise<void> {
    if (!probe) return;
    const tracks = probe.subtitleTracks.filter(canExportSubtitleTrack);
    if (tracks.length === 0) {
      setError("No exportable subtitle tracks were found.");
      return;
    }
    await exportTracks(
      tracks,
      `Exporting ${tracks.length} subtitle track(s) as SRT. Image-based tracks use OCR without translation.`,
      false
    );
  }

  async function chooseBatchFolder(): Promise<void> {
    const picked = await api.chooseOutputFolder();
    if (picked) {
      setBatchFolder(picked);
      setBatchItems([]);
    }
  }

  const rateLimitMode = settings?.providerId === "vercel" ? settings.vercel.rateLimitMode : settings?.gemini.rateLimitMode;
  const batchEnabled = rateLimitMode === "manual" || Boolean(settings?.batchUnlocked);
  const batchCanContinue = batchItems.some((item) => item.status === PAUSED_STATUS);

  async function startBatch(resume: boolean): Promise<void> {
    if (!settings || !batchFolder || busy || !batchEnabled) return;
    setProgress([]);
    if (!resume) setBatchItems([]);
    const resumeItems = resume ? batchItems : undefined;
    await runBusy(async () => {
      await api.startBatch({ folderPath: batchFolder, settings, alternateOutputDirectory: outputDirectory, resumeItems });
    });
  }

  const showInFolder = (path: string | undefined) => path ? api.showItemInFolder(path) : Promise.resolve();

  /** Media page hand-off: it probes videos itself and reports them back here. */
  const acceptProbedVideo = useCallback((path: string, probed: ProbeResult) => {
    setVideoPath(path);
    setProbe(probed);
  }, []);

  return {
    mode,
    setMode,
    videoPath,
    probe,
    supportedTracks,
    selectedTrack,
    setSelectedTrack,
    sampleMode,
    setSampleMode,
    translationProfiles,
    selectedProfileId,
    setSelectedProfileId: setPreferredProfileId,
    outputDirectory,
    batchFolder,
    batchItems,
    batchEnabled,
    batchCanContinue,
    busy,
    canTranslate: Boolean(videoPath && selectedTrack?.isSupported && !busy),
    progress,
    dryRun,
    error,
    result,
    exportResult,
    acceptProbedVideo,
    chooseVideo,
    prepareDownloadedTranslation,
    prepareMediaProfile,
    applyTranslationProfile,
    chooseOutputFolder,
    runDryRun,
    translate,
    cancel,
    exportTrack,
    exportAllTracks,
    chooseBatchFolder,
    startBatch,
    openOutput: () => showInFolder(result?.outputPath),
    openExportedSubtitle: () => showInFolder(exportResult?.[0]?.outputPath)
  };
}
