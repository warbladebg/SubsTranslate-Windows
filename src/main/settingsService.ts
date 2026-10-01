import { app, safeStorage } from "electron";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { OtherDebridProvider } from "../core/discovery/DiscoveryTypes";
import { readJsonWithBackup, replaceJsonWithBackup } from "./durableFileStore";
import type { TranslationQuality } from "../core/translation/TranslationQualityProfile";
export type { TranslationQuality } from "../core/translation/TranslationQualityProfile";

export type TranslationProviderId = "mock" | "gemini" | "vercel";
export type ContextMode = "auto" | "minimal" | "larger";
export type RateLimitMode = "auto-safe" | "manual" | "aggressive";

export interface ManualRateLimits {
  rpmLimit: number;
  tpmLimit: number;
  rpdLimit: number;
  stopAfterDailyPercentage: number;
  maxConcurrentRequests: number;
}

export interface AppSettings {
  targetLanguage: string;
  targetLanguageCode: string;
  providerId: TranslationProviderId;
  quality: TranslationQuality;
  contextMode: ContextMode;
  outputConflictMode: "overwrite" | "versioned" | "cancel";
  batchUnlocked: boolean;
  gemini: {
    modelId: string;
    thinkingLevel: "auto" | "minimal" | "low" | "medium" | "high";
    qualityTuningVersion?: number;
    temperature: number;
    maxOutputTokens: number;
    useStructuredJson: boolean;
    apiSurface: "models.generateContent";
    rateLimitMode: RateLimitMode;
    manualRateLimits: ManualRateLimits;
  };
  vercel: {
    modelId: string;
    temperature: number;
    maxOutputTokens: number;
    apiSurface: "openai.chat.completions";
    rateLimitMode: RateLimitMode;
    manualRateLimits: ManualRateLimits;
  };
}

const GEMINI_DEFAULT_MODEL_ID = "gemini-3.1-flash-lite";
const PREVIOUS_GEMINI_DEFAULT_MODEL_IDS = new Set([
  "gemini-3.5-flash-lite",
  "gemini-3-flash-preview"
]);
const VERCEL_DEFAULT_MODEL_ID = "google/gemini-3.1-flash-lite";
const PREVIOUS_VERCEL_DEFAULT_MODEL_IDS = new Set([
  "google/gemini-3.5-flash-lite"
]);

const defaultManualRateLimits: ManualRateLimits = {
  rpmLimit: 15,
  tpmLimit: 250_000,
  rpdLimit: 500,
  stopAfterDailyPercentage: 90,
  maxConcurrentRequests: 1
};

const legacyDefaultManualRateLimits: ManualRateLimits = {
  rpmLimit: 5,
  tpmLimit: 250_000,
  rpdLimit: 20,
  stopAfterDailyPercentage: 90,
  maxConcurrentRequests: 1
};

const defaultSettings: AppSettings = {
  targetLanguage: "Bulgarian",
  targetLanguageCode: "bg",
  providerId: "mock",
  quality: "balanced",
  contextMode: "auto",
  outputConflictMode: "versioned",
  batchUnlocked: false,
  gemini: {
    modelId: GEMINI_DEFAULT_MODEL_ID,
    thinkingLevel: "auto",
    qualityTuningVersion: 1,
    temperature: 0.1,
    maxOutputTokens: 8192,
    useStructuredJson: true,
    apiSurface: "models.generateContent",
    rateLimitMode: "auto-safe",
    manualRateLimits: defaultManualRateLimits
  },
  vercel: {
    modelId: VERCEL_DEFAULT_MODEL_ID,
    temperature: 0.2,
    maxOutputTokens: 8192,
    apiSurface: "openai.chat.completions",
    rateLimitMode: "auto-safe",
    manualRateLimits: defaultManualRateLimits
  }
};

export class SettingsService {
  private readonly settingsPath = join(app.getPath("userData"), "settings.json");
  private readonly geminiApiKeyPath = join(app.getPath("userData"), "gemini-api-key.bin");
  private readonly vercelApiKeyPath = join(app.getPath("userData"), "vercel-ai-gateway-api-key.bin");
  private readonly realDebridApiTokenPath = join(app.getPath("userData"), "real-debrid-api-token.bin");
  private readonly otherDebridTokenPaths: Record<OtherDebridProvider, string> = {
    "all-debrid": join(app.getPath("userData"), "all-debrid-api-token.bin"),
    premiumize: join(app.getPath("userData"), "premiumize-api-token.bin"),
    torbox: join(app.getPath("userData"), "torbox-api-token.bin"),
    "debrid-link": join(app.getPath("userData"), "debrid-link-api-token.bin")
  };
  private readonly mdblistApiKeyPath = join(app.getPath("userData"), "mdblist-api-key.bin");

  async getSettings(): Promise<AppSettings> {
    return await readJsonWithBackup(this.settingsPath, normalizeStoredAppSettings)
      ?? normalizeAppSettings({});
  }

  async saveSettings(settings: AppSettings): Promise<AppSettings> {
    const merged = normalizeAppSettings(settings);
    await replaceJsonWithBackup(this.settingsPath, merged);
    return merged;
  }

  async setGeminiApiKey(apiKey: string): Promise<void> {
    await this.setEncryptedApiKey(this.geminiApiKeyPath, apiKey);
  }

  async getGeminiApiKey(): Promise<string | undefined> {
    return this.getEncryptedApiKey(this.geminiApiKeyPath);
  }

  async hasGeminiApiKey(): Promise<boolean> {
    return Boolean(await this.getGeminiApiKey());
  }

  async setVercelApiKey(apiKey: string): Promise<void> {
    await this.setEncryptedApiKey(this.vercelApiKeyPath, apiKey);
  }

  async getVercelApiKey(): Promise<string | undefined> {
    return this.getEncryptedApiKey(this.vercelApiKeyPath);
  }

  async hasVercelApiKey(): Promise<boolean> {
    return Boolean(await this.getVercelApiKey());
  }

  async setRealDebridApiToken(token: string): Promise<void> {
    await this.setEncryptedApiKey(this.realDebridApiTokenPath, token);
  }

  async getRealDebridApiToken(): Promise<string | undefined> {
    return this.getEncryptedApiKey(this.realDebridApiTokenPath);
  }

  async hasRealDebridApiToken(): Promise<boolean> {
    return Boolean(await this.getRealDebridApiToken());
  }

  async setOtherDebridToken(provider: OtherDebridProvider, token: string): Promise<void> {
    await this.setEncryptedApiKey(this.otherDebridTokenPaths[provider], token);
  }

  async getOtherDebridToken(provider: OtherDebridProvider): Promise<string | undefined> {
    return this.getEncryptedApiKey(this.otherDebridTokenPaths[provider]);
  }

  async clearOtherDebridToken(provider: OtherDebridProvider): Promise<void> {
    await rm(this.otherDebridTokenPaths[provider], { force: true });
  }

  async clearRealDebridApiToken(): Promise<void> {
    await rm(this.realDebridApiTokenPath, { force: true });
  }

  async setMdblistApiKey(apiKey: string): Promise<void> {
    await this.setEncryptedApiKey(this.mdblistApiKeyPath, apiKey);
  }

  async getMdblistApiKey(): Promise<string | undefined> {
    return this.getEncryptedApiKey(this.mdblistApiKeyPath);
  }

  async hasMdblistApiKey(): Promise<boolean> {
    return Boolean(await this.getMdblistApiKey());
  }

  async clearMdblistApiKey(): Promise<void> {
    await rm(this.mdblistApiKeyPath, { force: true });
  }

  private async setEncryptedApiKey(path: string, apiKey: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("OS credential encryption is not available on this computer.");
    }

    const normalized = apiKey.trim();
    if (!normalized || normalized.length > 10_000 || /[\r\n\0]/.test(normalized)) {
      throw new Error("Credential is empty or invalid.");
    }
    const encrypted = safeStorage.encryptString(normalized);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, encrypted);
  }

  private async getEncryptedApiKey(path: string): Promise<string | undefined> {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        return undefined;
      }
      return safeStorage.decryptString(await readFile(path));
    } catch {
      return undefined;
    }
  }
}

/** Reject non-object JSON so the durable store falls back to its backup copy. */
export function normalizeStoredAppSettings(value: unknown): AppSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Stored settings must be a JSON object.");
  }
  return normalizeAppSettings(value as Partial<AppSettings>);
}

export function normalizeAppSettings(saved: Partial<AppSettings>): AppSettings {
  const shouldMigrateGeminiDefaults = PREVIOUS_GEMINI_DEFAULT_MODEL_IDS.has(saved.gemini?.modelId ?? "");
  const shouldMigrateThinkingToQualityAuto = saved.gemini?.qualityTuningVersion !== 1;
  const savedGeminiManualLimits = migrateLegacyManualLimits(saved.gemini?.manualRateLimits);
  const savedVercelManualLimits = migrateLegacyManualLimits(saved.vercel?.manualRateLimits);
  const merged = {
    ...defaultSettings,
    ...saved,
    gemini: {
      ...defaultSettings.gemini,
      ...saved.gemini,
      manualRateLimits: {
        ...defaultSettings.gemini.manualRateLimits,
        ...savedGeminiManualLimits
      },
      apiSurface: "models.generateContent" as const,
      useStructuredJson: true
    },
    vercel: {
      ...defaultSettings.vercel,
      ...saved.vercel,
      manualRateLimits: {
        ...defaultSettings.vercel.manualRateLimits,
        ...savedVercelManualLimits
      },
      apiSurface: "openai.chat.completions" as const
    }
  };

  if (shouldMigrateGeminiDefaults) {
    merged.gemini.modelId = GEMINI_DEFAULT_MODEL_ID;
    merged.gemini.thinkingLevel = "auto";
    merged.gemini.temperature = 0.1;
  }
  if (shouldMigrateThinkingToQualityAuto) {
    merged.gemini.thinkingLevel = "auto";
  }
  merged.gemini.qualityTuningVersion = 1;
  if (PREVIOUS_VERCEL_DEFAULT_MODEL_IDS.has(merged.vercel.modelId)) {
    merged.vercel.modelId = VERCEL_DEFAULT_MODEL_ID;
  }
  merged.quality = "balanced";

  return merged;
}

function migrateLegacyManualLimits(saved?: Partial<ManualRateLimits>): Partial<ManualRateLimits> | undefined {
  if (!saved) {
    return saved;
  }

  if (
    saved.rpmLimit === legacyDefaultManualRateLimits.rpmLimit &&
    saved.tpmLimit === legacyDefaultManualRateLimits.tpmLimit &&
    saved.rpdLimit === legacyDefaultManualRateLimits.rpdLimit &&
    saved.stopAfterDailyPercentage === legacyDefaultManualRateLimits.stopAfterDailyPercentage &&
    saved.maxConcurrentRequests === legacyDefaultManualRateLimits.maxConcurrentRequests
  ) {
    return defaultManualRateLimits;
  }

  return saved;
}
