import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiRateLimiter, settingsFromManualLimits } from "../src/core/rateLimit/GeminiRateLimiter";
import { VercelTranslationProvider } from "../src/core/translation/VercelTranslationProvider";
import type { TranslationRequest } from "../src/core/translation/TranslationProvider";

describe("VercelTranslationProvider", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("uses Vercel AI Gateway chat completions with the configured model", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                translations: [{ id: 1, translation: "Здравей." }]
              })
            }
          }
        ]
      })
    });

    const provider = new VercelTranslationProvider({
      apiKey: "gateway-key",
      model: "google/gemini-3.1-flash-lite",
      temperature: 0.2,
      maxOutputTokens: 1024,
      rateLimiter: new GeminiRateLimiter(settingsFromManualLimits(100, 1_000_000, 100, 1)),
      fetchImpl: fetchMock as unknown as typeof fetch
    });

    const result = await provider.translateChunk(createRequest(), new AbortController().signal);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      model: string;
      response_format: { type: string };
      messages: Array<{ content: string }>;
    };

    expect(result.translations[0].translation).toBe("Здравей.");
    expect(url).toBe("https://ai-gateway.vercel.sh/v1/chat/completions");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer gateway-key",
      "Content-Type": "application/json"
    });
    expect(body.model).toBe("google/gemini-3.1-flash-lite");
    expect(body.response_format.type).toBe("json_schema");
    expect(body.messages[0].content).toContain("Data:");
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
    targetLines: [
      {
        id: 1,
        text: "Hello."
      }
    ]
  };
}
