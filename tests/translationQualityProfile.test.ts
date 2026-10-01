import { describe, expect, it } from "vitest";
import {
  getAutomaticTranslationThinkingLevel,
  getTranslationQualityProfile
} from "../src/core/translation/TranslationQualityProfile";

describe("translation quality profiles", () => {
  it("makes fast mode larger and best mode more careful", () => {
    const fast = getTranslationQualityProfile("fast");
    const balanced = getTranslationQualityProfile("balanced");
    const best = getTranslationQualityProfile("best");

    expect(fast.maxCharacters).toBeGreaterThan(balanced.maxCharacters);
    expect(best.maxCharacters).toBeLessThanOrEqual(balanced.maxCharacters);
    expect(best.contextCueCount).toBeGreaterThan(balanced.contextCueCount);
    expect(best.style).toContain("careful");
  });

  it("keeps automatic Gemini reasoning at the balanced default", () => {
    expect(getAutomaticTranslationThinkingLevel("fast")).toBe("minimal");
    expect(getAutomaticTranslationThinkingLevel("balanced")).toBe("minimal");
    expect(getAutomaticTranslationThinkingLevel("best")).toBe("minimal");
  });
});
