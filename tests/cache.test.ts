import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCacheKey, TranslationCache } from "../src/core/cache/TranslationCache";

describe("translation cache", () => {
  it("stores and retrieves completed chunk translations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "subtitle-cache-"));
    const cache = new TranslationCache(join(dir, "cache.json"));
    const key = createCacheKey({
      subtitleFileHash: "a",
      cueIds: [1],
      originalCueTextHash: "b",
      targetLanguage: "Bulgarian",
      modelId: "mock",
      translationSettingsHash: "c",
      promptVersion: "v1"
    });

    await cache.set(key, {
      result: { translations: [{ id: 1, translation: "Здравей." }], warnings: [] },
      timestamp: "2026-07-06T00:00:00.000Z",
      provider: "mock",
      model: "mock",
      appVersion: "test"
    });

    expect((await cache.get(key))?.result.translations[0].translation).toBe("Здравей.");
  });

  it("preserves concurrent writes when a new cache instance reads the file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "subtitle-cache-"));
    const path = join(dir, "cache.json");
    const cache = new TranslationCache(path);
    const value = {
      result: { translations: [{ id: 1, translation: "Здравей." }], warnings: [] },
      timestamp: "2026-07-06T00:00:00.000Z",
      provider: "mock",
      model: "mock",
      appVersion: "test"
    };

    await Promise.all([cache.set("first", value), cache.set("second", value)]);
    const reopened = new TranslationCache(path);
    expect(await reopened.get("first")).toEqual(value);
    expect(await reopened.get("second")).toEqual(value);
  });
});
