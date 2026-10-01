import { KeyedTaskQueue } from "../core/async/KeyedTaskQueue";
import { mapWithConcurrency } from "../core/async/mapWithConcurrency";
import { app } from "electron";
import { mkdir, readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, parse, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { CatalogDetails, MediaType } from "../core/discovery/DiscoveryTypes";
import type {
  DownloadedLibraryFile,
  DownloadedLibrarySnapshot,
  DownloadedLibraryTitle
} from "../core/downloads/DownloadedLibrary";
import { readJsonWithBackup, replaceJsonWithBackup } from "./durableFileStore";
import { isPathInside, pathExists } from "./fsUtils";

const VIDEO_EXTENSIONS = new Set([".mkv", ".mp4", ".mov", ".avi", ".webm"]);
const INDEX_DIRECTORY = ".substranslate";
const INDEX_FILENAME = "library.json";
const TITLE_HYDRATION_CONCURRENCY = 4;
const FILE_HYDRATION_CONCURRENCY = 16;

// library.json keeps only these fields; sizes and processed-output paths are derived on read.
type StoredDownloadedFile = Pick<DownloadedLibraryFile, "id" | "path" | "downloadedAt" | "season" | "episode">;

type StoredDownloadedTitle = Pick<
  DownloadedLibraryTitle,
  "key" | "catalogId" | "imdbId" | "mediaType" | "title" | "releaseDate" | "overview" | "posterPath" | "directoryPath" | "downloadedAt"
> & { files: StoredDownloadedFile[] };

interface DownloadedLibraryStore {
  version: 1;
  titles: StoredDownloadedTitle[];
}

export interface ManagedDownloadPlan {
  outputPath: string;
  filename: string;
  directoryPath: string;
  season?: number;
  episode?: number;
}

export class DownloadedLibraryService {
  private readonly operations = new KeyedTaskQueue();

  async recordCompletedDownload(rootDirectory: string, media: CatalogDetails, plan: ManagedDownloadPlan): Promise<void> {
    const root = validateRootDirectory(rootDirectory);
    return this.operations.run(normalizePath(resolve(root)), () => this.recordDownloadAtRoot(root, media, plan));
  }

  async getLibrary(rootDirectory?: string): Promise<DownloadedLibrarySnapshot> {
    const root = validateRootDirectory(rootDirectory || app.getPath("downloads"));
    return this.operations.run(normalizePath(resolve(root)), () => this.readLibraryAtRoot(root));
  }

  async rescan(rootDirectory?: string): Promise<DownloadedLibrarySnapshot> {
    const root = validateRootDirectory(rootDirectory || app.getPath("downloads"));
    return this.operations.run(normalizePath(resolve(root)), () => this.rescanAtRoot(root));
  }

  async deleteFile(rootDirectory: string, titleKeyValue: string, fileId: string, moveToTrash: (path: string) => Promise<void>): Promise<void> {
    const root = validateRootDirectory(rootDirectory);
    return this.operations.run(normalizePath(resolve(root)), () => this.deleteFileAtRoot(root, titleKeyValue, fileId, moveToTrash));
  }

  async ensureStructure(rootDirectory: string): Promise<void> {
    const root = validateRootDirectory(rootDirectory);
    await Promise.all([
      mkdir(join(root, "Movies"), { recursive: true }),
      mkdir(join(root, "TV Shows"), { recursive: true }),
      mkdir(join(root, INDEX_DIRECTORY), { recursive: true })
    ]);
  }

  async planDownload(
    rootDirectory: string,
    media: CatalogDetails,
    resolvedFilename: string,
    season?: number,
    episode?: number
  ): Promise<ManagedDownloadPlan> {
    const root = validateRootDirectory(rootDirectory);
    validateMediaScope(media.mediaType, season, episode);
    await this.ensureStructure(root);

    const titleDirectory = join(
      root,
      media.mediaType === "movie" ? "Movies" : "TV Shows",
      titleFolderName(media)
    );
    const directoryPath = media.mediaType === "series"
      ? join(titleDirectory, `Season ${padNumber(season!)}`)
      : titleDirectory;
    await mkdir(directoryPath, { recursive: true });

    const filename = sanitizeFilename(resolvedFilename, media, season, episode);
    const outputPath = await availableOutputPath(join(directoryPath, filename));
    return {
      outputPath,
      filename: basename(outputPath),
      directoryPath,
      season,
      episode
    };
  }

  private async recordDownloadAtRoot(
    rootDirectory: string,
    media: CatalogDetails,
    plan: ManagedDownloadPlan
  ): Promise<void> {
    const root = validateRootDirectory(rootDirectory);
    const store = await this.readStore(root);
    const now = new Date().toISOString();
    const key = titleKey(media.mediaType, media.imdbId ?? media.id);
    const existing = store.titles.find((title) => title.key === key);
    const file: StoredDownloadedFile = {
      id: randomUUID(),
      path: plan.outputPath,
      downloadedAt: now,
      season: plan.season,
      episode: plan.episode
    };
    const title: StoredDownloadedTitle = {
      key,
      catalogId: media.id,
      imdbId: media.imdbId,
      mediaType: media.mediaType,
      title: media.title,
      releaseDate: media.releaseDate,
      overview: media.overview,
      posterPath: media.posterPath,
      directoryPath: media.mediaType === "series" ? dirname(plan.directoryPath) : plan.directoryPath,
      downloadedAt: existing?.downloadedAt ?? now,
      files: [
        ...(existing?.files.filter((item) => item.path.toLocaleLowerCase() !== plan.outputPath.toLocaleLowerCase()) ?? []),
        file
      ]
    };
    store.titles = existing
      ? store.titles.map((item) => item.key === key ? title : item)
      : [...store.titles, title];
    await this.writeStore(root, store);
  }

  private async readLibraryAtRoot(rootDirectory?: string): Promise<DownloadedLibrarySnapshot> {
    const root = validateRootDirectory(rootDirectory || app.getPath("downloads"));
    await this.ensureStructure(root);
    const store = await this.readStore(root);
    const hydrated = await mapWithConcurrency(store.titles, TITLE_HYDRATION_CONCURRENCY, hydrateTitle);
    const titles = hydrated.filter((title): title is DownloadedLibraryTitle => Boolean(title))
      .sort((left, right) => right.downloadedAt.localeCompare(left.downloadedAt));
    const reconciled = store.titles.flatMap((title, index) => {
      const available = hydrated[index];
      if (!available) return [];
      const fileIds = new Set(available.files.map((file) => file.id));
      return [{ ...title, files: title.files.filter((file) => fileIds.has(file.id)) }];
    });
    if (reconciled.length !== store.titles.length
      || reconciled.some((title, index) => title.files.length !== store.titles[index].files.length)) {
      await this.writeStore(root, { version: 1, titles: reconciled });
    }
    return {
      rootDirectory: root,
      moviesDirectory: join(root, "Movies"),
      seriesDirectory: join(root, "TV Shows"),
      titles,
      scannedAt: new Date().toISOString()
    };
  }

  private async rescanAtRoot(rootDirectory?: string): Promise<DownloadedLibrarySnapshot> {
    const root = validateRootDirectory(rootDirectory || app.getPath("downloads"));
    await this.ensureStructure(root);
    const current = await this.readStore(root);
    const discovered = await discoverManagedTitles(root);
    const currentByDirectory = new Map(
      current.titles.map((title) => [normalizePath(title.directoryPath), title])
    );

    const titles = discovered.map((found) => {
      const existing = currentByDirectory.get(normalizePath(found.directoryPath));
      const existingFiles = new Map(
        (existing?.files ?? []).map((file) => [normalizePath(file.path), file])
      );
      return {
        ...found,
        key: existing?.key ?? found.key,
        catalogId: existing?.catalogId ?? found.catalogId,
        imdbId: existing?.imdbId ?? found.imdbId,
        title: existing?.title ?? found.title,
        releaseDate: existing?.releaseDate ?? found.releaseDate,
        overview: existing?.overview,
        posterPath: existing?.posterPath,
        downloadedAt: existing?.downloadedAt ?? found.downloadedAt,
        files: found.files.map((file) => ({
          ...file,
          id: existingFiles.get(normalizePath(file.path))?.id ?? file.id,
          downloadedAt: existingFiles.get(normalizePath(file.path))?.downloadedAt ?? file.downloadedAt
        }))
      };
    });
    const next = { version: 1 as const, titles };
    await this.writeStore(root, next);
    return this.readLibraryAtRoot(root);
  }

  private async deleteFileAtRoot(
    rootDirectory: string,
    titleKeyValue: string,
    fileId: string,
    moveToTrash: (path: string) => Promise<void>
  ): Promise<void> {
    const root = validateRootDirectory(rootDirectory);
    const titleKey = validateStoreIdentifier(titleKeyValue, "downloaded title");
    const normalizedFileId = validateStoreIdentifier(fileId, "downloaded file");
    const store = await this.readStore(root);
    const title = store.titles.find((item) => item.key === titleKey);
    const file = title?.files.find((item) => item.id === normalizedFileId);
    if (!title || !file) {
      throw new Error("The selected downloaded file is no longer in the library.");
    }

    const filePath = resolve(file.path);
    if (
      !VIDEO_EXTENSIONS.has(extname(filePath).toLowerCase())
      || (!isPathInside(join(root, "Movies"), filePath) && !isPathInside(join(root, "TV Shows"), filePath))
    ) {
      throw new Error("The selected file is outside the managed downloads library.");
    }

    await moveToTrash(filePath);
    const remainingFiles = title.files.filter((item) => item.id !== normalizedFileId);
    store.titles = remainingFiles.length > 0
      ? store.titles.map((item) => item.key === titleKey ? { ...item, files: remainingFiles } : item)
      : store.titles.filter((item) => item.key !== titleKey);
    await this.writeStore(root, store);
  }

  private async readStore(root: string): Promise<DownloadedLibraryStore> {
    return (await readJsonWithBackup(indexPath(root), normalizeStore)) ?? { version: 1, titles: [] };
  }

  private async writeStore(root: string, store: DownloadedLibraryStore): Promise<void> {
    await replaceJsonWithBackup(indexPath(root), store);
  }
}

/** Accept a renderer-supplied path only when it is a file the library tracks. */
export function isDownloadedLibraryFile(titles: DownloadedLibraryTitle[], candidate: unknown): boolean {
  if (typeof candidate !== "string" || !candidate.trim() || !isAbsolute(candidate)) {
    return false;
  }
  const target = normalizePath(resolve(candidate));
  return titles.some((title) => title.files.some((file) => normalizePath(resolve(file.path)) === target));
}

function validateRootDirectory(value: string): string {
  const root = value?.trim();
  if (!root || /[\r\n\0]/.test(root)) {
    throw new Error("Invalid downloads library folder.");
  }
  return root;
}

function validateStoreIdentifier(value: string, label: string): string {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 200 || /[\r\n\0]/.test(normalized)) {
    throw new Error(`Invalid ${label} identifier.`);
  }
  return normalized;
}

function validateMediaScope(mediaType: MediaType, season?: number, episode?: number): void {
  if (mediaType === "movie") {
    return;
  }
  if (!Number.isInteger(season) || season! < 0 || !Number.isInteger(episode) || episode! < 1) {
    throw new Error("A TV download must include a valid season and episode.");
  }
}

function titleFolderName(media: CatalogDetails): string {
  const year = /^\d{4}/.exec(media.releaseDate ?? "")?.[0];
  const identifier = sanitizePathSegment(media.imdbId ?? media.id, "unknown-id");
  const title = sanitizePathSegment(media.title, "Untitled");
  return `${title}${year ? ` (${year})` : ""} [${identifier}]`;
}

function sanitizeFilename(
  resolvedFilename: string,
  media: CatalogDetails,
  season?: number,
  episode?: number
): string {
  const parsed = parse(basename(resolvedFilename));
  const extension = VIDEO_EXTENSIONS.has(parsed.ext.toLocaleLowerCase()) ? parsed.ext.toLocaleLowerCase() : ".mkv";
  const fallbackStem = media.mediaType === "series"
    ? `${media.title} - S${padNumber(season!)}E${padNumber(episode!)}`
    : media.title;
  const normalizedEpisodeToken = media.mediaType === "series"
    ? `S${padNumber(season!)}E${padNumber(episode!)}`
    : undefined;
  const sourceStem = parsed.name || fallbackStem;
  const stemWithEpisode = normalizedEpisodeToken
    && !new RegExp(`S0*${season}E0*${episode}(?:\\D|$)`, "i").test(sourceStem)
      ? `${fallbackStem} - ${sourceStem}`
      : sourceStem;
  const stem = sanitizePathSegment(stemWithEpisode, sanitizePathSegment(fallbackStem, "Download"));
  return `${stem}${extension}`;
}

function sanitizePathSegment(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 120);
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned);
  return cleaned && !reserved ? cleaned : fallback;
}

async function availableOutputPath(requestedPath: string): Promise<string> {
  if (!await pathExists(requestedPath)) {
    return requestedPath;
  }
  const parsed = parse(requestedPath);
  for (let version = 2; version <= 999; version += 1) {
    const candidate = join(parsed.dir, `${parsed.name} (${version})${parsed.ext}`);
    if (!await pathExists(candidate)) {
      return candidate;
    }
  }
  throw new Error("Could not create a unique filename for this download.");
}

async function hydrateTitle(title: StoredDownloadedTitle): Promise<DownloadedLibraryTitle | undefined> {
  const files = (await mapWithConcurrency(title.files, FILE_HYDRATION_CONCURRENCY, async (file): Promise<DownloadedLibraryFile | undefined> => {
    try {
      const fileStat = await stat(file.path);
      if (!fileStat.isFile()) return undefined;
      const processedDirectoryPath = file.season === undefined
        ? join(title.directoryPath, "Processed")
        : join(title.directoryPath, "Processed", `Season ${padNumber(file.season)}`);
      return {
        ...file,
        filename: basename(file.path),
        sizeBytes: fileStat.size,
        modifiedAt: fileStat.mtime.toISOString(),
        processedDirectoryPath
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ENOTDIR") {
        return undefined;
      }
      throw error;
    }
  })).filter((file): file is DownloadedLibraryFile => Boolean(file));
  if (files.length === 0) {
    return undefined;
  }
  return {
    ...title,
    processedDirectoryPath: join(title.directoryPath, "Processed"),
    totalBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
    files: files.sort(compareDownloadedFiles)
  };
}

async function discoverManagedTitles(root: string): Promise<StoredDownloadedTitle[]> {
  return [
    ...await discoverTitleDirectories(join(root, "Movies"), "movie"),
    ...await discoverTitleDirectories(join(root, "TV Shows"), "series")
  ];
}

async function discoverTitleDirectories(parent: string, mediaType: MediaType): Promise<StoredDownloadedTitle[]> {
  const entries = await safeReadDirectory(parent);
  const titles: StoredDownloadedTitle[] = [];
  for (const entry of entries.filter((item) => item.isDirectory() && item.name !== "Processed")) {
    const directoryPath = join(parent, entry.name);
    const parsed = parseManagedTitleFolder(entry.name);
    const fileRecords = mediaType === "movie"
      ? await discoverVideoFiles(directoryPath)
      : await discoverVideoFiles(directoryPath, undefined, true);
    if (fileRecords.length === 0) {
      continue;
    }
    const downloadedAt = fileRecords
      .map((file) => file.downloadedAt)
      .sort()
      .at(0) ?? new Date().toISOString();
    titles.push({
      key: titleKey(mediaType, parsed.identifier),
      catalogId: parsed.identifier,
      imdbId: /^tt\d+$/i.test(parsed.identifier) ? parsed.identifier : undefined,
      mediaType,
      title: parsed.title,
      releaseDate: parsed.year ? `${parsed.year}-01-01` : undefined,
      directoryPath,
      downloadedAt,
      files: fileRecords
    });
  }
  return titles;
}

async function discoverVideoFiles(
  directoryPath: string,
  season?: number,
  isSeries = false,
  depth = 0
): Promise<StoredDownloadedFile[]> {
  const entries = await safeReadDirectory(directoryPath);
  const files: StoredDownloadedFile[] = [];
  for (const entry of entries.filter((item) => item.isFile() && VIDEO_EXTENSIONS.has(extname(item.name).toLocaleLowerCase()))) {
    const path = join(directoryPath, entry.name);
    let fileStat;
    try {
      fileStat = await stat(path);
    } catch {
      // A download can disappear between listing the directory and reading its metadata.
      continue;
    }
    const episodeMatch = isSeries
      ? /(?:^|[.\s_-])S(\d{1,3})E(\d{1,4})(?:[.\s_-]|$)/i.exec(entry.name)
        ?? /(?:^|[.\s_-])(\d{1,3})x(\d{1,4})(?:[.\s_-]|$)/i.exec(entry.name)
      : null;
    const inferredSeason = episodeMatch ? Number(episodeMatch[1]) : season;
    const episodeOnlyMatch = isSeries && season !== undefined
      ? /(?:^|[.\s_-])(?:Episode|Ep|E)[.\s_-]?(\d{1,4})(?:[.\s_-]|$)/i.exec(entry.name)
      : null;
    const inferredEpisode = episodeMatch
      ? Number(episodeMatch[2])
      : episodeOnlyMatch ? Number(episodeOnlyMatch[1]) : undefined;
    files.push({
      id: randomUUID(),
      path,
      downloadedAt: fileStat.birthtime.toISOString(),
      season: inferredSeason,
      episode: inferredEpisode
    });
  }
  if (depth < 6) {
    for (const entry of entries.filter((item) => item.isDirectory() && !/^(?:Processed|Sample|Samples)$/i.test(item.name))) {
      const nestedSeason = isSeries ? parseSeasonFolder(entry.name) ?? season : undefined;
      files.push(...await discoverVideoFiles(join(directoryPath, entry.name), nestedSeason, isSeries, depth + 1));
    }
  }
  return files;
}

function parseSeasonFolder(name: string): number | undefined {
  const match = /^(?:Season[.\s_-]*|S)(\d{1,3})$/i.exec(name);
  return match ? Number(match[1]) : undefined;
}

function parseManagedTitleFolder(folderName: string): { title: string; year?: string; identifier: string } {
  const match = /^(.*?)\s*(?:\((\d{4})\))?\s*\[([^\]]+)\]$/.exec(folderName);
  if (!match) {
    const yearMatch = /^(.*?)(?:[.\s_-]+|\s*\()(19\d{2}|20\d{2})(?:\)|[.\s_-]|$)/.exec(folderName);
    const title = (yearMatch?.[1] ?? folderName).replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
    return {
      title: title || folderName,
      year: yearMatch?.[2],
      identifier: `local-${stableLocalId(folderName)}`
    };
  }
  return {
    title: match[1].trim() || folderName,
    year: match[2],
    identifier: match[3].trim()
  };
}

function stableLocalId(value: string): string {
  let hash = 2166136261;
  for (const character of value.toLocaleLowerCase()) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function normalizeStore(value: unknown): DownloadedLibraryStore {
  const parsed = value && typeof value === "object" ? value as Partial<DownloadedLibraryStore> : {};
  const titles = Array.isArray(parsed.titles)
    ? parsed.titles.slice(0, 5_000).flatMap((title) => normalizeStoredTitle(title))
    : [];
  return { version: 1, titles };
}

function normalizeStoredTitle(value: unknown): StoredDownloadedTitle[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  const title = value as Partial<StoredDownloadedTitle>;
  if (
    !title.key || !title.catalogId || !title.title || !title.directoryPath || !title.downloadedAt
    || !["movie", "series"].includes(title.mediaType ?? "") || !Array.isArray(title.files)
  ) {
    return [];
  }
  const files = title.files.slice(0, 10_000).flatMap((file): StoredDownloadedFile[] => {
    if (!file || typeof file !== "object") return [];
    const candidate = file as Partial<StoredDownloadedFile>;
    if (!candidate.id || !candidate.path || !candidate.downloadedAt) return [];
    return [{
      id: candidate.id,
      path: candidate.path,
      downloadedAt: candidate.downloadedAt,
      season: validOptionalInteger(candidate.season),
      episode: validOptionalInteger(candidate.episode)
    }];
  });
  if (files.length === 0) {
    return [];
  }
  return [{
    key: title.key,
    catalogId: title.catalogId,
    imdbId: title.imdbId,
    mediaType: title.mediaType as MediaType,
    title: title.title,
    releaseDate: title.releaseDate,
    overview: title.overview,
    posterPath: title.posterPath,
    directoryPath: title.directoryPath,
    downloadedAt: title.downloadedAt,
    files
  }];
}

function validOptionalInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

function titleKey(mediaType: MediaType, identifier: string): string {
  return `${mediaType}:${identifier.toLocaleLowerCase()}`;
}

function indexPath(root: string): string {
  return join(root, INDEX_DIRECTORY, INDEX_FILENAME);
}

function normalizePath(value: string): string {
  return value.replace(/[\\/]+/g, "\\").toLocaleLowerCase();
}

function padNumber(value: number): string {
  return String(value).padStart(2, "0");
}

function compareDownloadedFiles(left: DownloadedLibraryFile, right: DownloadedLibraryFile): number {
  return (left.season ?? -1) - (right.season ?? -1)
    || (left.episode ?? -1) - (right.episode ?? -1)
    || left.filename.localeCompare(right.filename);
}

async function safeReadDirectory(path: string) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}
