import { describe, expect, it, vi } from "vitest";
import type { GeminiRateLimiter } from "../src/core/rateLimit/GeminiRateLimiter";
import {
  RemoteResponseError,
  RemoteTranslationProvider,
  type RemoteCompletion,
  type RemoteProviderOptions
} from "../src/core/translation/RemoteTranslationProvider";
import type { ModelExchangeAudit, TranslationRequest } from "../src/core/translation/TranslationProvider";

const VALID_REPLY = JSON.stringify({ translations: [{ id: 1, translation: "Здравей." }] });

class FakeProvider extends RemoteTranslationProvider {
  readonly name = "Fake Model";

  constructor(options: RemoteProviderOptions, private readonly replies: Array<() => Promise<RemoteCompletion>>) {
    super(options, "Fake");
  }

  protected complete(): Promise<RemoteCompletion> {
    const next = this.replies.shift();
    if (!next) throw new Error("No reply scripted.");
    return next();
  }
}

function setup(replies: Array<() => Promise<RemoteCompletion>>) {
  const exchanges: ModelExchangeAudit[] = [];
  const retries: string[] = [];
  const sleep = vi.fn(async (_ms: number, _signal: AbortSignal) => undefined);
  // A stub keeps the tests instant: the real limiter waits a minute after forceOneRequestPerMinute().
  const rateLimiter = {
    waitForSlot: vi.fn(async () => undefined),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
    reduceActiveRpm: vi.fn(),
    forceOneRequestPerMinute: vi.fn()
  };
  const provider = new FakeProvider({
    model: "fake-1",
    rateLimiter: rateLimiter as unknown as GeminiRateLimiter,
    sleep,
    onRetry: (message) => retries.push(message),
    onExchange: (exchange) => {
      exchanges.push(exchange);
    }
  }, replies);
  return { provider, exchanges, retries, sleep, rateLimiter };
}

const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };

describe("RemoteTranslationProvider", () => {
  it("validates the reply and records a successful exchange", async () => {
    const { provider, exchanges } = setup([async () => ({ text: VALID_REPLY, usage })]);

    const result = await provider.translateChunk(createRequest(), new AbortController().signal);

    expect(result.translations[0].translation).toBe("Здравей.");
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]).toMatchObject({ provider: "Fake Model", model: "fake-1", status: "success", rawOutput: VALID_REPLY, usage });
    expect(exchanges[0].prompt).toContain("Hello.");
  });

  it("keeps an error reply body in the failed exchange record", async () => {
    const { provider, exchanges } = setup([async () => {
      throw new RemoteResponseError("Request failed with 500", "{\"error\":\"overloaded\"}");
    }]);

    await expect(provider.translateChunk(createRequest(), new AbortController().signal)).rejects.toThrow("Request failed with 500");
    expect(exchanges[0]).toMatchObject({
      status: "failed",
      rawOutput: "{\"error\":\"overloaded\"}",
      error: "Request failed with 500"
    });
  });

  it("backs off once on 429 and retries the same chunk", async () => {
    const { provider, retries, sleep, rateLimiter } = setup([
      async () => {
        throw new Error("HTTP 429 Too Many Requests");
      },
      async () => ({ text: VALID_REPLY, usage })
    ]);

    const result = await provider.translateChunk(createRequest(), new AbortController().signal);

    expect(result.translations).toHaveLength(1);
    expect(sleep).toHaveBeenCalledWith(60_000, expect.any(AbortSignal));
    expect(retries).toEqual(["Fake Model returned 429. Pausing for 60 seconds and retrying the same chunk."]);
    expect(rateLimiter.reduceActiveRpm).toHaveBeenCalledWith(0.5);
    expect(rateLimiter.recordFailure).toHaveBeenCalledTimes(1);
    expect(rateLimiter.recordSuccess).toHaveBeenCalledTimes(1);
  });

  it("slows to one request per minute after a second 429", async () => {
    const rateLimited = async (): Promise<RemoteCompletion> => {
      throw new Error("RESOURCE_EXHAUSTED");
    };
    const { provider, retries, sleep, rateLimiter } = setup([rateLimited, rateLimited, async () => ({ text: VALID_REPLY, usage })]);

    await provider.translateChunk(createRequest(), new AbortController().signal);

    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([60_000, 300_000]);
    expect(retries[1]).toContain("switching to one request per minute");
    expect(rateLimiter.forceOneRequestPerMinute).toHaveBeenCalledTimes(1);
  });

  it("does not retry other failures", async () => {
    const { provider, sleep } = setup([async () => ({ text: "not json", usage })]);

    await expect(provider.translateChunk(createRequest(), new AbortController().signal)).rejects.toThrow();
    expect(sleep).not.toHaveBeenCalled();
  });
});

function createRequest(): TranslationRequest {
  return {
    targetLanguage: "Bulgarian",
    style: "balanced",
    glossary: {},
    contextBefore: [],
    contextAfter: [],
    estimatedInputTokens: 100,
    targetLines: [{ id: 1, text: "Hello." }]
  };
}
