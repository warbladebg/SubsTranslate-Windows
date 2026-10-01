import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AppSettings } from "../src/main/settingsService";
import { TranslationSessionStore } from "../src/main/translationSessionStore";
import type { SubtitleTrack } from "../src/core/video/SubtitleTrack";

describe("translation session store", () => {
  it("resumes an unfinished session and keeps saved progress", async () => {
    const dir = await mkdtemp(join(tmpdir(), "translation-session-"));
    const store = new TranslationSessionStore(join(dir, "sessions.json"));
    const input = createInput();

    const first = await store.startOrResumeSession(input);
    await store.appendProgress(first.id, {
      stage: "Translating",
      message: "Translated chunk 1/3.",
      completedChunks: 1,
      totalChunks: 3,
      progressPercent: 57
    });

    const resumed = await store.startOrResumeSession(input);
    const latest = await store.getLatestSession();

    expect(resumed.id).toBe(first.id);
    expect(latest?.progress.percent).toBe(57);
    expect(latest?.progress.completedChunks).toBe(1);
    expect(latest?.progress.messages.at(-1)?.message).toBe("Translated chunk 1/3.");
  });
});

function createInput() {
  return {
    videoPath: "D:\\Movies\\sample.mkv",
    track: createTrack(),
    settings: createSettings(),
    sampleMode: "none"
  };
}

function createTrack(): SubtitleTrack {
  return {
    index: 4,
    codecName: "subrip",
    codecType: "subtitle",
    language: "eng",
    title: "English",
    isSupported: true,
    isTextBased: true,
    isImageBased: false,
    requiresOcr: false,
    supportedFormat: "srt"
  };
}

function createSettings(): AppSettings {
  const manualRateLimits = {
    rpmLimit: 5,
    tpmLimit: 250_000,
    rpdLimit: 20,
    stopAfterDailyPercentage: 90,
    maxConcurrentRequests: 1
  };

  return {
    targetLanguage: "Bulgarian",
    targetLanguageCode: "bg",
    providerId: "mock",
    quality: "balanced",
    contextMode: "auto",
    outputConflictMode: "versioned",
    batchUnlocked: false,
    gemini: {
      modelId: "gemini-3.1-flash-lite",
      thinkingLevel: "minimal",
      temperature: 0.2,
      maxOutputTokens: 8192,
      useStructuredJson: true,
      apiSurface: "models.generateContent",
      rateLimitMode: "auto-safe",
      manualRateLimits
    },
    vercel: {
      modelId: "google/gemini-3.1-flash-lite",
      temperature: 0.2,
      maxOutputTokens: 8192,
      apiSurface: "openai.chat.completions",
      rateLimitMode: "auto-safe",
      manualRateLimits
    }
  };
}
