import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { access, link, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { DownloadProgress, RealDebridDownloadRequest } from "../core/discovery/DiscoveryTypes";
import { buildSanitizedMagnetUri } from "../core/discovery/MagnetLinks";
import { DownloadedLibraryService } from "./downloadedLibraryService";
import { isPathInside } from "./fsUtils";
import { errorMessage } from "../core/util/errors";

const VIDEO_EXTENSIONS = new Set([".mkv", ".mp4", ".mov", ".avi", ".webm"]);
const ENGINE = resolve(__dirname, "../../sidecars/libtorrent/engine.py");
const VENDOR = resolve(__dirname, "../../sidecars/libtorrent/vendor");

/**
 * Explains a worker failure caused by a missing or incompatible Python. The bundled libtorrent
 * binding is built for CPython 3.12 on 64-bit Windows.
 */
function missingPythonError(detail: string): Error | undefined {
  if (!/ENOENT|python not found|No module named ['"]?libtorrent|DLL load failed|cp312|Python was not found/i.test(detail)) {
    return undefined;
  }
  return new Error(
    "In-app torrent downloads need Python 3.12. Install it from python.org with \"Add python.exe to PATH\" ticked, "
    + "then restart SubsTranslate. To use another Python, set SUBSTRANSLATE_PYTHON to its path."
  );
}

interface TorrentFileInfo { index: number; path: string; length: number }
interface SeedFile { index: number; torrentPath: string; libraryPath: string }
interface SeedRecord { id: string; root: string; staging: string; torrentFile: string; files: SeedFile[] }
type WorkerMessage = { type: string; files?: TorrentFileInfo[]; infoHash?: string;
  receivedBytes?: number; totalBytes?: number; bytesPerSecond?: number; peers?: number; message?: string };

class TorrentWorker {
  readonly process: ChildProcessWithoutNullStreams;
  readonly done: Promise<void>;
  private readonly listeners = new Set<(message: WorkerMessage) => void>();
  private readonly errors: string[] = [];

  constructor(config: Record<string, unknown>) {
    this.process = spawn(process.env.SUBSTRANSLATE_PYTHON || "python", ["-u", ENGINE, JSON.stringify(config)], {
      cwd: resolve(__dirname, "../.."), env: { ...process.env, PYTHONPATH: VENDOR },
      stdio: "pipe", windowsHide: true
    });
    createInterface({ input: this.process.stdout }).on("line", (line) => {
      try {
        const message = JSON.parse(line) as WorkerMessage;
        if (message.type === "error" && message.message) this.errors.push(message.message);
        for (const listener of this.listeners) listener(message);
      } catch { /* Ignore malformed worker output. */ }
    });
    createInterface({ input: this.process.stderr }).on("line", (line) => {
      if (this.errors.length < 3) this.errors.push(line.slice(0, 300));
    });
    this.done = new Promise((resolveDone, rejectDone) => {
      this.process.once("error", (error) => rejectDone(missingPythonError(error.message) ?? error));
      this.process.once("close", (code) => {
        if (code === 0) return resolveDone();
        const detail = this.errors[0] || `libtorrent worker exited (${code ?? "unknown"}).`;
        // 9009 is Windows' "command not found", also returned by the Microsoft Store python alias.
        rejectDone(missingPythonError(code === 9009 ? "python not found" : detail) ?? new Error(detail));
      });
    });
  }

  send(message: Record<string, unknown>): void {
    if (!this.process.stdin.destroyed) this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  waitFor(type: string): Promise<WorkerMessage> {
    return new Promise((resolveDone, rejectDone) => {
      const onMessage = (message: WorkerMessage) => {
        if (message.type === "error") finish(new Error(message.message || "Torrent worker failed."));
        else if (message.type === type) finish(undefined, message);
      };
      const finish = (error?: Error, message?: WorkerMessage) => {
        this.listeners.delete(onMessage);
        if (error) rejectDone(error);
        else resolveDone(message!);
      };
      this.listeners.add(onMessage);
      void this.done.then(
        () => { if (this.listeners.has(onMessage)) finish(new Error("Torrent worker stopped unexpectedly.")); },
        (error) => { if (this.listeners.has(onMessage)) finish(error); }
      );
    });
  }

  onMessage(listener: (message: WorkerMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async stop(): Promise<void> {
    this.send({ type: "cancel" });
    await Promise.race([this.done.catch(() => undefined), new Promise<void>((resolveDone) => setTimeout(resolveDone, 3000))]);
    if (this.process.exitCode === null) this.process.kill();
    await this.done.catch(() => undefined);
  }
}

export class TorrentDownloadService {
  private active?: { worker: TorrentWorker; finished: Promise<string>; cancel: () => void };
  private seeding?: { worker: TorrentWorker; recordId: string };

  constructor(private readonly library: DownloadedLibraryService) {}

  async download(request: RealDebridDownloadRequest, root: string,
    onProgress: (progress: DownloadProgress) => void,
    onFileCompleted: (episode?: number) => Promise<void>): Promise<string> {
    if (this.active) throw new Error("Another in-app torrent download is already active.");
    await ensureEngine();
    const id = randomUUID();
    const staging = join(root, ".substranslate", "torrent-staging", id);
    const torrentFile = join(root, ".substranslate", "torrent-metadata", `${id}.torrent`);
    const filename = request.source.name.slice(0, 200) || "Torrent";
    let cancelled = false;
    await mkdir(staging, { recursive: true });
    await mkdir(join(root, ".substranslate", "torrent-metadata"), { recursive: true });
    const worker = new TorrentWorker({ mode: "download", magnet: buildSanitizedMagnetUri(request.source),
      infoHash: request.source.infoHash, staging, torrentFile });
    const finished = (async () => {
      let committed = false;
      let selected: TorrentFileInfo[];
      const startedAt = Date.now();
      try {
        onProgress({ id, method: "torrent", filename, receivedBytes: 0, status: "starting",
          message: "Connecting to peers and loading torrent files…" });
        const metadata = await worker.waitFor("metadata");
        if (cancelled) throw new Error("Download cancelled.");
        const files = metadata.files;
        if (!Array.isArray(files) || files.some((file) => !Number.isInteger(file.index)
          || !Number.isSafeInteger(file.length) || file.length < 0 || typeof file.path !== "string")) {
          throw new Error("Invalid torrent metadata.");
        }
        for (const file of files) safeTorrentFilePath(staging, file.path);
        selected = selectMediaFiles(files, request);
        const totalBytes = selected.reduce((sum, file) => sum + file.length, 0);
        const removeListener = worker.onMessage((message) => {
          if (message.type !== "progress") return;
          const receivedBytes = message.receivedBytes ?? 0;
          const bytesPerSecond = message.bytesPerSecond ?? 0;
          onProgress({ id, method: "torrent", filename, receivedBytes, totalBytes,
            percent: totalBytes > 0 ? Math.min(100, receivedBytes / totalBytes * 100) : 0,
            bytesPerSecond, elapsedSeconds: (Date.now() - startedAt) / 1000,
            estimatedRemainingSeconds: bytesPerSecond > 0 ? Math.max(0, (totalBytes - receivedBytes) / bytesPerSecond) : undefined,
            status: "downloading", message: `${message.peers ?? 0} peers` });
        });
        worker.send({ type: "select", indices: selected.map((file) => file.index) });
        try { await worker.waitFor("completed"); } finally { removeListener(); }
        await worker.done;
        if (cancelled) throw new Error("Download cancelled.");
        const record: SeedRecord = { id, root, staging, torrentFile, files: [] };
        let resultPath = "";
        for (const file of selected) {
          const episode = request.media.mediaType === "series"
            ? episodeFromTorrentPath(file.path)?.episode ?? request.episode : undefined;
          if (request.media.mediaType === "series" && episode === undefined) {
            throw new Error(`Could not identify the episode number for ${basename(file.path)}.`);
          }
          const sourcePath = safeTorrentFilePath(staging, file.path);
          const plan = await this.library.planDownload(root, request.media, basename(file.path), request.season, episode);
          await link(sourcePath, plan.outputPath);
          record.files.push({ index: file.index, torrentPath: file.path, libraryPath: plan.outputPath });
          await this.library.recordCompletedDownload(root, request.media, plan);
          await onFileCompleted(episode);
          resultPath = selected.length > 1 ? plan.directoryPath : plan.outputPath;
        }
        await addSeedRecord(root, record);
        committed = true;
        onProgress({ id, method: "torrent", filename, receivedBytes: totalBytes, totalBytes,
          percent: 100, elapsedSeconds: (Date.now() - startedAt) / 1000,
          status: "completed", outputPath: resultPath });
        return resultPath;
      } catch (error) {
        onProgress({ id, method: "torrent", filename, receivedBytes: 0,
          status: cancelled ? "cancelled" : "failed",
          message: cancelled ? "Download cancelled." : safeErrorMessage(error) });
        throw cancelled ? new Error("Download cancelled.") : error;
      } finally {
        await worker.stop();
        if (!committed) {
          await rm(staging, { recursive: true, force: true }).catch(() => undefined);
          await rm(torrentFile, { force: true }).catch(() => undefined);
        }
      }
    })();
    this.active = { worker, finished, cancel: () => { cancelled = true; } };
    try { return await finished; } finally { if (this.active?.finished === finished) this.active = undefined; }
  }

  async cancel(): Promise<void> {
    const active = this.active;
    if (!active) return;
    active.cancel();
    await active.worker.stop();
    await active.finished.catch(() => undefined);
  }

  shutdown(): void {
    this.active?.worker.process.kill();
    this.seeding?.worker.process.kill();
  }

  async seedStatus(root: string, libraryPath: string): Promise<"unavailable" | "stopped" | "seeding"> {
    const record = (await readSeedRecords(root)).find((item) => item.files.some((file) =>
      file.libraryPath.toLowerCase() === libraryPath.toLowerCase()));
    if (!record || !(await sameLinkedFiles(record))) return "unavailable";
    return this.seeding?.recordId === record.id ? "seeding" : "stopped";
  }

  async startSeeding(root: string, libraryPath: string): Promise<void> {
    if (this.seeding) throw new Error("Another torrent is already seeding. Stop it first.");
    await ensureEngine();
    const record = (await readSeedRecords(root)).find((item) => item.files.some((file) =>
      file.libraryPath.toLowerCase() === libraryPath.toLowerCase()));
    if (!record || !(await sameLinkedFiles(record))) {
      throw new Error("The original torrent data is unavailable or has changed.");
    }
    const worker = new TorrentWorker({ mode: "seed", staging: record.staging,
      torrentFile: record.torrentFile, indices: record.files.map((file) => file.index) });
    this.seeding = { worker, recordId: record.id };
    try {
      await worker.waitFor("seeding");
      void worker.done.catch(() => undefined).finally(() => {
        if (this.seeding?.worker === worker) this.seeding = undefined;
      });
    } catch (error) {
      await worker.stop();
      if (this.seeding?.worker === worker) this.seeding = undefined;
      throw error;
    }
  }

  async stopSeeding(): Promise<void> {
    const active = this.seeding;
    if (!active) return;
    await active.worker.stop();
    if (this.seeding === active) this.seeding = undefined;
  }

  async forgetFile(root: string, libraryPath: string): Promise<void> {
    const records = await readSeedRecords(root);
    const record = records.find((item) => item.files.some((file) =>
      file.libraryPath.toLowerCase() === libraryPath.toLowerCase()));
    if (!record) return;
    if (this.seeding?.recordId === record.id) await this.stopSeeding();
    const file = record.files.find((item) => item.libraryPath.toLowerCase() === libraryPath.toLowerCase())!;
    await rm(safeTorrentFilePath(record.staging, file.torrentPath), { force: true });
    record.files = record.files.filter((item) => item !== file);
    if (record.files.length === 0) {
      await rm(record.staging, { recursive: true, force: true });
      await rm(record.torrentFile, { force: true });
    }
    await writeSeedRecords(root, records.filter((item) => item.files.length > 0));
  }
}

function selectMediaFiles(files: TorrentFileInfo[], request: RealDebridDownloadRequest): TorrentFileInfo[] {
  const rawIndices = request.source.selectedFileIndices
    ?? (request.source.fileIndex === undefined ? undefined : [request.source.fileIndex]);
  if (rawIndices && (rawIndices.length === 0 || rawIndices.length > 1000
    || rawIndices.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= files.length))) {
    throw new Error("The selected torrent file is missing from the torrent metadata.");
  }
  const requestedIndices = rawIndices ? [...new Set(rawIndices)] : undefined;
  const candidates = (requestedIndices ? requestedIndices.map((index) => files[index]) : files)
    .filter((file) => VIDEO_EXTENSIONS.has(extname(file.path).toLowerCase()));
  if (candidates.length === 0) throw new Error("The torrent has no selected video file.");
  if (request.media.mediaType === "movie") {
    if (requestedIndices?.length && requestedIndices.length !== 1) throw new Error("Select one movie file from this torrent.");
    return [requestedIndices ? candidates[0] : [...candidates].sort((a, b) => b.length - a.length)[0]];
  }
  const season = request.season;
  if (!Number.isInteger(season) || season! < 0) throw new Error("Choose a valid TV season.");
  if (request.episode !== undefined) {
    const matching = candidates.filter((file) => {
      const parsed = episodeFromTorrentPath(file.path);
      return parsed ? parsed.season === season && parsed.episode === request.episode : Boolean(requestedIndices);
    });
    if (matching.length === 0) throw new Error("Could not match one video file to the selected episode.");
    return [[...matching].sort((a, b) => b.length - a.length)[0]];
  }
  const requestedEpisodes = request.episodes?.length ? new Set(request.episodes) : undefined;
  const matchingByEpisode = new Map<number, TorrentFileInfo>();
  for (const file of candidates) {
    const parsed = episodeFromTorrentPath(file.path);
    if (!parsed || parsed.season !== season || (requestedEpisodes && !requestedEpisodes.has(parsed.episode))) continue;
    const previous = matchingByEpisode.get(parsed.episode);
    if (!previous || file.length > previous.length) matchingByEpisode.set(parsed.episode, file);
  }
  const matching = [...matchingByEpisode.entries()].sort(([a], [b]) => a - b).map(([, file]) => file);
  if (matching.length === 0 || (requestedEpisodes && [...requestedEpisodes].some((episode) => !matchingByEpisode.has(episode)))) {
    throw new Error("The torrent does not contain every selected episode as an identifiable video file.");
  }
  return matching;
}

function episodeFromTorrentPath(path: string): { season: number; episode: number } | undefined {
  const match = /(?:^|[.\s_\-/])S(\d{1,3})E(\d{1,4})(?:[.\s_\-/]|$)/i.exec(path)
    ?? /(?:^|[.\s_\-/])(\d{1,3})x(\d{1,4})(?:[.\s_\-/]|$)/i.exec(path);
  if (match) return { season: Number(match[1]), episode: Number(match[2]) };
  const season = /(?:^|[/\\])(?:Season[.\s_-]*|S)(\d{1,3})(?:[/\\]|$)/i.exec(path);
  const episode = /(?:^|[.\s_\-/])(?:Episode|Ep|E)[.\s_-]?(\d{1,4})(?:[.\s_\-/]|$)/i.exec(path);
  return season && episode ? { season: Number(season[1]), episode: Number(episode[1]) } : undefined;
}

function safeTorrentFilePath(staging: string, torrentPath: string): string {
  if (!torrentPath || isAbsolute(torrentPath) || /[\r\n\0]/.test(torrentPath)) throw new Error("The torrent contains an unsafe file path.");
  const path = resolve(staging, torrentPath);
  const inside = relative(staging, path);
  if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside) || basename(path) !== basename(torrentPath)) {
    throw new Error("The torrent contains an unsafe file path.");
  }
  return path;
}

async function ensureEngine(): Promise<void> {
  await access(ENGINE);
  try { await access(join(VENDOR, "libtorrent")); }
  catch { throw new Error("libtorrent is not installed. Run npm run setup:torrent once, then retry."); }
}

function seedIndex(root: string): string { return join(root, ".substranslate", "torrent-seeds.json"); }

async function readSeedRecords(root: string): Promise<SeedRecord[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(seedIndex(root), "utf8"));
    return Array.isArray(parsed) ? parsed.filter((item): item is SeedRecord => {
      if (!item || typeof item.id !== "string" || item.root !== root
        || !isStringPathInside(join(root, ".substranslate", "torrent-staging"), item.staging)
        || !isStringPathInside(join(root, ".substranslate", "torrent-metadata"), item.torrentFile)
        || !Array.isArray(item.files) || item.files.length === 0) return false;
      return item.files.every((file: SeedFile) => {
        try {
          return Number.isInteger(file.index)
            && (isStringPathInside(join(root, "Movies"), file.libraryPath)
              || isStringPathInside(join(root, "TV Shows"), file.libraryPath))
            && Boolean(safeTorrentFilePath(item.staging, file.torrentPath));
        } catch { return false; }
      });
    }) : [];
  } catch { return []; }
}

function isStringPathInside(parent: string, candidate: unknown): candidate is string {
  return typeof candidate === "string" && isPathInside(parent, candidate);
}

async function writeSeedRecords(root: string, records: SeedRecord[]): Promise<void> {
  const path = seedIndex(root);
  await mkdir(join(root, ".substranslate"), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(records), "utf8");
  await rename(temporary, path);
}

async function addSeedRecord(root: string, record: SeedRecord): Promise<void> {
  await writeSeedRecords(root, [...await readSeedRecords(root), record]);
}

async function sameLinkedFiles(record: SeedRecord): Promise<boolean> {
  try {
    await access(record.torrentFile);
    for (const file of record.files) {
      const source = await stat(safeTorrentFilePath(record.staging, file.torrentPath));
      const library = await stat(file.libraryPath);
      if (source.dev !== library.dev || source.ino !== library.ino || source.size !== library.size) return false;
    }
    return record.files.length > 0;
  } catch { return false; }
}

function safeErrorMessage(error: unknown): string {
  return errorMessage(error)
    .replace(/magnet:\?\S+/gi, "[torrent source]")
    .replace(/https?:\/\/\S+/gi, "[tracker]")
    .replace(/[\r\n\0]+/g, " ").slice(0, 400);
}
