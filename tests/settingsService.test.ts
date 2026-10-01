import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJsonWithBackup, replaceJsonWithBackup } from "../src/main/durableFileStore";
import { normalizeAppSettings, normalizeStoredAppSettings } from "../src/main/settingsService";

describe("settings model defaults", () => {
  it("uses Gemini 3.1 Flash-Lite for new settings", () => {
    const settings = normalizeAppSettings({});

    expect(settings.quality).toBe("balanced");
    expect(settings.gemini.modelId).toBe("gemini-3.1-flash-lite");
    expect(settings.gemini.thinkingLevel).toBe("auto");
    expect(settings.gemini.temperature).toBe(0.1);
    expect(settings.vercel.modelId).toBe("google/gemini-3.1-flash-lite");
  });

  it("migrates removed translation quality choices to balanced", () => {
    expect(normalizeAppSettings({ quality: "fast" }).quality).toBe("balanced");
    expect(normalizeAppSettings({ quality: "best" }).quality).toBe("balanced");
  });

  it("migrates the previous Flash-Lite defaults without changing custom models", () => {
    const migrated = normalizeAppSettings({
      gemini: { modelId: "gemini-3.5-flash-lite" } as never,
      vercel: { modelId: "google/gemini-3.5-flash-lite" } as never
    });
    expect(migrated.gemini.modelId).toBe("gemini-3.1-flash-lite");
    expect(migrated.gemini.thinkingLevel).toBe("auto");
    expect(migrated.gemini.temperature).toBe(0.1);

    expect(migrated.vercel.modelId).toBe("google/gemini-3.1-flash-lite");

    expect(normalizeAppSettings({
      gemini: { modelId: "gemini-3.5-flash" } as never
    }).gemini.modelId).toBe("gemini-3.5-flash");
  });

  it("preserves an intentional manual thinking override after quality tuning migration", () => {
    const settings = normalizeAppSettings({
      gemini: {
        modelId: "gemini-3.1-flash-lite",
        thinkingLevel: "medium",
        qualityTuningVersion: 1
      } as never
    });

    expect(settings.gemini.thinkingLevel).toBe("medium");
  });

  it("rejects non-object settings so a corrupted file falls back to the backup", async () => {
    expect(() => normalizeStoredAppSettings(null)).toThrow();
    expect(() => normalizeStoredAppSettings([])).toThrow();
    expect(() => normalizeStoredAppSettings("mock")).toThrow();

    const settingsPath = join(await mkdtemp(join(tmpdir(), "substranslate-settings-")), "settings.json");
    await replaceJsonWithBackup(settingsPath, normalizeAppSettings({ providerId: "gemini" }));
    await replaceJsonWithBackup(settingsPath, normalizeAppSettings({ providerId: "vercel" }));
    await writeFile(settingsPath, "{truncated", "utf8");

    expect((await readJsonWithBackup(settingsPath, normalizeStoredAppSettings))?.providerId).toBe("gemini");
  });
});
