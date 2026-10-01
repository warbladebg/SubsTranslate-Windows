import { describe, expect, it } from "vitest";
import { errorMessage, isAbortError } from "../src/core/util/errors";
import { fileName, parentDirectory } from "../src/core/util/paths";
import { cleanText, stableNumericId } from "../src/core/util/text";
import { createWorkflowProfileDraft, profileTranslationSettings, workflowProfileToMediaConfig } from "../src/core/workflow/WorkflowProfiles";
import { normalizeAppSettings } from "../src/main/settingsService";
import { formatBytes, formatError, formatShortDate } from "../src/renderer/format";
import { hasProviderKey, missingProviderKeyError } from "../src/renderer/providerKeys";

describe("shared helpers", () => {
  it("splits Windows and POSIX paths", () => {
    expect(fileName("C:\\Media\\Show\\episode.mkv")).toBe("episode.mkv");
    expect(fileName("/media/show/episode.mkv")).toBe("episode.mkv");
    expect(fileName("episode.mkv")).toBe("episode.mkv");
    expect(parentDirectory("C:\\Media\\Show\\episode.mkv")).toBe("C:\\Media\\Show");
    expect(parentDirectory("/media/show/episode.mkv")).toBe("/media/show");
    expect(parentDirectory("episode.mkv")).toBe("episode.mkv");
  });

  it("removes Electron's IPC wrapper from renderer error messages", () => {
    const ipcError = new Error("Error invoking remote method 'translation:start': Error: Quota exceeded.");
    expect(formatError(ipcError)).toBe("Quota exceeded.");
    expect(formatError("plain failure")).toBe("plain failure");
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("recognises abort errors from any source", () => {
    expect(isAbortError(new DOMException("stopped", "AbortError"))).toBe(true);
    expect(isAbortError({ name: "AbortError" })).toBe(true);
    expect(isAbortError(new Error("stopped"))).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });

  it("cleans untrusted text and derives stable ids", () => {
    expect(cleanText("  Line one\r\nLine\0two   three  ")).toBe("Line one Line two three");
    expect(cleanText("  Line one\r\nLine\0two   three  ", 13)).toBe("Line one Line");
    expect(stableNumericId("Drama")).toBe(stableNumericId("Drama"));
    expect(stableNumericId("Drama")).not.toBe(stableNumericId("Comedy"));
    expect(stableNumericId("")).toBeGreaterThan(0);
  });

  it("formats sizes and dates for display", () => {
    expect(formatBytes(512)).toBe("1 KB");
    expect(formatBytes(244 * 1024 ** 2)).toBe("244.0 MB");
    expect(formatBytes(10.8 * 1024 ** 3)).toBe("10.8 GB");
    expect(formatBytes(Number.NaN)).toBe("Unknown size");
    expect(formatShortDate("not a date")).toBe("recently");
    expect(formatShortDate(undefined, "-")).toBe("-");
  });

  it("explains which provider key is missing", () => {
    const noKeys = { hasGeminiKey: false, hasVercelKey: false };
    expect(hasProviderKey("mock", noKeys)).toBe(true);
    expect(missingProviderKeyError("mock", noKeys)).toBeUndefined();
    expect(missingProviderKeyError("gemini", noKeys)).toBe("Gemini API key is missing. Add it in Settings before using Gemini.");
    expect(missingProviderKeyError("vercel", noKeys, "batch"))
      .toBe("Vercel AI Gateway API key is missing. Add it in Settings before continuing the batch.");
    expect(missingProviderKeyError("gemini", { hasGeminiKey: true, hasVercelKey: false })).toBeUndefined();
  });

  it("flattens workflow profiles into media configs", () => {
    const draft = createWorkflowProfileDraft(normalizeAppSettings({}));
    draft.config.media.audioEnabled = false;
    draft.config.media.audioGainDb = 4;
    draft.config.media.outputMode = "replace-original";
    draft.config.media.outputContainerId = "mp4";
    const config = workflowProfileToMediaConfig(draft);
    expect(config.audioProfileId).toBe("copy");
    expect(config.audioGainDb).toBe(0);
    expect(config.outputContainerId).toBe("mkv");
    expect(config.subtitleWorkflow).toBe("translate");
  });

  it("keeps the earned batch unlock when applying profile settings", () => {
    const draft = createWorkflowProfileDraft(normalizeAppSettings({ batchUnlocked: false }));
    const current = normalizeAppSettings({ batchUnlocked: true });
    expect(profileTranslationSettings(draft, current).batchUnlocked).toBe(true);
    expect(profileTranslationSettings(draft, undefined).batchUnlocked).toBe(false);
  });
});
