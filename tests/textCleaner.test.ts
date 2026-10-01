import { describe, expect, it } from "vitest";
import { rewrapSubtitleText } from "../src/core/subtitle/TextCleaner";

describe("subtitle readability wrapping", () => {
  it("wraps translated text into a practical number of lines", () => {
    const wrapped = rewrapSubtitleText("Това е много дълъг преведен ред, който трябва да бъде разделен четимо.", {
      maxLineLength: 28,
      maxLines: 2
    });

    expect(wrapped.split("\n")).toHaveLength(2);
  });

  it("normalizes speaker-dash spacing while preserving separate dialogue lines", () => {
    const wrapped = rewrapSubtitleText("-Първа реплика.\n-Втора реплика.", {
      maxLineLength: 42,
      maxLines: 2
    });

    expect(wrapped).toContain("- Първа реплика.");
    expect(wrapped).toContain("- Втора реплика.");
    expect(wrapped).toContain("\n");
  });
});
