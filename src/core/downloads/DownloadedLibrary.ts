import type { MediaType } from "../discovery/DiscoveryTypes";
import type { DownloadLocation } from "./DownloadLocations";
import { parentDirectory } from "../util/paths";

export interface DownloadedLibraryFile {
  id: string;
  path: string;
  filename: string;
  sizeBytes: number;
  modifiedAt: string;
  downloadedAt: string;
  season?: number;
  episode?: number;
  processedDirectoryPath: string;
}

export interface DownloadedLibraryTitle {
  key: string;
  catalogId: string;
  imdbId?: string;
  mediaType: MediaType;
  title: string;
  releaseDate?: string;
  overview?: string;
  posterPath?: string;
  directoryPath: string;
  processedDirectoryPath: string;
  downloadedAt: string;
  totalBytes: number;
  files: DownloadedLibraryFile[];
  libraryLocationId?: string;
  libraryLocationLabel?: string;
}

export interface DownloadedLibrarySnapshot {
  rootDirectory: string;
  moviesDirectory: string;
  seriesDirectory: string;
  titles: DownloadedLibraryTitle[];
  scannedAt: string;
  locations?: DownloadLocation[];
}

export interface DeleteDownloadedFileRequest {
  libraryLocationId: string;
  titleKey: string;
  fileId: string;
}

export interface DownloadedWorkflowTarget {
  titleKey: string;
  title: string;
  scopeLabel: string;
  videoPaths: string[];
  sourceDirectory: string;
  outputDirectory: string;
}

export type DownloadedSeriesScope = "episode" | "season";

export interface DownloadedSelection {
  scope: DownloadedSeriesScope;
  /** Season number for series; -1 groups files without a season marker. */
  season?: number;
  fileId: string;
}

export function downloadedEpisodeLabel(file: DownloadedLibraryFile): string {
  if (file.season !== undefined && file.episode !== undefined) {
    return `S${String(file.season).padStart(2, "0")}E${String(file.episode).padStart(2, "0")}`;
  }
  return file.filename;
}

/** The files a workflow should process for the current Downloaded-page selection. */
export function buildDownloadedWorkflowTarget(
  title: DownloadedLibraryTitle,
  selection: DownloadedSelection
): DownloadedWorkflowTarget | undefined {
  const base = { titleKey: title.key, title: title.title };
  if (title.mediaType === "movie") {
    const file = title.files.find((item) => item.id === selection.fileId) ?? title.files[0];
    return file && {
      ...base,
      scopeLabel: "Movie",
      videoPaths: [file.path],
      sourceDirectory: title.directoryPath,
      outputDirectory: file.processedDirectoryPath
    };
  }

  const seasonFiles = title.files.filter((file) => (file.season ?? -1) === selection.season);
  if (selection.scope === "season") {
    // Prefer recognised episodes; fall back to every file when none carry an episode number.
    const episodes = seasonFiles.filter((file) => file.episode !== undefined);
    const files = episodes.length > 0 ? episodes : seasonFiles;
    if (files.length === 0 || selection.season === undefined) return undefined;
    return {
      ...base,
      scopeLabel: selection.season === -1 ? "Unsorted episodes" : `Season ${selection.season}`,
      videoPaths: files.map((file) => file.path),
      sourceDirectory: parentDirectory(files[0].path),
      outputDirectory: files[0].processedDirectoryPath
    };
  }

  const file = seasonFiles.find((item) => item.id === selection.fileId);
  return file && {
    ...base,
    scopeLabel: downloadedEpisodeLabel(file),
    videoPaths: [file.path],
    sourceDirectory: parentDirectory(file.path),
    outputDirectory: file.processedDirectoryPath
  };
}
