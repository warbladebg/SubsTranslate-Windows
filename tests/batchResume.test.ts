import { describe, expect, it } from "vitest";
import { isRecoverableQuotaOrCreditError } from "../src/core/batch/BatchResume";

describe("batch resume error classification", () => {
  it.each([
    "App daily safety cap for Gemini reached. Progress was saved.",
    "RESOURCE_EXHAUSTED: quota exceeded",
    "resource-exhausted: retry after the account is topped up",
    "Vercel AI Gateway request failed with 402: insufficient credits",
    "Provider balance error: insufficient funds",
    "Credits depleted for this billing period",
    "Request failed with 429",
    "Payment required before more requests can be made",
    "The billing limit has been reached"
  ])("recognizes a resumable quota or credit stop: %s", (message) => {
    expect(isRecoverableQuotaOrCreditError(new Error(message))).toBe(true);
  });

  it.each([
    "No supported subtitle track matches the selected reference track.",
    "FFmpeg exited with code 1",
    "Provider returned invalid JSON",
    "Output file already exists."
  ])("does not pause for an ordinary file failure: %s", (message) => {
    expect(isRecoverableQuotaOrCreditError(new Error(message))).toBe(false);
  });

  it("also classifies non-Error provider responses safely", () => {
    expect(isRecoverableQuotaOrCreditError("HTTP 429 RESOURCE_EXHAUSTED")).toBe(true);
    expect(isRecoverableQuotaOrCreditError(undefined)).toBe(false);
  });
});
