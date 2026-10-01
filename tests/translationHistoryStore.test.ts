import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AppSettings } from "../src/main/settingsService";
import { TranslationHistoryStore } from "../src/main/translationHistoryStore";
import type { ModelExchangeAudit } from "../src/core/translation/TranslationProvider";
import type { SubtitleTrack } from "../src/core/video/SubtitleTrack";

describe("translation history store", () => {
  it("stores run summaries and model input/output audit records", async () => {
    const dir = await mkdtemp(join(tmpdir(), "translation-history-"));
    const store = new TranslationHistoryStore(join(dir, "history.json"), join(dir, "model-exchanges"));

    await store.startRun({
      sessionId: "session-1",
      videoPath: "D:\\Movies\\sample.mkv",
      track: createTrack(),
      settings: createSettings(),
      sampleMode: "none"
    });
    await store.recordExchange("session-1", "gemini", createExchange());
    await store.completeRun("session-1", {
      outputPath: "D:\\Movies\\sample.bg.srt",
      cueCount: 2,
      chunkCount: 1,
      cacheHits: 0,
      warningCount: 0
    });

    const stats = await store.getStats();

    expect(stats.latest?.requestCount).toBe(1);
    expect(stats.latest?.usage.inputTokens).toBe(100);
    expect(stats.latest?.estimatedCostUsd).toBeCloseTo(0.00004);
    expect(stats.latestExchanges[0].prompt).toBe("Translate this");
    expect(stats.latestExchanges[0].rawOutput).toContain("Здравей");
  });

  it("returns audit records for a selected previous translation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "translation-history-"));
    const store = new TranslationHistoryStore(join(dir, "history.json"), join(dir, "model-exchanges"));

    await store.startRun({
      sessionId: "older-session",
      videoPath: "D:\\Movies\\older.mkv",
      track: createTrack(),
      settings: createSettings(),
      sampleMode: "none"
    });
    await store.recordExchange("older-session", "gemini", createExchange("Older prompt"));

    await store.startRun({
      sessionId: "newer-session",
      videoPath: "D:\\Movies\\newer.mkv",
      track: createTrack(),
      settings: createSettings(),
      sampleMode: "none"
    });
    await store.recordExchange("newer-session", "gemini", createExchange("Newer prompt"));

    const stats = await store.getStats("older-session");

    expect(stats.latest?.sessionId).toBe("newer-session");
    expect(stats.selected?.sessionId).toBe("older-session");
    expect(stats.selectedExchanges[0].prompt).toBe("Older prompt");
    expect(stats.latestExchanges[0].prompt).toBe("Newer prompt");
  });

  it("reprices stored runs and exchanges with separately reported thinking tokens", async () => {
    const dir = await mkdtemp(join(tmpdir(), "translation-history-"));
    const store = new TranslationHistoryStore(join(dir, "history.json"), join(dir, "model-exchanges"));
    const exchange = createExchange();
    exchange.usage = {
      inputTokens: 100,
      outputTokens: 10,
      thinkingTokens: 20,
      totalTokens: 130
    };

    await store.startRun({
      sessionId: "thinking-session",
      videoPath: "D:\\Movies\\thinking.mkv",
      track: createTrack(),
      settings: createSettings(),
      sampleMode: "none"
    });
    await store.recordExchange("thinking-session", "gemini", exchange);

    const stats = await store.getStats();

    expect(stats.latest?.estimatedCostUsd).toBeCloseTo(0.00007);
    expect(stats.latestExchanges[0].estimatedCostUsd).toBeCloseTo(0.00007);
    expect(stats.pricingNotes).toContain(
      "When reported separately, thinking tokens are billed at the model output-token rate."
    );
  });
});

function createExchange(prompt = "Translate this"): ModelExchangeAudit {
  return {
    provider: "Gemini",
    model: "gemini-3.1-flash-lite",
    startedAt: "2026-07-08T00:00:00.000Z",
    completedAt: "2026-07-08T00:00:01.000Z",
    durationMs: 1000,
    status: "success",
    chunkId: 1,
    chunkIndex: 0,
    request: {
      targetLanguage: "Bulgarian",
      style: "subtitles",
      glossary: {},
      contextBefore: [],
      targetLines: [{ id: 1, text: "Hello" }],
      contextAfter: [],
      estimatedInputTokens: 100
    },
    prompt,
    rawOutput: "{\"translations\":[{\"id\":1,\"translation\":\"Здравей\"}]}",
    parsedOutput: { translations: [{ id: 1, translation: "Здравей" }], warnings: [] },
    usage: {
      inputTokens: 100,
      outputTokens: 10,
      totalTokens: 110
    }
  };
}

function createTrack(): SubtitleTrack {
  return {
    index: 2,
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
    rpmLimit: 15,
    tpmLimit: 250_000,
    rpdLimit: 500,
    stopAfterDailyPercentage: 90,
    maxConcurrentRequests: 1
  };

  return {
    targetLanguage: "Bulgarian",
    targetLanguageCode: "bg",
    providerId: "gemini",
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
