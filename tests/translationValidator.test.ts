import { describe, expect, it } from "vitest";
import { validateTranslationResult } from "../src/core/translation/TranslationValidator";
import { TranslationRequest } from "../src/core/translation/TranslationProvider";

const request: TranslationRequest = {
  targetLanguage: "Bulgarian",
  style: "subtitles",
  glossary: {},
  contextBefore: [],
  targetLines: [
    { id: 1, text: "Hello." },
    { id: 2, text: "OK" }
  ],
  contextAfter: [],
  estimatedInputTokens: 10
};

describe("translation validator", () => {
  it("accepts valid Bulgarian translations", () => {
    const result = validateTranslationResult(
      { translations: [{ id: 1, translation: "Здравей." }, { id: 2, translation: "OK" }] },
      request
    );

    expect(result.translations).toHaveLength(2);
  });

  it("rejects missing and duplicate cue IDs", () => {
    expect(() => validateTranslationResult({ translations: [{ id: 1, translation: "Здравей." }] }, request)).toThrow(
      /Missing translation id 2/
    );
    expect(() =>
      validateTranslationResult(
        { translations: [{ id: 1, translation: "Здравей." }, { id: 1, translation: "Пак." }] },
        request
      )
    ).toThrow(/Duplicate translation id 1/);
  });

  it("treats Cyrillic detection as a warning instead of a hard failure", () => {
    const result = validateTranslationResult(
      { translations: [{ id: 1, translation: "Hello." }, { id: 2, translation: "OK" }] },
      request
    );

    expect(result.warnings).toEqual([]);
  });

  it("rejects unreadable OCR-style translation output", () => {
    expect(() =>
      validateTranslationResult(
        {
          translations: [
            { id: 1, translation: "Lala haninnina tn nat tha idas" },
            { id: 2, translation: "OK" }
          ]
        },
        request
      )
    ).toThrow(/Translation 1 looks unreadable/);
  });

  it("allows short Latin cues and proper names", () => {
    const result = validateTranslationResult(
      {
        translations: [
          { id: 1, translation: "Michael Scofield" },
          { id: 2, translation: "OK" }
        ]
      },
      request
    );

    expect(result.translations).toHaveLength(2);
  });

  it("rejects mixed OCR alphanumeric noise", () => {
    expect(() =>
      validateTranslationResult(
        {
          translations: [
            { id: 1, translation: "ТАТУИРАНЕ НА MEER E BHTZ7IMNOY" },
            { id: 2, translation: "OK" }
          ]
        },
        request
      )
    ).toThrow(/Translation 1 looks unreadable/);
  });
});
