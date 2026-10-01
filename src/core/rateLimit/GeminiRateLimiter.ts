import { abortableDelay } from "../async/abortableDelay";
import { errorMessage } from "../util/errors";

const pacificDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export interface RateLimitSettings {
  rpmLimit: number;
  tpmLimit: number;
  rpdLimit: number;
  rpmSafetyMultiplier: number;
  tpmSafetyMultiplier: number;
  rpdSafetyMultiplier: number;
  maxConcurrentRequests: number;
  minimumDelayMs: number;
}

export interface GeminiRateLimiterSnapshot {
  effectiveRpm: number;
  effectiveTpm: number;
  effectiveRpd: number;
  activeRequests: number;
  requestsLastMinute: number;
  tokensLastMinute: number;
  requestsToday: number;
  successesToday: number;
  failedRequests: number;
  resourceExhaustedErrors: number;
  lastSuccessfulRequestTime?: number;
}

interface RequestWindowEntry {
  at: number;
  tokens: number;
}

export const unknownFreeTierSettings: RateLimitSettings = {
  rpmLimit: 15,
  tpmLimit: 250_000,
  rpdLimit: 500,
  rpmSafetyMultiplier: 1,
  tpmSafetyMultiplier: 1,
  rpdSafetyMultiplier: 0.9,
  maxConcurrentRequests: 1,
  minimumDelayMs: 4_000
};

export function settingsFromManualLimits(
  rpmLimit: number,
  tpmLimit: number,
  rpdLimit: number,
  maxConcurrentRequests = 1
): RateLimitSettings {
  return {
    rpmLimit,
    tpmLimit,
    rpdLimit,
    rpmSafetyMultiplier: 0.8,
    tpmSafetyMultiplier: 0.8,
    rpdSafetyMultiplier: 1,
    maxConcurrentRequests,
    minimumDelayMs: 0
  };
}

export class GeminiRateLimiter {
  private readonly requests: RequestWindowEntry[] = [];
  private activeRequests = 0;
  private requestsToday = 0;
  private successesToday = 0;
  private failedRequests = 0;
  private resourceExhaustedErrors = 0;
  private lastSuccessfulRequestTime: number | undefined;
  private dayKey = getPacificDateKey(Date.now());
  private activeRpmMultiplier = 1;

  constructor(
    private readonly settings: RateLimitSettings,
    private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void> = sleepWithAbort,
    private readonly onWait?: (ms: number) => void,
    private readonly providerName = "Gemini"
  ) {}

  async waitForSlot(estimatedInputTokens: number, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (!Number.isFinite(estimatedInputTokens) || estimatedInputTokens < 0) {
      throw new Error("Estimated input tokens must be a finite, non-negative number.");
    }
    if (estimatedInputTokens > this.getEffectiveTpm()) {
      throw new Error(`This request exceeds the app's ${this.providerName} tokens-per-minute limit. Increase the manual TPM limit before retrying.`);
    }
    while (true) {
      signal.throwIfAborted();
      this.resetDailyIfNeeded();
      this.pruneWindow();

      const waitMs = this.getWaitMs(estimatedInputTokens);
      if (waitMs === 0) {
        this.activeRequests += 1;
        this.requestsToday += 1;
        this.requests.push({ at: Date.now(), tokens: estimatedInputTokens });
        return;
      }

      this.onWait?.(waitMs);
      await this.sleep(waitMs, signal);
    }
  }

  recordSuccess(): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    this.successesToday += 1;
    this.lastSuccessfulRequestTime = Date.now();
  }

  recordFailure(error: unknown): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    this.failedRequests += 1;
    if (isResourceExhaustedError(error)) {
      this.resourceExhaustedErrors += 1;
    }
  }

  reduceActiveRpm(multiplier: number): void {
    this.activeRpmMultiplier = Math.max(0.1, this.activeRpmMultiplier * multiplier);
  }

  forceOneRequestPerMinute(): void {
    const effectiveRpm = this.getEffectiveRpm();
    this.activeRpmMultiplier = Math.min(this.activeRpmMultiplier, 1 / Math.max(1, effectiveRpm));
  }

  snapshot(): GeminiRateLimiterSnapshot {
    this.resetDailyIfNeeded();
    this.pruneWindow();
    return {
      effectiveRpm: this.getEffectiveRpm(),
      effectiveTpm: this.getEffectiveTpm(),
      effectiveRpd: this.getEffectiveRpd(),
      activeRequests: this.activeRequests,
      requestsLastMinute: this.requests.length,
      tokensLastMinute: this.requests.reduce((sum, entry) => sum + entry.tokens, 0),
      requestsToday: this.requestsToday,
      successesToday: this.successesToday,
      failedRequests: this.failedRequests,
      resourceExhaustedErrors: this.resourceExhaustedErrors,
      lastSuccessfulRequestTime: this.lastSuccessfulRequestTime
    };
  }

  private getWaitMs(estimatedInputTokens: number): number {
    const now = Date.now();
    const effectiveRpm = Math.max(1, Math.floor(this.getEffectiveRpm() * this.activeRpmMultiplier));
    const effectiveTpm = this.getEffectiveTpm();
    const effectiveRpd = this.getEffectiveRpd();
    const tokensLastMinute = this.requests.reduce((sum, entry) => sum + entry.tokens, 0);

    if (this.requestsToday >= effectiveRpd) {
      throw new Error(
        `App daily safety cap for ${this.providerName} reached before the provider quota. ` +
          "Progress was saved and can be resumed later. Increase manual RPD limits in Settings if your dashboard shows more quota."
      );
    }

    if (this.activeRequests >= this.settings.maxConcurrentRequests) {
      return 250;
    }

    if (this.lastSuccessfulRequestTime !== undefined && now - this.lastSuccessfulRequestTime < this.settings.minimumDelayMs) {
      return this.settings.minimumDelayMs - (now - this.lastSuccessfulRequestTime);
    }

    if (this.requests.length >= effectiveRpm) {
      return 60_000 - (now - this.requests[0].at);
    }

    if (tokensLastMinute + estimatedInputTokens > effectiveTpm) {
      const oldestRequestTime = this.requests[0]?.at ?? now;
      return 60_000 - (now - oldestRequestTime);
    }

    return 0;
  }

  private getEffectiveRpm(): number {
    return Math.max(1, Math.floor(this.settings.rpmLimit * this.settings.rpmSafetyMultiplier));
  }

  private getEffectiveTpm(): number {
    return Math.max(1, Math.floor(this.settings.tpmLimit * this.settings.tpmSafetyMultiplier));
  }

  private getEffectiveRpd(): number {
    return Math.max(1, Math.floor(this.settings.rpdLimit * this.settings.rpdSafetyMultiplier));
  }

  private pruneWindow(): void {
    const cutoff = Date.now() - 60_000;
    while (this.requests[0] && this.requests[0].at <= cutoff) {
      this.requests.shift();
    }
  }

  private resetDailyIfNeeded(): void {
    const currentDayKey = getPacificDateKey(Date.now());
    if (currentDayKey !== this.dayKey) {
      this.dayKey = currentDayKey;
      this.requestsToday = 0;
      this.successesToday = 0;
    }
  }
}

export function isResourceExhaustedError(error: unknown): boolean {
  const message = errorMessage(error);
  return /429|RESOURCE_EXHAUSTED|rate limit/i.test(message);
}

function getPacificDateKey(timestamp: number): string {
  return pacificDateFormatter.format(timestamp);
}

function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return abortableDelay(ms, signal, "Rate-limit wait cancelled.");
}
