import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiRateLimiter, settingsFromManualLimits } from "../src/core/rateLimit/GeminiRateLimiter";
import { GeminiTranslationProvider } from "../src/core/translation/GeminiTranslationProvider";
import type { TranslationRequest } from "../src/core/translation/TranslationProvider";

const mocks = vi.hoisted(() => ({
  generateContent: vi.fn()
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = {
      generateContent: mocks.generateContent
    };
  },
  ThinkingLevel: {
    MINIMAL: "MINIMAL",
    LOW: "LOW",
    MEDIUM: "MEDIUM",
    HIGH: "HIGH"
  }
}));

const generateContentMock = mocks.generateContent;

describe("GeminiTranslationProvider", () => {
  beforeEach(() => {
    generateContentMock.mockReset();
  });

  it("uses models.generateContent with structured JSON output", async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({
        translations: [{ id: 1, translation: "Здравей." }]
      })
    });

    const provider = new GeminiTranslationProvider({
      apiKey: "test-key",
      model: "gemini-3.1-flash-lite",
      temperature: 0.2,
      maxOutputTokens: 1024,
      thinkingLevel: "minimal",
      rateLimiter: new GeminiRateLimiter(settingsFromManualLimits(100, 1_000_000, 100, 1))
    });

    const result = await provider.translateChunk(createRequest(), new AbortController().signal);

    expect(result.translations[0].translation).toBe("Здравей.");
    expect(generateContentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-3.1-flash-lite",
        contents: expect.stringContaining("Data:"),
        config: expect.objectContaining({
          responseMimeType: "application/json",
          responseSchema: expect.objectContaining({
            type: "object"
          })
        })
      })
    );
  });

  it("passes high thinking through to Gemini", async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({
        translations: [{ id: 1, translation: "Здравей." }]
      })
    });

    const provider = new GeminiTranslationProvider({
      apiKey: "test-key",
      model: "gemini-3.5-flash-lite",
      temperature: 0.1,
      maxOutputTokens: 1024,
      thinkingLevel: "high",
      rateLimiter: new GeminiRateLimiter(settingsFromManualLimits(100, 1_000_000, 100, 1))
    });

    await provider.translateChunk(createRequest(), new AbortController().signal);

    expect(generateContentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          thinkingConfig: {
            thinkingLevel: "HIGH"
          }
        })
      })
    );
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
