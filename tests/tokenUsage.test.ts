import { describe, expect, it } from "vitest";
import { estimateCostUsd, normalizeUsage } from "../src/core/usage/TokenUsage";

describe("token usage accounting", () => {
  it("estimates Gemini 3.5 Flash-Lite list cost from input and output tokens", () => {
    const usage = normalizeUsage(1_000_000, 1_000_000);

    expect(estimateCostUsd("gemini", "gemini-3.5-flash-lite", usage)).toBeCloseTo(2.8);
    expect(estimateCostUsd("vercel", "google/gemini-3.5-flash-lite", usage)).toBeCloseTo(2.8);
  });

  it("keeps historical Gemini 3.1 Flash-Lite runs priceable", () => {
    const usage = normalizeUsage(1_000_000, 1_000_000);

    expect(estimateCostUsd("gemini", "gemini-3.1-flash-lite", usage)).toBeCloseTo(1.75);
    expect(estimateCostUsd("vercel", "google/gemini-3.1-flash-lite", usage)).toBeCloseTo(1.75);
  });

  it("bills separately reported thinking tokens at the output rate", () => {
    const usage = normalizeUsage(1_000_000, 1_000_000, 3_000_000, 1_000_000);

    expect(estimateCostUsd("gemini", "gemini-3.1-flash-lite", usage)).toBeCloseTo(3.25);
    expect(estimateCostUsd("gemini", "gemini-3.5-flash-lite", usage)).toBeCloseTo(5.3);
  });
});
