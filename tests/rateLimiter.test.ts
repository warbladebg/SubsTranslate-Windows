import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiRateLimiter, settingsFromManualLimits, unknownFreeTierSettings } from "../src/core/rateLimit/GeminiRateLimiter";

afterEach(() => vi.useRealTimers());

describe("Gemini rate limiter", () => {
  it("rejects a request that can never fit the token budget instead of waiting forever", async () => {
    const sleep = vi.fn(async () => undefined);
    const limiter = new GeminiRateLimiter(settingsFromManualLimits(10, 100, 100), sleep);
    await expect(limiter.waitForSlot(81, new AbortController().signal)).rejects.toThrow(/tokens-per-minute/);
    expect(sleep).not.toHaveBeenCalled();
    expect(limiter.snapshot().requestsToday).toBe(0);
  });

  it("expires quota entries exactly at the minute boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T12:00:00Z"));
    const limiter = new GeminiRateLimiter(settingsFromManualLimits(1, 1_000, 100));
    const signal = new AbortController().signal;
    await limiter.waitForSlot(1, signal);
    limiter.recordSuccess();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(limiter.snapshot().requestsLastMinute).toBe(0);
    await limiter.waitForSlot(1, signal);
    expect(limiter.snapshot().requestsToday).toBe(2);
  });
  it("applies manual safety margins", () => {
    const limiter = new GeminiRateLimiter(settingsFromManualLimits(5, 250_000, 20));
    const snapshot = limiter.snapshot();

    expect(snapshot.effectiveRpm).toBe(4);
    expect(snapshot.effectiveTpm).toBe(200_000);
    expect(snapshot.effectiveRpd).toBe(20);
  });

  it("uses Gemini 3.1 Flash Lite scale for auto-safe defaults", () => {
    const limiter = new GeminiRateLimiter(unknownFreeTierSettings);
    const snapshot = limiter.snapshot();

    expect(snapshot.effectiveRpm).toBe(15);
    expect(snapshot.effectiveTpm).toBe(250_000);
    expect(snapshot.effectiveRpd).toBe(450);
  });

  it("labels the local daily stop as an app safety cap", async () => {
    const limiter = new GeminiRateLimiter(settingsFromManualLimits(10, 1_000_000, 1));
    const signal = new AbortController().signal;

    await limiter.waitForSlot(1, signal);
    limiter.recordSuccess();

    await expect(limiter.waitForSlot(1, signal)).rejects.toThrow(/App daily safety cap/);
    await expect(limiter.waitForSlot(1, signal)).rejects.not.toThrow(/quota reached/);
  });
});
