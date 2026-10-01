import { AlertCircle, CheckCircle2, ExternalLink, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AudioProfileId } from "../../core/media/AudioProfiles";
import { matchBatchSubtitleFiles } from "../../core/media/MediaBatch";
import {
  getWorkflowPhaseProgressRanges,
  scaleWorkflowProgress,
  type WorkflowProgressRange
} from "../../core/media/WorkflowProgress";
import type { ProbeResult } from "../../core/video/ProbeResult";
import { findEnglishSubtitleTrack, type SubtitleTrack } from "../../core/video/SubtitleTrack";
import type { MediaOutputMode, MediaTransformProgress, MediaTransformResult } from "../../main/mediaTransformService";
import type { AppSettings } from "../../main/settingsService";
import type {
  MediaWorkflowConfig,
  ProfileSubtitleTrackPreference,
  WorkflowProfile,
  WorkflowProfileDraft
} from "../../main/workflowProfileService";
import type { MediaBatchSession, MediaBatchSessionItem } from "../../main/mediaBatchSessionService";
import { WorkflowProfilesPanel } from "./WorkflowProfilesPanel";
import { AUDIO_PROFILE_SLOTS_KEY, readAudioProfileSlots } from "../audioProfileSlots";
import { writeStorage } from "../storage";
import { useEffectEvent } from "../useEffectEvent";
import { formatGainDb, MEDIA_PROGRESS_HISTORY_LIMIT } from "./media/mediaFormatting";
import { fileName, formatError } from "../format";
import { missingProviderKeyError } from "../providerKeys";
import {
  buildMediaPreparationRequest,
  buildMediaTransformRequest,
  defaultMediaConfig,
  requiresAudioTrack,
  workflowProfileToMediaConfig
} from "./media/mediaWorkflowRequests";
import { findMediaBatchStartError, runMediaBatch } from "./media/mediaBatchRunner";
import { MediaAudioPanel } from "./media/MediaAudioPanel";
import { MediaBatchResults } from "./media/MediaBatchResults";
import { MediaOutputPanel } from "./media/MediaOutputPanel";
import { MediaRunCard } from "./media/MediaRunCard";
import { MediaSourcePanel, type MediaInputMode } from "./media/MediaSourcePanel";
import { MediaSubtitlePanel } from "./media/MediaSubtitlePanel";
import { WorkflowPicker } from "./media/WorkflowPicker";

interface MediaToolsPageProps {
  onSaveWorkflowProfile?: (draft: WorkflowProfileDraft) => Promise<WorkflowProfile>;
  onDeleteWorkflowProfile?: (id: string) => Promise<void>;
  settings: AppSettings;
  workflowProfiles: WorkflowProfile[];
  hasGeminiKey: boolean;
  hasVercelKey: boolean;
  videoPath: string;
  probe?: ProbeResult;
  selectedTrack?: SubtitleTrack;
  latestTranslatedSubtitlePath?: string;
  onVideoLoaded: (videoPath: string, probe: ProbeResult) => void;
  onSubtitleTrackSelected: (track: SubtitleTrack | undefined) => void;
  libraryLaunch?: MediaToolsLaunchRequest;
}

export interface MediaToolsLaunchRequest {
  id: string;
  videoPaths: string[];
  profileId: string;
  outputDirectory: string;
  scopeLabel: string;
}

interface MediaBatchResumeState {
  sessionId: string;
  config: MediaWorkflowConfig;
  translateFirst: boolean;
  translationSettings: AppSettings;
  outputDirectory?: string;
  referenceAudioTrackIndex?: number;
  referenceSubtitleTrack?: SubtitleTrack;
  reason: string;
}

type ProgressEntry = MediaTransformProgress | ((current: MediaTransformProgress[]) => MediaTransformProgress);

export function MediaToolsPage({
  settings,
  workflowProfiles,
  hasGeminiKey,
  hasVercelKey,
  videoPath,
  probe,
  selectedTrack,
  latestTranslatedSubtitlePath,
  onVideoLoaded,
  onSubtitleTrackSelected,
  libraryLaunch,
  onSaveWorkflowProfile,
  onDeleteWorkflowProfile
}: MediaToolsPageProps) {
  const [editingWorkflow, setEditingWorkflow] = useState<WorkflowProfile | "new">();
  const [inputMode, setInputMode] = useState<MediaInputMode>("single");
  const [batchVideoPaths, setBatchVideoPaths] = useState<string[]>([]);
  const [batchSubtitlePaths, setBatchSubtitlePaths] = useState<string[]>([]);
  const [batchItems, setBatchItems] = useState<MediaBatchSessionItem[]>([]);
  const [batchResumeState, setBatchResumeState] = useState<MediaBatchResumeState | undefined>();
  const [selectedMediaProfileId, setSelectedMediaProfileId] = useState("");
  const [audioProfileSlots, setAudioProfileSlots] = useState(readAudioProfileSlots);
  const [editingAudioProfiles, setEditingAudioProfiles] = useState(false);
  const [audioTrackIndex, setAudioTrackIndex] = useState<number | undefined>();
  const audioSourceRef = useRef(videoPath);
  const loadRequestRef = useRef(0);
  const [profileTranslationSettings, setProfileTranslationSettings] = useState<AppSettings>();
  const [mediaConfig, setMediaConfig] = useState<MediaWorkflowConfig>(() => defaultMediaConfig(settings.outputConflictMode));
  const [subtitlePath, setSubtitlePath] = useState(latestTranslatedSubtitlePath ?? "");
  const [outputDirectory, setOutputDirectory] = useState<string | undefined>();
  const [progress, setProgress] = useState<MediaTransformProgress[]>([]);
  const [result, setResult] = useState<MediaTransformResult | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const translationActiveRef = useRef(false);
  const activeBatchFileRef = useRef<string | undefined>();
  const translationProgressRangeRef = useRef<WorkflowProgressRange>({ start: 0, end: 55 });
  const mediaProgressRangeRef = useRef<WorkflowProgressRange>({ start: 0, end: 100 });
  const batchCancelledRef = useRef(false);
  const restoredBatchRef = useRef(false);
  const handledLibraryLaunchRef = useRef("");

  const updateMediaConfig = useCallback((patch: Partial<MediaWorkflowConfig>) => {
    setMediaConfig((current) => ({ ...current, ...patch }));
  }, []);
  const {
    audioProfileId,
    audioGainDb,
    keepOnlySelectedAudioTrack,
    subtitleWorkflow,
    subtitleEncodingId,
    keepOnlyNewSubtitleTrack,
    outputConflictMode,
    outputMode,
    outputContainerId
  } = mediaConfig;
  const subtitleTrackPreference = mediaConfig.subtitleTrackPreference ?? "selected";
  const currentMediaConfig: MediaWorkflowConfig = {
    ...mediaConfig,
    subtitleTrackPreference,
    keepOnlyNewSubtitleTrack: subtitleWorkflow !== "none" && keepOnlyNewSubtitleTrack
  };
  const defaultRunSettings: AppSettings = profileTranslationSettings
    ? { ...profileTranslationSettings, batchUnlocked: settings.batchUnlocked }
    : settings;
  const supportedSubtitleTracks = useMemo(() => probe?.subtitleTracks.filter((track) => track.isSupported) ?? [], [probe]);
  const mediaProfiles = useMemo(
    () => workflowProfiles.filter((profile) => profile.config.media.enabled),
    [workflowProfiles]
  );
  const batchSubtitleMatches = useMemo(
    () => matchBatchSubtitleFiles(batchVideoPaths, batchSubtitlePaths),
    [batchSubtitlePaths, batchVideoPaths]
  );

  const appendProgress = useCallback((entry: ProgressEntry): void => {
    setProgress((current) => [
      ...current,
      typeof entry === "function" ? entry(current) : entry
    ].slice(-MEDIA_PROGRESS_HISTORY_LIMIT));
  }, []);

  useEffect(() => {
    if (selectedMediaProfileId && !mediaProfiles.some((profile) => profile.id === selectedMediaProfileId)) {
      setSelectedMediaProfileId("");
    }
  }, [mediaProfiles, selectedMediaProfileId]);

  const restoreSavedBatch = useEffectEvent((session: MediaBatchSession) => {
    void restoreMediaBatch(session);
  });

  useEffect(() => {
    if (libraryLaunch || restoredBatchRef.current) {
      return;
    }
    restoredBatchRef.current = true;
    void window.subtitleTranslator.getResumableMediaBatch().then(
      (session) => {
        if (session) {
          restoreSavedBatch(session);
        }
      },
      (restoreError) => setError(formatError(restoreError))
    );
  }, [libraryLaunch]);

  const startLibraryLaunch = useEffectEvent((launch: MediaToolsLaunchRequest, profile: WorkflowProfile) => {
    handledLibraryLaunchRef.current = launch.id;
    restoredBatchRef.current = true;
    setSelectedMediaProfileId(profile.id);
    applyMediaProfile(workflowProfileToMediaConfig(profile));
    setProfileTranslationSettings(profile.config.translation.settings);
    setOutputDirectory(launch.outputDirectory);
    setBatchResumeState(undefined);
    setBatchSubtitlePaths([]);
    setResult(undefined);
    setError(undefined);
    if (launch.videoPaths.length === 1) {
      setInputMode("single");
      setBatchVideoPaths([]);
      setBatchItems([]);
    } else {
      setInputMode("batch");
      setBatchVideoPaths(launch.videoPaths);
      setBatchItems(launch.videoPaths.map((path) => ({ videoPath: path, status: "Queued" })));
    }
    setProgress([{
      stage: "Preparing",
      message: `${launch.scopeLabel} loaded from Downloaded with the ${profile.name} profile.`,
      progressPercent: 0
    }]);
    void loadReferenceVideo(launch.videoPaths[0], profile.config.translation.trackPreference);
  });

  useEffect(() => {
    if (
      !libraryLaunch
      || handledLibraryLaunchRef.current === libraryLaunch.id
      || libraryLaunch.videoPaths.length === 0
    ) {
      return;
    }
    // Workflow profiles can arrive after the launch request, so wait for the matching profile.
    const profile = mediaProfiles.find((item) => item.id === libraryLaunch.profileId);
    if (profile) {
      startLibraryLaunch(libraryLaunch, profile);
    }
  }, [libraryLaunch, mediaProfiles]);

  useEffect(() => {
    return window.subtitleTranslator.onMediaProgress((message) => {
      const activeFile = activeBatchFileRef.current;
      const scaledMessage = {
        ...message,
        progressPercent: scaleWorkflowProgress(message.progressPercent, mediaProgressRangeRef.current)
      };
      appendProgress(activeFile ? { ...scaledMessage, message: `${fileName(activeFile)}: ${message.message}` } : scaledMessage);
    });
  }, [appendProgress]);

  useEffect(() => {
    return window.subtitleTranslator.onProgress((message) => {
      if (!translationActiveRef.current) {
        return;
      }
      appendProgress({
        stage: "Preparing",
        message: `${activeBatchFileRef.current ? `${fileName(activeBatchFileRef.current)}: ` : ""}${message.stage}: ${message.message}`,
        progressPercent: scaleWorkflowProgress(message.progressPercent, translationProgressRangeRef.current)
      });
    });
  }, [appendProgress]);

  useEffect(() => {
    if (latestTranslatedSubtitlePath && !subtitlePath) {
      setSubtitlePath(latestTranslatedSubtitlePath);
    }
  }, [latestTranslatedSubtitlePath, subtitlePath]);

  useEffect(() => {
    if (!probe || probe.filePath !== videoPath) return;
    const sourceChanged = audioSourceRef.current !== videoPath;
    audioSourceRef.current = videoPath;
    if (sourceChanged || !probe.audioTracks.some((track) => track.index === audioTrackIndex)) {
      setAudioTrackIndex(probe.audioTracks[0]?.index);
    }
  }, [audioTrackIndex, probe, videoPath]);

  useEffect(() => {
    let cancelled = false;
    if (!videoPath || probe) {
      return;
    }

    setProgress([{ stage: "Preparing", message: "Reading media streams.", progressPercent: 0 }]);
    void window.subtitleTranslator.probeVideo(videoPath).then(
      (nextProbe) => {
        if (!cancelled) {
          onVideoLoaded(videoPath, nextProbe);
        }
      },
      (probeError) => {
        if (!cancelled) {
          setError(formatError(probeError));
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, [onVideoLoaded, probe, videoPath]);

  async function chooseVideo(): Promise<void> {
    setError(undefined);
    setResult(undefined);
    const picked = await window.subtitleTranslator.chooseVideo();
    if (!picked) {
      return;
    }

    await loadReferenceVideo(picked, subtitleTrackPreference);
  }

  async function chooseBatchVideos(): Promise<void> {
    setError(undefined);
    setResult(undefined);
    setBatchResumeState(undefined);
    const picked = await window.subtitleTranslator.chooseVideos();
    if (picked.length === 0) {
      return;
    }

    const existingPaths = new Set(batchVideoPaths.map((path) => path.toLowerCase()));
    const merged = [...batchVideoPaths, ...picked.filter((path) => !existingPaths.has(path.toLowerCase()))];
    setBatchVideoPaths(merged);
    setBatchItems(merged.map((path) => ({ videoPath: path, status: "Queued" })));

    if (!batchVideoPaths.includes(videoPath)) {
      await loadReferenceVideo(merged[0], subtitleTrackPreference);
    }
  }

  async function loadReferenceVideo(path: string, preference: ProfileSubtitleTrackPreference = "selected"): Promise<void> {
    if (!path) {
      return;
    }
    if (path === videoPath && probe) {
      if (preference === "english") onSubtitleTrackSelected(findEnglishSubtitleTrack(probe.subtitleTracks));
      return;
    }
    const requestId = ++loadRequestRef.current;
    setBatchResumeState(undefined);

    setProgress([{ stage: "Preparing", message: "Reading media streams.", progressPercent: 0 }]);
    try {
      const nextProbe = await window.subtitleTranslator.probeVideo(path);
      if (requestId !== loadRequestRef.current) return;
      audioSourceRef.current = path;
      onVideoLoaded(path, nextProbe);
      setAudioTrackIndex(nextProbe.audioTracks[0]?.index);
      onSubtitleTrackSelected(preference === "english"
        ? findEnglishSubtitleTrack(nextProbe.subtitleTracks)
        : nextProbe.subtitleTracks.find((track) => track.isSupported));
      setProgress((current) => [
        ...current,
        {
          stage: "Preparing",
          message: `${nextProbe.audioTracks.length} audio track(s), ${nextProbe.subtitleTracks.length} subtitle track(s).`,
          progressPercent: 0
        }
      ]);
    } catch (probeError) {
      setError(formatError(probeError));
    }
  }

  async function restoreMediaBatch(session: MediaBatchSession): Promise<void> {
    setInputMode("batch");
    setBatchVideoPaths(session.videoPaths);
    setBatchSubtitlePaths(session.subtitlePaths);
    setBatchItems(session.items);
    // The track preference belongs to the reference video, not the saved batch.
    setMediaConfig((current) => ({ ...session.config, subtitleTrackPreference: current.subtitleTrackPreference }));
    setOutputDirectory(session.outputDirectory);
    setBatchResumeState({
      sessionId: session.id,
      config: session.config,
      translateFirst: session.translateFirst,
      translationSettings: session.translationSettings,
      outputDirectory: session.outputDirectory,
      referenceAudioTrackIndex: session.referenceAudioTrackIndex,
      referenceSubtitleTrack: session.referenceSubtitleTrack,
      reason: session.pauseReason ?? "The previous media batch stopped before completion."
    });
    setProgress([
      {
        stage: "Preparing",
        message: "Restored a paused media batch. Press Continue batch when API quota or credits are available.",
        progressPercent: Math.round(
          (session.items.filter((item) => item.status === "Complete").length / Math.max(1, session.items.length)) * 100
        )
      }
    ]);

    try {
      const restoredProbe = await window.subtitleTranslator.probeVideo(session.referenceVideoPath);
      audioSourceRef.current = session.referenceVideoPath;
      onVideoLoaded(session.referenceVideoPath, restoredProbe);
      setAudioTrackIndex(session.referenceAudioTrackIndex ?? restoredProbe.audioTracks[0]?.index);
      onSubtitleTrackSelected(
        session.referenceSubtitleTrack ?? restoredProbe.subtitleTracks.find((track) => track.isSupported)
      );
    } catch (restoreError) {
      setError(`Could not restore the batch reference file: ${formatError(restoreError)}`);
    }
  }

  function setMediaInputMode(mode: MediaInputMode): void {
    setInputMode(mode);
    setError(undefined);
    setResult(undefined);
    setBatchItems([]);
    setBatchResumeState(undefined);
    activeBatchFileRef.current = undefined;
    if (mode === "batch" && batchVideoPaths.length === 0 && videoPath) {
      setBatchVideoPaths([videoPath]);
    }
  }

  async function removeBatchVideo(path: string): Promise<void> {
    setBatchResumeState(undefined);
    const remaining = batchVideoPaths.filter((item) => item !== path);
    setBatchVideoPaths(remaining);
    setBatchItems((current) => current.filter((item) => item.videoPath !== path));
    if (path === videoPath && remaining[0]) {
      await loadReferenceVideo(remaining[0]);
    }
  }

  function clearBatchVideos(): void {
    setBatchVideoPaths([]);
    setBatchSubtitlePaths([]);
    setBatchItems([]);
    setBatchResumeState(undefined);
    setResult(undefined);
    setError(undefined);
  }

  async function chooseSubtitleFile(): Promise<void> {
    if (inputMode === "batch") {
      const picked = await window.subtitleTranslator.chooseSubtitleFiles();
      if (picked.length > 0) {
        setBatchResumeState(undefined);
        setBatchSubtitlePaths(picked);
        updateMediaConfig({ subtitleWorkflow: "existing" });
      }
      return;
    }

    const picked = await window.subtitleTranslator.chooseSubtitleFile();
    if (picked) {
      setSubtitlePath(picked);
      updateMediaConfig({ subtitleWorkflow: "existing" });
    }
  }

  async function chooseOutputFolder(): Promise<void> {
    const picked = await window.subtitleTranslator.chooseOutputFolder();
    if (picked) {
      setBatchResumeState(undefined);
      setOutputDirectory(picked);
    }
  }

  async function buildOnly(config: MediaWorkflowConfig = currentMediaConfig): Promise<void> {
    if (inputMode === "batch") {
      await runBatchWorkflow(false, config);
      return;
    }

    const externalSubtitlePath = config.subtitleWorkflow === "existing" ? subtitlePath.trim() : undefined;
    if (config.subtitleWorkflow === "existing" && !externalSubtitlePath) {
      setError("Choose a translated subtitle file before building the MKV.");
      return;
    }
    await runMediaBuild(externalSubtitlePath, false, config);
  }

  async function translateAndBuild(
    config: MediaWorkflowConfig = currentMediaConfig,
    runSettings: AppSettings = defaultRunSettings,
    runSubtitleTrack: SubtitleTrack | undefined = selectedTrack
  ): Promise<void> {
    if (!videoPath || !runSubtitleTrack) {
      setError("Choose a video and subtitle track first.");
      return;
    }

    const keyError = missingProviderKeyError(runSettings.providerId, { hasGeminiKey, hasVercelKey });
    if (keyError) {
      setError(keyError);
      return;
    }

    if (inputMode === "batch") {
      await runBatchWorkflow(
        true,
        config,
        false,
        runSettings,
        outputDirectory,
        audioTrackIndex,
        runSubtitleTrack
      );
      return;
    }

    setBusy(true);
    setError(undefined);
    setResult(undefined);
    // Text tracks are extracted during the media pass so the source is read only once.
    const combineTextExtraction = runSubtitleTrack.isTextBased && config.outputMode === "new-file";
    setProgress([{
      stage: "Preparing",
      message: combineTextExtraction
        ? "Preparing media and extracting the text subtitle track in one source pass."
        : "Translating subtitle track.",
      progressPercent: 0
    }]);
    const phaseRanges = getWorkflowPhaseProgressRanges(0, 1, true);
    translationProgressRangeRef.current = phaseRanges.translation!;
    mediaProgressRangeRef.current = phaseRanges.media;
    translationActiveRef.current = !combineTextExtraction;
    let preparationId: string | undefined;

    try {
      if (combineTextExtraction) {
        mediaProgressRangeRef.current = { start: 0, end: 55 };
        const preparation = await window.subtitleTranslator.prepareMediaForTranslation(
          buildMediaPreparationRequest(videoPath, audioTrackIndex, config, runSubtitleTrack, outputDirectory)
        );
        preparationId = preparation.id;
        translationProgressRangeRef.current = { start: 55, end: 95 };
        translationActiveRef.current = true;
        const translation = await window.subtitleTranslator.startTranslation({
          videoPath,
          track: runSubtitleTrack,
          settings: runSettings,
          sampleMode: "none",
          alternateOutputDirectory: outputDirectory,
          extractedSubtitlePath: preparation.extractedSubtitlePath
        });
        translationActiveRef.current = false;
        acceptTranslatedSubtitle(translation.outputPath);
        mediaProgressRangeRef.current = { start: 95, end: 100 };
        const mediaResult = await window.subtitleTranslator.finalizeMediaTranslation(
          preparation.id,
          translation.outputPath
        );
        preparationId = undefined;
        setResult(mediaResult);
        return;
      }

      const translation = await window.subtitleTranslator.startTranslation({
        videoPath,
        track: runSubtitleTrack,
        settings: runSettings,
        sampleMode: "none",
        alternateOutputDirectory: outputDirectory
      });
      translationActiveRef.current = false;
      acceptTranslatedSubtitle(translation.outputPath);
      await runMediaBuild(translation.outputPath, true, config);
    } catch (workflowError) {
      if (preparationId) {
        await window.subtitleTranslator.discardMediaTranslationPreparation(preparationId).catch(() => undefined);
      }
      setError(formatError(workflowError));
    } finally {
      translationActiveRef.current = false;
      setBusy(false);
    }
  }

  function acceptTranslatedSubtitle(path: string): void {
    setSubtitlePath(path);
    updateMediaConfig(selectedMediaProfileId
      ? { subtitleEncodingId: "utf-8" }
      : { subtitleWorkflow: "existing", subtitleEncodingId: "utf-8" });
  }

  async function runMediaBuild(
    externalSubtitlePath?: string,
    keepBusy = false,
    config: MediaWorkflowConfig = currentMediaConfig
  ): Promise<void> {
    if (!videoPath) {
      setError("Choose a video first.");
      return;
    }

    if (requiresAudioTrack(config) && audioTrackIndex === undefined) {
      setError("Choose an audio track before converting or removing other audio tracks.");
      return;
    }

    if (!keepBusy) {
      activeBatchFileRef.current = undefined;
      mediaProgressRangeRef.current = getWorkflowPhaseProgressRanges(0, 1, false).media;
      setBusy(true);
      setError(undefined);
      setResult(undefined);
      setProgress([]);
    }

    try {
      setResult(await window.subtitleTranslator.startMediaTransform(
        buildMediaTransformRequest(videoPath, audioTrackIndex, config, externalSubtitlePath, outputDirectory)
      ));
    } catch (mediaError) {
      setError(formatError(mediaError));
    } finally {
      if (!keepBusy) {
        setBusy(false);
      }
    }
  }

  async function runBatchWorkflow(
    translateFirst: boolean,
    config: MediaWorkflowConfig = currentMediaConfig,
    resume = false,
    runSettings: AppSettings = defaultRunSettings,
    runOutputDirectory: string | undefined = outputDirectory,
    runAudioTrackIndex: number | undefined = audioTrackIndex,
    runSubtitleTrack: SubtitleTrack | undefined = selectedTrack
  ): Promise<void> {
    const startError = findMediaBatchStartError({
      videoPaths: batchVideoPaths,
      referenceVideoPath: videoPath,
      referenceProbe: probe,
      config,
      audioTrackIndex: runAudioTrackIndex,
      missingSubtitleVideoPaths: batchSubtitleMatches.missingVideoPaths,
      translateFirst,
      providerId: runSettings.providerId,
      hasGeminiKey,
      hasVercelKey,
      outputDirectory: runOutputDirectory
    });
    if (startError || !probe) {
      setError(startError);
      return;
    }

    const resumeSessionId = batchResumeState?.sessionId;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    setBatchResumeState(undefined);
    if (resume) {
      appendProgress({ stage: "Preparing", message: "Continuing media batch from the saved checkpoint.", progressPercent: 0 });
    } else {
      setProgress([]);
    }
    batchCancelledRef.current = false;

    try {
      const outcome = await runMediaBatch({
        translateFirst,
        config,
        resume,
        resumeSessionId,
        previousItems: batchItems,
        translationSettings: runSettings,
        outputDirectory: runOutputDirectory,
        audioTrackIndex: runAudioTrackIndex,
        subtitleTrack: runSubtitleTrack,
        videoPaths: batchVideoPaths,
        subtitlePaths: batchSubtitlePaths,
        subtitleMatches: batchSubtitleMatches.matches,
        referenceVideoPath: videoPath,
        referenceProbe: probe
      }, {
        api: window.subtitleTranslator,
        isCancelled: () => batchCancelledRef.current,
        markCancelled: () => {
          batchCancelledRef.current = true;
        },
        onItems: setBatchItems,
        appendProgress,
        setActiveFile: (path) => {
          activeBatchFileRef.current = path;
        },
        setTranslationActive: (active) => {
          translationActiveRef.current = active;
        },
        setTranslationRange: (range) => {
          translationProgressRangeRef.current = range;
        },
        setMediaRange: (range) => {
          mediaProgressRangeRef.current = range;
        }
      });
      if (outcome.kind === "paused") {
        setBatchResumeState({
          sessionId: outcome.sessionId,
          config,
          translateFirst,
          translationSettings: runSettings,
          outputDirectory: runOutputDirectory,
          referenceAudioTrackIndex: runAudioTrackIndex,
          referenceSubtitleTrack: runSubtitleTrack,
          reason: outcome.reason
        });
      } else if (outcome.failed > 0) {
        setError(`${outcome.failed} media batch file(s) failed. Review the file list for details.`);
      }
    } catch (batchError) {
      setError(`Could not checkpoint the media batch: ${formatError(batchError)}`);
    } finally {
      activeBatchFileRef.current = undefined;
      translationActiveRef.current = false;
      setBusy(false);
    }
  }

  function selectMediaProfile(id: string): void {
    const profile = mediaProfiles.find((item) => item.id === id);
    if (!profile || busy || batchResumeState) return;
    setSelectedMediaProfileId(id);
    applyMediaProfile(workflowProfileToMediaConfig(profile));
    setProfileTranslationSettings(profile.config.translation.settings);
    if (profile.config.translation.enabled && profile.config.media.subtitlesEnabled && profile.config.translation.trackPreference === "english" && probe) {
      const englishTrack = findEnglishSubtitleTrack(supportedSubtitleTracks);
      if (englishTrack) onSubtitleTrackSelected(englishTrack);
      else setError("No supported English subtitle track was found. Choose a subtitle track before running.");
    }
  }

  function applyMediaProfile(config: MediaWorkflowConfig): void {
    setMediaConfig({
      ...config,
      audioGainDb: config.audioProfileId === "copy" ? 0 : config.audioGainDb,
      subtitleTrackPreference: config.subtitleTrackPreference ?? "selected",
      outputContainerId: config.outputMode === "replace-original" ? "mkv" : config.outputContainerId
    });
    setError(undefined);
    setResult(undefined);
  }

  async function continueMediaBatch(): Promise<void> {
    const resumeState = batchResumeState;
    if (!resumeState || busy) {
      return;
    }

    applyMediaProfile(resumeState.config);
    setAudioTrackIndex(resumeState.referenceAudioTrackIndex);
    onSubtitleTrackSelected(resumeState.referenceSubtitleTrack);
    await runBatchWorkflow(
      resumeState.translateFirst,
      resumeState.config,
      true,
      resumeState.translationSettings,
      resumeState.outputDirectory,
      resumeState.referenceAudioTrackIndex,
      resumeState.referenceSubtitleTrack
    );
  }

  async function discardSavedMediaBatch(): Promise<void> {
    const resumeState = batchResumeState;
    if (!resumeState || busy) {
      return;
    }
    if (!window.confirm("Discard the saved media batch progress? Completed outputs will remain on disk, but this batch can no longer be continued.")) {
      return;
    }

    try {
      const discarded = await window.subtitleTranslator.discardMediaBatchCheckpoint(resumeState.sessionId);
      if (!discarded) {
        throw new Error("The saved batch changed before it could be discarded. Reload the Media page and try again.");
      }
      setBatchResumeState(undefined);
      setBatchItems(batchVideoPaths.map((path) => ({ videoPath: path, status: "Queued" })));
      appendProgress({ stage: "Preparing", message: "Saved media batch progress discarded.", progressPercent: 0 });
      setError(undefined);
    } catch (discardError) {
      setError(`Could not discard the saved media batch: ${formatError(discardError)}`);
    }
  }

  async function cancel(): Promise<void> {
    batchCancelledRef.current = true;
    await Promise.allSettled([
      window.subtitleTranslator.cancelMediaTransform(),
      window.subtitleTranslator.cancelTranslation()
    ]);
    translationActiveRef.current = false;
  }

  function changeAudioProfile(id: AudioProfileId): void {
    updateMediaConfig(id === "copy" ? { audioProfileId: id, audioGainDb: 0 } : { audioProfileId: id });
  }

  function saveAudioProfileSlots(slots: AudioProfileId[]): void {
    const selectedSlot = audioProfileSlots.indexOf(audioProfileId);
    setAudioProfileSlots(slots);
    if (selectedSlot >= 0) {
      changeAudioProfile(slots[selectedSlot]);
    }
    writeStorage(AUDIO_PROFILE_SLOTS_KEY, JSON.stringify(slots));
    setEditingAudioProfiles(false);
  }

  function changeOutputMode(mode: MediaOutputMode): void {
    updateMediaConfig(mode === "replace-original" ? { outputMode: mode, outputContainerId: "mkv" } : { outputMode: mode });
  }

  const isBatchMode = inputMode === "batch";
  const activeVideoPaths = isBatchMode ? batchVideoPaths : videoPath ? [videoPath] : [];
  const allSourcesAreMkv = activeVideoPaths.length > 0 && activeVideoPaths.every((path) => path.toLowerCase().endsWith(".mkv"));
  const subtitleInputReady = subtitleWorkflow !== "existing" || (
    isBatchMode
      ? batchSubtitlePaths.length > 0 && batchSubtitleMatches.missingVideoPaths.length === 0
      : Boolean(subtitlePath.trim())
  );
  const outputModeReady = outputMode === "new-file" || (allSourcesAreMkv && outputContainerId === "mkv");
  const canBuild = Boolean(
    activeVideoPaths.length > 0 &&
    (probe && probe.filePath === videoPath && probe.audioTracks.length > 0) &&
    subtitleInputReady &&
    outputModeReady &&
    !busy
  );
  const canTranslateAndBuild = Boolean(canBuild && selectedTrack?.isSupported);
  const hasResumableBatch = isBatchMode && Boolean(batchResumeState);

  const chosenWorkflow = mediaProfiles.find((profile) => profile.id === selectedMediaProfileId);
  const manual = !chosenWorkflow && !hasResumableBatch;
  const translationOnlyProfiles = workflowProfiles.filter((profile) => !profile.config.media.enabled);
  const canRun = !busy && (subtitleWorkflow === "translate" ? canTranslateAndBuild : canBuild);
  const runHint = activeVideoPaths.length === 0
    ? isBatchMode ? "Add videos to the batch to start." : "Choose a video to start."
    : !probe || probe.filePath !== videoPath
      ? "Reading media streams…"
      : probe.audioTracks.length === 0
        ? "The selected video has no audio tracks to process."
        : !subtitleInputReady
          ? isBatchMode ? "Choose one matching subtitle file for every video." : "Choose a subtitle file, or change the subtitle action."
          : !outputModeReady
            ? "Replace original works only with MKV sources and MKV output."
            : subtitleWorkflow === "translate" && !selectedTrack?.isSupported
              ? "Choose a supported subtitle track to translate."
              : undefined;

  return (
    <section className="page media-page" aria-labelledby="media-page-title">
      <header className="page-header">
        <div className="page-title">
          <h2 id="media-page-title">Media studio</h2>
          <p>Remux video, reshape audio, and add finished subtitles.</p>
        </div>
        {!editingWorkflow && onSaveWorkflowProfile && (
          <div className="page-actions media-heading-actions">
            <button className="text-button" disabled={busy || hasResumableBatch} onClick={() => setEditingWorkflow("new")} type="button"><Plus size={16} /> New workflow</button>
          </div>
        )}
      </header>
      {editingWorkflow && onSaveWorkflowProfile && (
        <div className="media-editor-shell">
          <WorkflowProfilesPanel editorOnly initialProfile={editingWorkflow === "new" ? undefined : editingWorkflow}
            currentSettings={settings} profiles={workflowProfiles}
            onSave={async (draft) => {
              const saved = await onSaveWorkflowProfile(draft);
              if (saved.config.media.enabled) {
                setSelectedMediaProfileId(saved.id);
                applyMediaProfile(workflowProfileToMediaConfig(saved));
                setProfileTranslationSettings(saved.config.translation.settings);
              }
              if (saved.config.translation.enabled && saved.config.translation.trackPreference === "english" && probe) {
                onSubtitleTrackSelected(findEnglishSubtitleTrack(supportedSubtitleTracks));
              }
              return saved;
            }}
            onDelete={onDeleteWorkflowProfile ?? (async () => {})} onClose={() => setEditingWorkflow(undefined)} />
        </div>
      )}
      {!editingWorkflow && <>
        <WorkflowPicker
          mediaProfiles={mediaProfiles}
          translationOnlyProfiles={translationOnlyProfiles}
          selectedProfileId={selectedMediaProfileId}
          manual={manual}
          disabled={busy || hasResumableBatch}
          canEdit={Boolean(onSaveWorkflowProfile)}
          onSelectProfile={selectMediaProfile}
          onSelectManual={() => {
            setSelectedMediaProfileId("");
            setProfileTranslationSettings(undefined);
          }}
          onEditProfile={setEditingWorkflow}
        />

        <div className="two-column media-grid">
          <fieldset className="column workflow-fields" disabled={busy}>
            <MediaSourcePanel
              inputMode={inputMode}
              videoPath={videoPath}
              batchVideoPaths={batchVideoPaths}
              probe={probe}
              busy={busy}
              locked={hasResumableBatch}
              onChoose={isBatchMode ? chooseBatchVideos : chooseVideo}
              onModeChange={setMediaInputMode}
              onSelectReference={(path) => void loadReferenceVideo(path)}
              onRemove={(path) => void removeBatchVideo(path)}
              onClear={clearBatchVideos}
            />

            {(manual || audioProfileId !== "copy" || keepOnlySelectedAudioTrack) && (
              <MediaAudioPanel
                isBatchMode={isBatchMode}
                manual={manual}
                locked={hasResumableBatch}
                probe={probe}
                audioTrackIndex={audioTrackIndex}
                audioProfileId={audioProfileId}
                audioProfileSlots={audioProfileSlots}
                editingAudioProfiles={editingAudioProfiles}
                keepOnlySelectedAudioTrack={keepOnlySelectedAudioTrack}
                audioGainDb={audioGainDb}
                onAudioTrackChange={setAudioTrackIndex}
                onAudioProfileChange={changeAudioProfile}
                onEditAudioProfiles={() => setEditingAudioProfiles(true)}
                onSaveAudioProfileSlots={saveAudioProfileSlots}
                onCancelAudioProfileEdit={() => setEditingAudioProfiles(false)}
                onKeepOnlySelectedAudioTrackChange={(value) => updateMediaConfig({ keepOnlySelectedAudioTrack: value })}
                onAudioGainChange={(value) => updateMediaConfig({ audioGainDb: value })}
              />
            )}

            {(manual || subtitleWorkflow !== "none") && (
              <MediaSubtitlePanel
                isBatchMode={isBatchMode}
                manual={manual}
                busy={busy}
                locked={hasResumableBatch}
                subtitleWorkflow={subtitleWorkflow}
                supportedSubtitleTracks={supportedSubtitleTracks}
                selectedTrack={selectedTrack}
                subtitlePath={subtitlePath}
                subtitleEncodingId={subtitleEncodingId}
                keepOnlyNewSubtitleTrack={keepOnlyNewSubtitleTrack}
                latestTranslatedSubtitleReady={Boolean(latestTranslatedSubtitlePath)}
                batchVideoCount={batchVideoPaths.length}
                batchSubtitleCount={batchSubtitlePaths.length}
                batchMatchedCount={Object.keys(batchSubtitleMatches.matches).length}
                batchMissingVideoPaths={batchSubtitleMatches.missingVideoPaths}
                onSubtitleWorkflowChange={(value) => updateMediaConfig({ subtitleWorkflow: value })}
                onSubtitleTrackChange={(track) => {
                  updateMediaConfig({ subtitleTrackPreference: "selected" });
                  onSubtitleTrackSelected(track);
                }}
                onSubtitleEncodingChange={(value) => updateMediaConfig({ subtitleEncodingId: value })}
                onChooseSubtitleFile={chooseSubtitleFile}
                onKeepOnlyNewSubtitleTrackChange={(value) => updateMediaConfig({ keepOnlyNewSubtitleTrack: value })}
              />
            )}
          </fieldset>

          <aside className="column sticky-column">
            <MediaRunCard
              busy={busy}
              isBatchMode={isBatchMode}
              batchVideoCount={batchVideoPaths.length}
              resumable={hasResumableBatch}
              canRun={canRun}
              canContinue={!busy && Boolean(probe)}
              hint={canRun || hasResumableBatch ? undefined : runHint}
              progress={progress}
              onRun={() => void (subtitleWorkflow === "translate" ? translateAndBuild() : buildOnly())}
              onContinue={() => void continueMediaBatch()}
              onCancel={() => void cancel()}
            />

            {hasResumableBatch && batchResumeState && (
              <section className="notice warning">
                <AlertCircle size={18} />
                <div>
                  <strong>Batch paused — progress saved</strong>
                  <span>
                    {batchResumeState.reason} Completed files and translated chunks will be skipped when you continue.
                  </span>
                </div>
                <button className="ghost-button button-sm" onClick={discardSavedMediaBatch} disabled={busy} type="button">
                  <Trash2 size={14} />
                  Discard saved batch
                </button>
              </section>
            )}

            {error && (
              <section className="notice error" role="alert">
                <AlertCircle size={18} />
                <span>{error}</span>
              </section>
            )}

            {!isBatchMode && result && (
              <section className="notice success">
                <CheckCircle2 size={18} />
                <div>
                  <strong title={result.outputPath}>{fileName(result.outputPath)}</strong>
                  <span>
                    {result.audioProfileLabel}, video copied{result.subtitleAdded ? ", Bulgarian subtitles added" : ""}
                    {`, ${result.outputContainerLabel}`}
                    {result.audioGainDb !== 0 ? `, volume ${formatGainDb(result.audioGainDb)}` : ""}
                    {result.outputMode === "replace-original" ? ", original replaced" : ""}
                  </span>
                </div>
                <button className="icon-button button-sm" onClick={() => void window.subtitleTranslator.showItemInFolder(result.outputPath)} title="Open output" aria-label="Open output" type="button">
                  <ExternalLink size={16} />
                </button>
              </section>
            )}

            <fieldset className="column" disabled={busy}>
              <MediaOutputPanel
                isBatchMode={isBatchMode}
                manual={manual}
                busy={busy}
                locked={hasResumableBatch}
                videoPath={videoPath}
                batchVideoCount={batchVideoPaths.length}
                hasSources={activeVideoPaths.length > 0}
                allSourcesAreMkv={allSourcesAreMkv}
                outputMode={outputMode}
                outputContainerId={outputContainerId}
                outputConflictMode={outputConflictMode}
                outputDirectory={outputDirectory}
                onChooseOutputFolder={chooseOutputFolder}
                onOutputModeChange={changeOutputMode}
                onOutputContainerChange={(value) => updateMediaConfig({ outputContainerId: value })}
                onOutputConflictModeChange={(value) => updateMediaConfig({ outputConflictMode: value })}
              />
            </fieldset>

            {isBatchMode && batchItems.length > 0 && (
              <MediaBatchResults
                items={batchItems}
                onOpenOutput={(path) => void window.subtitleTranslator.showItemInFolder(path)}
              />
            )}
          </aside>
        </div>
      </>}
    </section>
  );
}
