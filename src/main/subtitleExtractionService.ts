import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { SubtitleFormat } from "../core/subtitle/SubtitleCue";
import { SubtitleTrack } from "../core/video/SubtitleTrack";
import { getFfmpegPath } from "./staticBinaries";
import { runProcess } from "./processUtils";

export interface ExtractedSubtitle {
  filePath: string;
  format: SubtitleFormat;
  content: string;
}

export interface SubtitleExtractionOptions {
  signal?: AbortSignal;
  onProgress?: (progress: SubtitleExtractionProgress) => void;
}

export interface SubtitleExtractionProgress {
  stage: "ocr";
  completedImages: number;
  totalImages: number;
  readableCues: number;
}

export async function extractSubtitleTrack(
  videoPath: string,
  track: SubtitleTrack,
  signalOrOptions?: AbortSignal | SubtitleExtractionOptions
): Promise<ExtractedSubtitle> {
  const options = normalizeExtractionOptions(signalOrOptions);
  if (!track.isSupported || !track.supportedFormat) {
    throw new Error(track.reason ?? "This subtitle track is not supported.");
  }

  const extractionRoot = getExtractionWorkDirectory();
  await mkdir(extractionRoot, { recursive: true });
  const extension = track.supportedFormat === "webvtt" ? "vtt" : track.supportedFormat === "pgs" ? "sup" : track.supportedFormat;
  const cachePath = track.isTextBased
    ? await getTextExtractionCachePath(extractionRoot, videoPath, track, extension)
    : undefined;
  if (cachePath) {
    const cachedContent = await readCachedTextSubtitle(cachePath);
    if (cachedContent !== undefined) {
      return {
        filePath: cachePath,
        format: track.supportedFormat,
        content: cachedContent
      };
    }
  }

  const tempDir = await mkdtemp(join(extractionRoot, "bg-subtitle-"));
  const outputPath = join(tempDir, `track-${track.index}.${extension}`);
  const args = [
    "-nostdin",
    "-loglevel",
    "error",
    "-y",
    "-i",
    videoPath,
    "-map",
    `0:${track.index}`,
    "-vn",
    "-an",
    "-dn",
    ...codecArgs(track),
    outputPath
  ];

  await runProcess(getFfmpegPath(), args, options.signal);

  if (track.supportedFormat === "pgs") {
    const { ocrPgsSupToSrt } = await import("./pgsOcrService");
    return {
      filePath: outputPath,
      format: "srt",
      content: await ocrPgsSupToSrt(outputPath, {
        language: ocrLanguageForTrack(track),
        signal: options.signal,
        onProgress: (progress) => {
          options.onProgress?.({
            stage: "ocr",
            completedImages: progress.completedImages,
            totalImages: progress.totalImages,
            readableCues: progress.readableCues
          });
        }
      })
    };
  }

  const content = await readFile(outputPath, "utf8");
  if (cachePath) {
    await mkdir(dirname(cachePath), { recursive: true });
    await rename(outputPath, cachePath);
  }

  return {
    filePath: cachePath ?? outputPath,
    format: track.supportedFormat,
    content
  };
}

export interface TextSubtitleExtractionTarget {
  filePath: string;
  format: SubtitleFormat;
  ffmpegCodecArgs: string[];
  needsExtraction: boolean;
}

export async function getTextSubtitleExtractionTarget(
  videoPath: string,
  track: SubtitleTrack
): Promise<TextSubtitleExtractionTarget> {
  if (!track.isSupported || !track.isTextBased || !track.supportedFormat) {
    throw new Error("Only supported text subtitle tracks can be extracted during media processing.");
  }

  const extractionRoot = getExtractionWorkDirectory();
  const extension = track.supportedFormat === "webvtt" ? "vtt" : track.supportedFormat;
  const filePath = await getTextExtractionCachePath(extractionRoot, videoPath, track, extension);
  const cachedContent = await readCachedTextSubtitle(filePath);
  await mkdir(dirname(filePath), { recursive: true });
  return {
    filePath,
    format: track.supportedFormat,
    ffmpegCodecArgs: codecArgs(track),
    needsExtraction: cachedContent === undefined
  };
}

function getExtractionWorkDirectory(): string {
  return resolve(process.env.SUBS_TRANSLATE_WORK_DIR ?? join(process.cwd(), "work", "extracted"));
}

function normalizeExtractionOptions(signalOrOptions?: AbortSignal | SubtitleExtractionOptions): SubtitleExtractionOptions {
  if (!signalOrOptions) {
    return {};
  }

  if ("aborted" in signalOrOptions && "throwIfAborted" in signalOrOptions) {
    return { signal: signalOrOptions };
  }

  return signalOrOptions;
}

function codecArgs(track: SubtitleTrack): string[] {
  if (track.codecName.toLowerCase() === "mov_text") {
    return ["-c:s", "srt"];
  }

  return ["-c:s", "copy"];
}

async function getTextExtractionCachePath(
  extractionRoot: string,
  videoPath: string,
  track: SubtitleTrack,
  extension: string
): Promise<string> {
  const video = await stat(videoPath);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({
      version: 1,
      videoPath: resolve(videoPath).toLocaleLowerCase(),
      size: video.size,
      modifiedAtMs: video.mtimeMs,
      trackIndex: track.index,
      codecName: track.codecName,
      format: track.supportedFormat
    }))
    .digest("hex")
    .slice(0, 32);

  return join(extractionRoot, "text-cache", `${fingerprint}.track-${track.index}.${extension}`);
}

async function readCachedTextSubtitle(cachePath: string): Promise<string | undefined> {
  try {
    const content = await readFile(cachePath, "utf8");
    return content.trim() ? content : undefined;
  } catch {
    return undefined;
  }
}

function ocrLanguageForTrack(track: SubtitleTrack): string {
  const language = track.language.toLowerCase();
  if (language === "eng" || language === "en") {
    return "eng";
  }
  if (language === "spa" || language === "es") {
    return "spa";
  }
  if (language === "fre" || language === "fra" || language === "fr") {
    return "fra";
  }
  if (language === "jpn" || language === "ja") {
    return "jpn";
  }
  if (language === "chi" || language === "zho" || language === "zh") {
    return "chi_sim";
  }
  return "eng";
}
