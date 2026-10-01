import { link, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, parse } from "node:path";
import { classifySubtitleCodec, getSubtitleExportExtension, SubtitleTrack } from "../core/video/SubtitleTrack";
import { ensureOutputDirectory, resolveConflictPath } from "./fileSystemService";
import { readSubtitleAsSrt, requireReadableSrt } from "./subtitleValidation";
import { extractSubtitleTrack, type SubtitleExtractionProgress } from "./subtitleExtractionService";

export interface SubtitleExportRequest {
  videoPath: string;
  track: SubtitleTrack;
  outputDirectory: string;
}

export interface SubtitleExportManyRequest {
  videoPath: string;
  tracks: SubtitleTrack[];
  outputDirectory: string;
}

export interface SubtitleExportResult {
  trackIndex: number;
  language: string;
  codecName: string;
  outputPath: string;
}

export interface SubtitleExportManyResult {
  exported: SubtitleExportResult[];
}

export async function exportSubtitleTrack(request: SubtitleExportRequest, signal?: AbortSignal, onProgress?: (progress: SubtitleExtractionProgress) => void): Promise<SubtitleExportResult> {
  const extension = getSubtitleExportExtension(request.track);
  if (!extension) {
    throw new Error(`Subtitle track ${request.track.index} with codec ${request.track.codecName} cannot be exported as a standalone file.`);
  }

  await ensureOutputDirectory(request.outputDirectory);
  const outputPath = await resolveConflictPath(
    join(request.outputDirectory, buildSubtitleExportFileName(request.videoPath, request.track, extension)),
    "versioned"
  );

  signal?.throwIfAborted();
  let content: string;
  if (classifySubtitleCodec(request.track.codecName).requiresOcr) {
    const extracted = await extractSubtitleTrack(request.videoPath, {
      ...request.track,
      ...classifySubtitleCodec(request.track.codecName)
    }, { signal, onProgress });
    signal?.throwIfAborted();
    content = extracted.content;
  } else {
    content = await readSubtitleAsSrt(request.videoPath, request.track.index, signal);
  }
  requireReadableSrt(content);
  signal?.throwIfAborted();
  const stagingDirectory = await mkdtemp(join(request.outputDirectory, ".subtitle-export-"));
  try {
    const stagedPath = join(stagingDirectory, "subtitle.srt");
    await writeFile(stagedPath, content, { encoding: "utf8", signal });
    signal?.throwIfAborted();
    // Publish the complete file without overwriting a concurrent export.
    await link(stagedPath, outputPath);
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }

  return {
    trackIndex: request.track.index,
    language: request.track.language,
    codecName: request.track.codecName,
    outputPath
  };
}

export async function exportSubtitleTracks(request: SubtitleExportManyRequest, signal?: AbortSignal, onProgress?: (progress: SubtitleExtractionProgress) => void): Promise<SubtitleExportManyResult> {
  const exported: SubtitleExportResult[] = [];
  for (const track of request.tracks) {
    if (!getSubtitleExportExtension(track)) {
      continue;
    }
    exported.push(await exportSubtitleTrack({ ...request, track }, signal, onProgress));
  }

  if (exported.length === 0) {
    throw new Error("No exportable subtitle tracks were found.");
  }

  return { exported };
}

function buildSubtitleExportFileName(videoPath: string, track: SubtitleTrack, extension: string): string {
  const parsed = parse(videoPath);
  const parts = [
    parsed.name,
    `track-${track.index}`,
    cleanFileNamePart(track.language || "und"),
    cleanFileNamePart(track.codecName),
    track.title ? cleanFileNamePart(track.title) : undefined
  ].filter(Boolean);

  return `${parts.join(".")}.${extension}`;
}

function cleanFileNamePart(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48)
    .toLowerCase() || "untitled";
}
