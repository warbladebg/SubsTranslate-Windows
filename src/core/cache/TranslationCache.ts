import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { TranslationResult } from "../translation/TranslationProvider";

export interface CacheKeyInput {
  subtitleFileHash: string;
  cueIds: number[];
  originalCueTextHash: string;
  targetLanguage: string;
  modelId: string;
  translationSettingsHash: string;
  promptVersion: string;
}

export interface CacheValue {
  result: TranslationResult;
  timestamp: string;
  provider: string;
  model: string;
  appVersion: string;
}

/**
 * Chunk translations keyed by content, persisted as one JSON file.
 * The file grows with every translated chunk, so writes are compact and coalesced:
 * every set() made while a write is running shares the next write.
 */
export class TranslationCache {
  private cachePromise?: Promise<Record<string, CacheValue>>;
  private currentWrite: Promise<void> = Promise.resolve();
  private nextWrite?: Promise<void>;

  constructor(private readonly cacheFilePath: string) {}

  async get(key: string): Promise<CacheValue | undefined> {
    const cache = await this.readCache();
    return cache[key];
  }

  /** Resolves once the value is durably on disk. */
  async set(key: string, value: CacheValue): Promise<void> {
    const cache = await this.readCache();
    cache[key] = value;
    return this.scheduleWrite();
  }

  private scheduleWrite(): Promise<void> {
    this.nextWrite ??= this.currentWrite.catch(() => undefined).then(() => {
      this.nextWrite = undefined;
      this.currentWrite = this.writeSnapshot();
      return this.currentWrite;
    });
    return this.nextWrite;
  }

  private async writeSnapshot(): Promise<void> {
    const contents = JSON.stringify(await this.readCache());
    await mkdir(dirname(this.cacheFilePath), { recursive: true });
    const tempPath = `${this.cacheFilePath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await writeFile(tempPath, contents, "utf8");
    await rename(tempPath, this.cacheFilePath);
  }

  private async readCache(): Promise<Record<string, CacheValue>> {
    this.cachePromise ??= this.loadCache();
    return this.cachePromise;
  }

  private async loadCache(): Promise<Record<string, CacheValue>> {
    try {
      return JSON.parse(await readFile(this.cacheFilePath, "utf8")) as Record<string, CacheValue>;
    } catch {
      return {};
    }
  }
}

export function createCacheKey(input: CacheKeyInput): string {
  return hashStable(input);
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function hashStable(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
