import { parseFfmpegProgressLine } from "../core/media/MeasuredProgress";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, rename, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, parse } from "node:path";
import {
  AudioProfileId,
  AudioTransformProfile,
  audioTransformProfiles,
  validateAudioGainDb
} from "../core/media/AudioProfiles";
import {
  getMediaContainerProfile,
  MediaContainerId,
  MediaContainerProfile
} from "../core/media/MediaContainers";
import { decodeSubtitleBytes, SubtitleEncodingId } from "../core/media/SubtitleEncodings";
import { AudioTrack } from "../core/video/AudioTrack";
import { OtherMediaStream, VideoTrack } from "../core/video/MediaStream";
import { ProbeResult } from "../core/video/ProbeResult";
import { SubtitleTrack } from "../core/video/SubtitleTrack";
import { ensureOutputDirectory, OutputConflictMode, resolveConflictPath } from "./fileSystemService";
import { probeVideo } from "./ffprobeService";
import { getFfmpegPath } from "./staticBinaries";
import { getTextSubtitleExtractionTarget } from "./subtitleExtractionService";
import { readSubtitleAsSrt, verifyEmbeddedCues, verifySubtitlePlayback } from "./subtitleValidation";

export type MediaOutputMode = "new-file" | "replace-original";

export interface MediaTransformRequest {
  videoPath: string;
  audioTrackIndex?: number;
  audioProfileId: AudioProfileId;
  keepOnlySelectedAudioTrack?: boolean;
  subtitlePath?: string;
  keepOnlyNewSubtitleTrack?: boolean;
  subtitleEncodingId?: SubtitleEncodingId;
  subtitleLanguage?: string;
  subtitleTitle?: string;
  outputDirectory?: string;
  outputConflictMode: OutputConflictMode;
  outputMode?: MediaOutputMode;
  outputContainerId?: MediaContainerId;
  audioGainDb?: number;
}

export interface MediaTranslationPreparationRequest extends MediaTransformRequest {
  subtitleTrack: SubtitleTrack;
}

export interface MediaTranslationPreparation {
  extractedSubtitlePath: string;
  preparedMediaPath: string;
  finalOutputPath: string;
  outputMode: MediaOutputMode;
  /** Only "overwrite" may replace a file that appeared at the output path during translation. */
  outputConflictMode: OutputConflictMode;
  result: MediaTransformResult;
}

export interface FinalizeMediaTranslationRequest {
  subtitlePath: string;
  subtitleEncodingId?: SubtitleEncodingId;
  subtitleLanguage?: string;
  subtitleTitle?: string;
}

export interface MediaTransformResult {
  outputPath: string;
  audioProfileId: AudioProfileId;
  audioProfileLabel: string;
  convertedAudioTrackIndex?: number;
  subtitleAdded: boolean;
  videoMode: "copy";
  outputMode: MediaOutputMode;
  outputContainerId: MediaContainerId;
  outputContainerLabel: string;
  audioGainDb: number;
  keptOnlySelectedAudioTrack: boolean;
  keptOnlyNewSubtitleTrack: boolean;
  preparedMediaPath?: string;
}

export interface MediaTransformProgress {
  stage: "Preparing" | "Remuxing" | "Complete";
  message: string;
  progressPercent?: number;
  outputPath?: string;
}

interface MediaTransformExecutionOptions {
  reserveSubtitleAddition?: boolean;
  deferInstall?: boolean;
  textSubtitleExtraction?: {
    trackIndex: number;
    outputPath: string;
    codecArgs: string[];
  };
}

export interface MediaTransformArgsInput {
  videoPath: string;
  outputPath: string;
  audioTracks: AudioTrack[];
  subtitleTracks: SubtitleTrack[];
  audioTrackIndex?: number;
  profile: AudioTransformProfile;
  container: MediaContainerProfile;
  audioGainDb?: number;
  keepOnlySelectedAudioTrack?: boolean;
  subtitlePath?: string;
  keepOnlyNewSubtitleTrack?: boolean;
  subtitleLanguage: string;
  subtitleTitle: string;
  reserveSubtitleAddition?: boolean;
  textSubtitleExtraction?: {
    trackIndex: number;
    outputPath: string;
    codecArgs: string[];
  };
}

export async function transformMedia(
  request: MediaTransformRequest,
  onProgress: (progress: MediaTransformProgress) => void,
  signal?: AbortSignal,
  executionOptions: MediaTransformExecutionOptions = {}
): Promise<MediaTransformResult> {
  onProgress({ stage: "Preparing", message: "Reading media streams.", progressPercent: 0 });
  const probe = await probeVideo(request.videoPath, signal);
  const profile = getAudioProfile(request.audioProfileId);
  const audioGainDb = validateAudioGainDb(request.audioGainDb);
  if (profile.codec === "copy" && audioGainDb !== 0) {
    throw new Error("Volume adjustment requires an audio conversion profile; it cannot be used with Keep Original Audio.");
  }
  const container = getMediaContainerProfile(request.outputContainerId ?? "mkv");
  const selectedAudioTrack = resolveSelectedAudioTrack(profile, probe.audioTracks, request.audioTrackIndex);
  const subtitlePath = request.subtitlePath?.trim();
  const keepOnlySelectedAudioTrack = request.keepOnlySelectedAudioTrack === true;
  const keepOnlyNewSubtitleTrack = request.keepOnlyNewSubtitleTrack === true;
  if (keepOnlySelectedAudioTrack && !selectedAudioTrack) {
    throw new Error("Choose an audio track before removing the other audio tracks.");
  }
  if (keepOnlyNewSubtitleTrack && !subtitlePath && !executionOptions.reserveSubtitleAddition) {
    throw new Error("Add a subtitle file before removing the other subtitle tracks.");
  }
  const outputMode = request.outputMode ?? "new-file";
  validateContainerCompatibility({
    container,
    videoTracks: probe.videoTracks,
    audioTracks: keepOnlySelectedAudioTrack && selectedAudioTrack ? [selectedAudioTrack] : probe.audioTracks,
    subtitleTracks: keepOnlyNewSubtitleTrack ? [] : probe.subtitleTracks,
    otherStreams: probe.otherStreams,
    selectedAudioTrackIndex: selectedAudioTrack?.index,
    profile
  });
  const finalPath = await resolveMediaOutputPath(
    request.videoPath,
    profile,
    container,
    Boolean(subtitlePath) || executionOptions.reserveSubtitleAddition === true,
    request.outputDirectory,
    request.outputConflictMode,
    outputMode
  );
  const tempPath = buildTempOutputPath(finalPath);

  await ensureOutputDirectory(dirname(finalPath));

  onProgress({
    stage: "Remuxing",
    message: describeMediaTransform(profile, container, outputMode, audioGainDb),
    progressPercent: 0,
    outputPath: finalPath
  });

  const addedSubtitleLabels = subtitleLabels(request);
  let preparedSubtitle: PreparedSubtitleInput | undefined;
  try {
    preparedSubtitle = subtitlePath
      ? await prepareSubtitleInput(subtitlePath, request.subtitleEncodingId ?? "utf-8", signal)
      : undefined;
    const args = buildMediaTransformArgs({
      videoPath: request.videoPath,
      outputPath: tempPath,
      audioTracks: probe.audioTracks,
      subtitleTracks: probe.subtitleTracks,
      audioTrackIndex: selectedAudioTrack?.index,
      profile,
      container,
      audioGainDb,
      keepOnlySelectedAudioTrack,
      subtitlePath: preparedSubtitle?.path,
      keepOnlyNewSubtitleTrack,
      subtitleLanguage: addedSubtitleLabels.language,
      subtitleTitle: addedSubtitleLabels.title,
      reserveSubtitleAddition: executionOptions.reserveSubtitleAddition,
      textSubtitleExtraction: executionOptions.textSubtitleExtraction
    });

    await runFfmpegWithProgress(args, probe.durationSeconds, (progressPercent) => {
      onProgress({
        stage: "Remuxing",
        message: describeMediaTransform(profile, container, outputMode, audioGainDb),
        progressPercent,
        outputPath: finalPath
      });
    }, signal);

    await validateTransformedMedia(tempPath, {
      sourceProbe: probe,
      profile,
      selectedAudioTrackIndex: selectedAudioTrack?.index,
      keepOnlySelectedAudioTrack,
      keepOnlyNewSubtitleTrack,
      addedSubtitle: subtitlePath ? addedSubtitleLabels : undefined,
      container
    });

    if (preparedSubtitle) {
      onProgress({ stage: "Remuxing", message: "Verifying embedded subtitle cues before saving the movie.", progressPercent: 99, outputPath: finalPath });
      await verifyAddedSubtitle(tempPath, preparedSubtitle.path, signal);
    }

    if (executionOptions.deferInstall) {
      // The caller owns the validated temporary media until the translated subtitle is attached.
    } else if (outputMode === "replace-original") {
      await replaceOriginalFile(finalPath, tempPath);
    } else {
      if (request.outputConflictMode === "overwrite") {
        await rm(finalPath, { force: true });
      }
      await rename(tempPath, finalPath);
    }
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await preparedSubtitle?.cleanup();
  }

  onProgress({
    stage: "Complete",
    message: "Media file ready.",
    progressPercent: 100,
    outputPath: finalPath
  });

  return {
    outputPath: finalPath,
    audioProfileId: profile.id,
    audioProfileLabel: profile.label,
    convertedAudioTrackIndex: profile.codec === "copy" ? undefined : selectedAudioTrack?.index,
    subtitleAdded: Boolean(subtitlePath),
    videoMode: "copy",
    outputMode,
    outputContainerId: container.id,
    outputContainerLabel: container.label,
    audioGainDb,
    keptOnlySelectedAudioTrack: keepOnlySelectedAudioTrack,
    keptOnlyNewSubtitleTrack: keepOnlyNewSubtitleTrack,
    preparedMediaPath: executionOptions.deferInstall ? tempPath : undefined
  };
}

export async function prepareMediaForTranslation(
  request: MediaTranslationPreparationRequest,
  onProgress: (progress: MediaTransformProgress) => void,
  signal?: AbortSignal
): Promise<MediaTranslationPreparation> {
  const extraction = await getTextSubtitleExtractionTarget(request.videoPath, request.subtitleTrack);
  let preparedMediaPath: string | undefined;
  try {
    const result = await transformMedia(request, onProgress, signal, {
      reserveSubtitleAddition: true,
      deferInstall: true,
      textSubtitleExtraction: extraction.needsExtraction
        ? {
            trackIndex: request.subtitleTrack.index,
            outputPath: extraction.filePath,
            codecArgs: extraction.ffmpegCodecArgs
          }
        : undefined
    });
    preparedMediaPath = result.preparedMediaPath;
    const extractedContent = await readFile(extraction.filePath, "utf8");
    if (!extractedContent.trim()) {
      throw new Error("The selected text subtitle track was extracted without readable text.");
    }
    if (!result.preparedMediaPath) {
      throw new Error("Media preparation completed without a temporary output.");
    }
    return {
      extractedSubtitlePath: extraction.filePath,
      preparedMediaPath: result.preparedMediaPath,
      finalOutputPath: result.outputPath,
      outputMode: result.outputMode,
      outputConflictMode: request.outputConflictMode,
      result
    };
  } catch (error) {
    if (preparedMediaPath) {
      await rm(preparedMediaPath, { force: true }).catch(() => undefined);
    }
    if (extraction.needsExtraction) {
      await rm(extraction.filePath, { force: true }).catch(() => undefined);
    }
    throw error;
  }
}

export async function finalizeMediaTranslation(
  preparation: MediaTranslationPreparation,
  request: FinalizeMediaTranslationRequest,
  onProgress: (progress: MediaTransformProgress) => void,
  signal?: AbortSignal
): Promise<MediaTransformResult> {
  const sourceProbe = await probeVideo(preparation.preparedMediaPath, signal);
  const container = getMediaContainerProfile(preparation.result.outputContainerId);
  const profile = getAudioProfile("copy");
  const preparedSubtitle = await prepareSubtitleInput(request.subtitlePath, request.subtitleEncodingId ?? "utf-8", signal);
  const tempFinalPath = buildTempOutputPath(preparation.finalOutputPath);
  const addedSubtitleLabels = subtitleLabels(request);

  try {
    const args = buildSubtitleAttachmentArgs({
      mediaPath: preparation.preparedMediaPath,
      subtitlePath: preparedSubtitle.path,
      outputPath: tempFinalPath,
      container,
      existingSubtitleCount: sourceProbe.subtitleTracks.length,
      subtitleLanguage: addedSubtitleLabels.language,
      subtitleTitle: addedSubtitleLabels.title
    });
    onProgress({
      stage: "Remuxing",
      message: "Attaching translated Bulgarian subtitles.",
      progressPercent: 0,
      outputPath: preparation.finalOutputPath
    });
    await runFfmpegWithProgress(args, sourceProbe.durationSeconds, (progressPercent) => {
      onProgress({
        stage: "Remuxing",
        message: "Attaching translated Bulgarian subtitles.",
        progressPercent,
        outputPath: preparation.finalOutputPath
      });
    }, signal);
    await validateTransformedMedia(tempFinalPath, {
      sourceProbe,
      profile,
      keepOnlySelectedAudioTrack: false,
      keepOnlyNewSubtitleTrack: false,
      addedSubtitle: addedSubtitleLabels,
      container
    });

    onProgress({ stage: "Remuxing", message: "Verifying embedded subtitle cues before saving the movie.", progressPercent: 99, outputPath: preparation.finalOutputPath });
    await verifyAddedSubtitle(tempFinalPath, preparedSubtitle.path, signal);

    if (preparation.outputMode === "replace-original") {
      await replaceOriginalFile(preparation.finalOutputPath, tempFinalPath);
    } else {
      if (preparation.outputConflictMode === "overwrite") {
        await rm(preparation.finalOutputPath, { force: true });
      }
      await rename(tempFinalPath, preparation.finalOutputPath);
    }
    await rm(preparation.preparedMediaPath, { force: true }).catch(() => undefined);
  } catch (error) {
    await rm(tempFinalPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await preparedSubtitle.cleanup();
  }

  onProgress({
    stage: "Complete",
    message: "Media file ready.",
    progressPercent: 100,
    outputPath: preparation.finalOutputPath
  });
  return {
    ...preparation.result,
    outputPath: preparation.finalOutputPath,
    subtitleAdded: true,
    preparedMediaPath: undefined
  };
}

/** Language and title for the added subtitle stream; Bulgarian unless the request says otherwise. */
function subtitleLabels(request: { subtitleLanguage?: string; subtitleTitle?: string }): { language: string; title: string } {
  return {
    language: request.subtitleLanguage?.trim() || "bul",
    title: request.subtitleTitle?.trim() || "Bulgarian"
  };
}

interface SubtitleAttachmentArgsInput {
  mediaPath: string;
  subtitlePath: string;
  outputPath: string;
  container: MediaContainerProfile;
  existingSubtitleCount: number;
  subtitleLanguage: string;
  subtitleTitle: string;
}

export function buildSubtitleAttachmentArgs(input: SubtitleAttachmentArgsInput): string[] {
  return [
    "-y",
    "-hide_banner",
    "-i",
    input.mediaPath,
    "-sub_charenc",
    "UTF-8",
    "-i",
    input.subtitlePath,
    "-map",
    "0",
    "-map",
    "1:0",
    "-map_metadata",
    "0",
    "-map_chapters",
    "0",
    "-c",
    "copy",
    "-c:s",
    input.container.subtitleCodec,
    `-metadata:s:s:${input.existingSubtitleCount}`,
    `language=${input.subtitleLanguage}`,
    `-metadata:s:s:${input.existingSubtitleCount}`,
    `title=${input.subtitleTitle}`,
    `-disposition:s:${input.existingSubtitleCount}`,
    "default",
    // The bundled FFmpeg can flush video ahead of external subtitles when
    // sparse cover-image streams are present. Preserve timestamp interleaving.
    "-max_interleave_delta",
    "0",
    "-progress",
    "pipe:1",
    "-nostats",
    input.outputPath
  ];
}

export async function discardMediaTranslationPreparation(
  preparation: MediaTranslationPreparation
): Promise<void> {
  await rm(preparation.preparedMediaPath, { force: true }).catch(() => undefined);
}

export function buildMediaTransformArgs(input: MediaTransformArgsInput): string[] {
  const audioGainDb = validateAudioGainDb(input.audioGainDb);
  if (input.profile.codec === "copy" && audioGainDb !== 0) {
    throw new Error("Volume adjustment requires an audio conversion profile; it cannot be used with Keep Original Audio.");
  }
  const args = ["-y", "-hide_banner", "-i", input.videoPath];

  if (input.subtitlePath) {
    args.push("-sub_charenc", "UTF-8", "-i", input.subtitlePath);
  }

  if (input.container.id === "mkv") {
    args.push("-map", "0");
    if (input.keepOnlySelectedAudioTrack) {
      if (input.audioTrackIndex === undefined) {
        throw new Error("Choose an audio track before removing the other audio tracks.");
      }
      args.push("-map", "-0:a?", "-map", `0:${input.audioTrackIndex}`);
    }
    if (input.keepOnlyNewSubtitleTrack) {
      args.push("-map", "-0:s?");
    }
  } else {
    args.push("-map", "0:v?");
    if (input.keepOnlySelectedAudioTrack) {
      if (input.audioTrackIndex === undefined) {
        throw new Error("Choose an audio track before removing the other audio tracks.");
      }
      args.push("-map", `0:${input.audioTrackIndex}`);
    } else {
      args.push("-map", "0:a?");
    }
    if (!input.keepOnlyNewSubtitleTrack) {
      args.push("-map", "0:s?");
    }
  }
  if (input.subtitlePath) {
    args.push("-map", "1:0");
  } else if (input.keepOnlyNewSubtitleTrack && !input.reserveSubtitleAddition) {
    throw new Error("Add a subtitle file before removing the other subtitle tracks.");
  }

  args.push(
    "-map_metadata",
    "0",
    "-map_chapters",
    "0",
    "-c",
    "copy",
    "-c:v",
    "copy",
    "-c:a",
    "copy",
    "-c:s",
    input.container.subtitleCodec
  );

  if (input.profile.codec !== "copy") {
    const outputAudioIndex = input.keepOnlySelectedAudioTrack
      ? 0
      : input.audioTracks.findIndex((track) => track.index === input.audioTrackIndex);
    if (outputAudioIndex < 0) {
      throw new Error("Choose an audio track before converting audio.");
    }

    args.push(`-c:a:${outputAudioIndex}`, input.profile.encoder ?? input.profile.codec);
    if (input.profile.bitRate) {
      args.push(`-b:a:${outputAudioIndex}`, input.profile.bitRate);
    }
    if (input.profile.channels) {
      args.push(`-ac:a:${outputAudioIndex}`, String(input.profile.channels));
    }
    if (input.profile.sampleRate) {
      args.push(`-ar:a:${outputAudioIndex}`, String(input.profile.sampleRate));
    }
    if (audioGainDb !== 0) {
      args.push(`-filter:a:${outputAudioIndex}`, buildAudioGainFilter(audioGainDb));
    }
    args.push(`-metadata:s:a:${outputAudioIndex}`, `title=${input.profile.outputTitle}`);
  }

  if (input.subtitlePath) {
    const outputSubtitleIndex = input.keepOnlyNewSubtitleTrack ? 0 : input.subtitleTracks.length;
    args.push(
      `-metadata:s:s:${outputSubtitleIndex}`,
      `language=${input.subtitleLanguage}`,
      `-metadata:s:s:${outputSubtitleIndex}`,
      `title=${input.subtitleTitle}`,
      `-disposition:s:${outputSubtitleIndex}`,
      "default"
    );
  }

  if (input.subtitlePath) {
    args.push("-max_interleave_delta", "0");
  }
  args.push("-progress", "pipe:1", "-nostats", input.outputPath);
  if (input.textSubtitleExtraction) {
    args.push(
      "-map",
      `0:${input.textSubtitleExtraction.trackIndex}`,
      "-vn",
      "-an",
      "-dn",
      ...input.textSubtitleExtraction.codecArgs,
      input.textSubtitleExtraction.outputPath
    );
  }
  return args;
}

async function verifyAddedSubtitle(mediaPath: string, subtitlePath: string, signal?: AbortSignal): Promise<void> {
  const expected = await readSubtitleAsSrt(subtitlePath, 0, signal);
  const probe = await probeVideo(mediaPath, signal);
  const addedTrack = probe.subtitleTracks.at(-1);
  if (!addedTrack) throw new Error("The embedded subtitle track is missing.");
  await verifySubtitlePlayback(mediaPath, addedTrack.index, expected, signal);
  const actual = await readSubtitleAsSrt(mediaPath, addedTrack.index, signal);
  verifyEmbeddedCues(expected, actual);
}

interface PreparedSubtitleInput {
  path: string;
  cleanup: () => Promise<void>;
}

async function prepareSubtitleInput(
  subtitlePath: string,
  encodingId: SubtitleEncodingId,
  signal?: AbortSignal
): Promise<PreparedSubtitleInput> {
  const bytes = await readFile(subtitlePath);
  const content = decodeSubtitleBytes(bytes, encodingId);
  const directory = await mkdtemp(join(tmpdir(), "substranslate-subtitle-"));
  const preparedPath = join(directory, basename(subtitlePath));

  try {
    await writeFile(preparedPath, content, "utf8");
    await readSubtitleAsSrt(preparedPath, 0, signal);
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  return {
    path: preparedPath,
    cleanup: () => rm(directory, { recursive: true, force: true }).catch(() => undefined)
  };
}

function getAudioProfile(profileId: AudioProfileId): AudioTransformProfile {
  const profile = audioTransformProfiles.find((item) => item.id === profileId);
  if (!profile) {
    throw new Error(`Unknown audio profile: ${profileId}`);
  }
  return profile;
}

function resolveSelectedAudioTrack(
  profile: AudioTransformProfile,
  audioTracks: AudioTrack[],
  audioTrackIndex?: number
): AudioTrack | undefined {
  if (profile.codec === "copy") {
    return audioTrackIndex === undefined ? audioTracks[0] : audioTracks.find((track) => track.index === audioTrackIndex);
  }

  const selected = audioTracks.find((track) => track.index === audioTrackIndex);
  if (!selected) {
    throw new Error("Choose an audio track before converting audio.");
  }
  return selected;
}

interface ContainerCompatibilityInput {
  container: MediaContainerProfile;
  videoTracks: VideoTrack[];
  audioTracks: AudioTrack[];
  subtitleTracks: SubtitleTrack[];
  otherStreams: OtherMediaStream[];
  selectedAudioTrackIndex?: number;
  profile: AudioTransformProfile;
}

const mp4VideoCodecs = new Set(["av1", "h264", "hevc", "mjpeg", "mpeg2video", "mpeg4", "vp9"]);
const movVideoCodecs = new Set([...mp4VideoCodecs, "dnxhd", "png", "prores", "qtrle", "rawvideo"]);
const mp4AudioCodecs = new Set(["aac", "ac3", "alac", "eac3", "mp3", "opus"]);
const movAudioCodecs = new Set([
  ...mp4AudioCodecs,
  "pcm_f32be",
  "pcm_f32le",
  "pcm_f64be",
  "pcm_f64le",
  "pcm_s16be",
  "pcm_s16le",
  "pcm_s24be",
  "pcm_s24le",
  "pcm_s32be",
  "pcm_s32le"
]);

export function validateContainerCompatibility(input: ContainerCompatibilityInput): void {
  if (input.container.id === "mkv") {
    return;
  }

  const videoCodecs = input.container.id === "mp4" ? mp4VideoCodecs : movVideoCodecs;
  const audioCodecs = input.container.id === "mp4" ? mp4AudioCodecs : movAudioCodecs;
  const incompatibleVideo = input.videoTracks.find((track) => !videoCodecs.has(track.codecName));
  if (incompatibleVideo) {
    throw new Error(
      `${input.container.label} cannot safely copy ${incompatibleVideo.codecName} video. Choose Matroska (MKV).`
    );
  }

  const incompatibleAudio = input.audioTracks.find((track) => {
    const outputCodec =
      input.profile.codec !== "copy" && track.index === input.selectedAudioTrackIndex
        ? input.profile.codec
        : track.codecName;
    return !audioCodecs.has(outputCodec);
  });
  if (incompatibleAudio) {
    throw new Error(
      `${input.container.label} cannot safely copy ${incompatibleAudio.codecName} audio. Convert that track or choose Matroska (MKV).`
    );
  }

  const imageSubtitle = input.subtitleTracks.find((track) => !track.isTextBased);
  if (imageSubtitle) {
    throw new Error(
      `${input.container.label} cannot preserve ${imageSubtitle.codecName} image subtitles. Choose Matroska (MKV).`
    );
  }

  if (input.otherStreams.length > 0) {
    const streamTypes = [...new Set(input.otherStreams.map((stream) => stream.codecType))].join(", ");
    throw new Error(
      `${input.container.label} cannot preserve ${streamTypes} streams or attachments. Choose Matroska (MKV).`
    );
  }
}

function describeMediaTransform(
  profile: AudioTransformProfile,
  container: MediaContainerProfile,
  outputMode: MediaOutputMode,
  audioGainDb: number
): string {
  const target = outputMode === "replace-original" ? "replacement MKV" : `new ${container.extension.slice(1).toUpperCase()}`;
  const gainDescription = audioGainDb === 0 ? "" : ` with ${formatSignedDb(audioGainDb)} volume adjustment`;
  return profile.codec === "copy"
    ? `Copying streams into a ${target}.`
    : `Converting selected audio to ${profile.label}${gainDescription} and copying video into a ${target}.`;
}

export function buildAudioGainFilter(audioGainDb: number): string {
  const gainDb = validateAudioGainDb(audioGainDb);
  const volume = `volume=${formatSignedDb(gainDb)}:precision=double`;
  return gainDb > 0
    ? `${volume},alimiter=limit=0.97:attack=5:release=50:level=0:latency=1`
    : volume;
}

function formatSignedDb(value: number): string {
  return `${value > 0 ? "+" : ""}${value}dB`;
}

async function resolveMediaOutputPath(
  videoPath: string,
  profile: AudioTransformProfile,
  container: MediaContainerProfile,
  subtitleAdded: boolean,
  outputDirectory: string | undefined,
  conflictMode: OutputConflictMode,
  outputMode: MediaOutputMode
): Promise<string> {
  const parsed = parse(videoPath);
  if (outputMode === "replace-original") {
    if (!container.supportsReplaceOriginal) {
      throw new Error("Replacing the original is only available with Matroska (MKV) output.");
    }
    if (parsed.ext.toLowerCase() !== ".mkv") {
      throw new Error("Replacing the original is only available for MKV source files.");
    }
    return videoPath;
  }

  const directory = outputDirectory || parsed.dir;
  const subtitlePart = subtitleAdded ? ".bg" : "";
  const basePath = join(directory, `${parsed.name}${subtitlePart}.${profile.fileSuffix}${container.extension}`);

  return resolveConflictPath(basePath, conflictMode);
}

function buildTempOutputPath(finalPath: string): string {
  const parsed = parse(finalPath);
  return join(parsed.dir, `${parsed.name}.tmp-${process.pid}-${Date.now()}${parsed.ext}`);
}

interface TransformedMediaExpectation {
  sourceProbe: ProbeResult;
  profile: AudioTransformProfile;
  selectedAudioTrackIndex?: number;
  keepOnlySelectedAudioTrack: boolean;
  keepOnlyNewSubtitleTrack: boolean;
  addedSubtitle?: { language: string; title: string };
  container: MediaContainerProfile;
}

async function validateTransformedMedia(outputPath: string, expected: TransformedMediaExpectation): Promise<void> {
  const stats = await stat(outputPath);
  if (!stats.isFile() || stats.size === 0) {
    throw new Error("FFmpeg produced an empty media file.");
  }

  const probe = await probeVideo(outputPath);
  const formatNames = new Set(probe.formatName.split(","));
  if (!expected.container.ffprobeFormatNames.some((name) => formatNames.has(name))) {
    throw new Error(`The generated file is not a valid ${expected.container.label} container.`);
  }

  assertTrackCount("video", probe.videoTracks.length, expected.sourceProbe.videoTracks.length);
  const expectedAudioTracks = expected.keepOnlySelectedAudioTrack
    ? expected.sourceProbe.audioTracks.filter((track) => track.index === expected.selectedAudioTrackIndex)
    : expected.sourceProbe.audioTracks;
  const expectedSourceSubtitleTracks = expected.keepOnlyNewSubtitleTrack
    ? []
    : expected.sourceProbe.subtitleTracks;

  assertTrackCount("audio", probe.audioTracks.length, expectedAudioTracks.length);
  assertTrackCount(
    "subtitle",
    probe.subtitleTracks.length,
    expectedSourceSubtitleTracks.length + (expected.addedSubtitle ? 1 : 0)
  );
  assertTrackCount("other", probe.otherStreams.length, expected.sourceProbe.otherStreams.length);

  expected.sourceProbe.videoTracks.forEach((sourceTrack, index) => {
    if (probe.videoTracks[index]?.codecName !== sourceTrack.codecName) {
      throw new Error(`Video track ${index + 1} was not copied with its original codec.`);
    }
  });

  expectedAudioTracks.forEach((sourceTrack, index) => {
    const outputTrack = probe.audioTracks[index];
    const wasConverted =
      expected.profile.codec !== "copy" && sourceTrack.index === expected.selectedAudioTrackIndex;
    const expectedCodec = wasConverted ? expected.profile.codec : sourceTrack.codecName;
    if (outputTrack?.codecName !== expectedCodec) {
      throw new Error(`Audio track ${index + 1} has codec ${outputTrack?.codecName ?? "missing"}; expected ${expectedCodec}.`);
    }
    if (outputTrack.language !== sourceTrack.language) {
      throw new Error(`Audio track ${index + 1} lost its language metadata.`);
    }
    if (wasConverted) {
      if (expected.profile.channels && outputTrack.channels !== expected.profile.channels) {
        throw new Error(`Converted audio has ${outputTrack.channels ?? "unknown"} channels; expected ${expected.profile.channels}.`);
      }
      if (expected.profile.sampleRate && outputTrack.sampleRate !== expected.profile.sampleRate) {
        throw new Error(`Converted audio has an unexpected sample rate.`);
      }
      if (expected.profile.bitRate && outputTrack.bitRate
        && expected.profile.codec !== "opus" && expected.profile.codec !== "vorbis") {
        const targetBitRate = parseBitRate(expected.profile.bitRate);
        if (Math.abs(outputTrack.bitRate - targetBitRate) / targetBitRate > 0.25) {
          throw new Error(`Converted audio bitrate is outside the expected range.`);
        }
      }
    }
  });

  expectedSourceSubtitleTracks.forEach((sourceTrack, index) => {
    if (probe.subtitleTracks[index]?.language !== sourceTrack.language) {
      throw new Error(`Subtitle track ${index + 1} lost its language metadata.`);
    }
  });

  if (expected.addedSubtitle) {
    const addedTrack = probe.subtitleTracks.at(-1);
    if (addedTrack?.language !== expected.addedSubtitle.language) {
      throw new Error("The embedded subtitle track lost its language metadata.");
    }
  }

  if (expected.sourceProbe.durationSeconds && probe.durationSeconds) {
    const allowedShortfall = Math.max(0.5, expected.sourceProbe.durationSeconds * 0.01);
    if (probe.durationSeconds < expected.sourceProbe.durationSeconds - allowedShortfall) {
      throw new Error("The generated media file is unexpectedly shorter than the source.");
    }
  }
}

function assertTrackCount(kind: string, actual: number, expected: number): void {
  if (actual !== expected) {
    throw new Error(`The generated media file has ${actual} ${kind} track(s); expected ${expected}.`);
  }
}

function parseBitRate(bitRate: string): number {
  const match = /^(\d+(?:\.\d+)?)([kKmM]?)$/.exec(bitRate);
  if (!match) {
    throw new Error(`Invalid bitrate: ${bitRate}`);
  }
  const multiplier = match[2].toLowerCase() === "m" ? 1_000_000 : match[2] ? 1_000 : 1;
  return Number(match[1]) * multiplier;
}

async function replaceOriginalFile(finalPath: string, tempPath: string): Promise<void> {
  const backupPath = `${finalPath}.replacing-${process.pid}-${Date.now()}.bak`;
  await rename(finalPath, backupPath);

  try {
    await rename(tempPath, finalPath);
    await rm(backupPath, { force: true }).catch(() => undefined);
  } catch (error) {
    await rename(backupPath, finalPath).catch(() => undefined);
    throw error;
  }
}

function runFfmpegWithProgress(
  args: string[],
  durationSeconds: number | undefined,
  onProgress: (progressPercent: number) => void,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(getFfmpegPath(), args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    let stdoutBuffer = "";
    let settled = false;
    let aborted = false;
    let lastProgress = -1;

    const settle = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      callback();
    };

    const onAbort = (): void => {
      aborted = true;
      child.kill();
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const progressPercent = parseFfmpegProgressLine(line, durationSeconds);
        if (progressPercent !== undefined && progressPercent > lastProgress) {
          lastProgress = progressPercent;
          onProgress(progressPercent);
        }
      }
    });

    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) =>
      settle(() => reject(aborted ? new DOMException("Media transform cancelled.", "AbortError") : error))
    );
    child.on("close", (code) => {
      if (aborted) {
        settle(() => reject(new DOMException("Media transform cancelled.", "AbortError")));
        return;
      }
      if (code === 0) {
        settle(resolve);
      } else {
        settle(() => reject(new Error(stderr || `ffmpeg exited with code ${code}`)));
      }
    });
  });
}
