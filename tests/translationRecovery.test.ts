import { describe, expect, it } from "vitest";
import type { TranslationRequest } from "../src/core/translation/TranslationProvider";
import {
  fallbackSingleCueTranslation,
  getEmptyTranslationId,
  getUnusableTranslationId,
  isEmptyTranslationError,
  isUnusableTranslationError
} from "../src/main/translationManager";

describe("translation recovery", () => {
  it("detects empty translation validation errors", () => {
    expect(isEmptyTranslationError(new Error("Translation 263 is empty."))).toBe(true);
    expect(getEmptyTranslationId(new Error("Translation 263 is empty."))).toBe(263);
    expect(isEmptyTranslationError(new Error("Missing translation id 263."))).toBe(false);
    expect(getEmptyTranslationId(new Error("Missing translation id 263."))).toBeUndefined();
  });

  it("detects unusable translation validation errors", () => {
    expect(isUnusableTranslationError(new Error("Translation 263 is empty."))).toBe(true);
    expect(isUnusableTranslationError(new Error("Translation 457 looks unreadable."))).toBe(true);
    expect(getUnusableTranslationId(new Error("Translation 457 looks unreadable."))).toBe(457);
    expect(getUnusableTranslationId(new Error("Missing translation id 457."))).toBeUndefined();
  });

  it("keeps original text with a warning when a single cue cannot be recovered", () => {
    const result = fallbackSingleCueTranslation(createSingleCueRequest(), "Translation 263 is empty.");

    expect(result.translations).toEqual([{ id: 263, translation: "All right." }]);
    expect(result.warnings[0]).toContain("Cue 263 kept its original text");
  });

  it("uses an unreadable placeholder when a single cue is OCR garbage", () => {
    const result = fallbackSingleCueTranslation(
      {
        ...createSingleCueRequest(),
        targetLines: [{ id: 457, text: "= = = Value? EE — E=E = Pett —_—e=a——ru" }]
      },
      "Translation 457 looks unreadable."
    );

    expect(result.translations).toEqual([{ id: 457, translation: "[неразчетим субтитър]" }]);
    expect(result.warnings[0]).toContain("Cue 457 marked as unreadable");
  });
});

function createSingleCueRequest(): TranslationRequest {
  return {
    targetLanguage: "Bulgarian",
    style: "subtitles",
    glossary: {},
    contextBefore: [],
    targetLines: [{ id: 263, text: "All right." }],
    contextAfter: [],
    estimatedInputTokens: 4
  };
}
