import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { estimateTextTokens, normalizeUsage, TokenUsage } from "../usage/TokenUsage";
import { TranslationResponseSchema } from "./PromptBuilder";
import { fallbackUsage } from "./ProviderRuntime";
import { RemoteTranslationProvider, type RemoteCompletion, type RemoteProviderOptions } from "./RemoteTranslationProvider";
import type { TranslationRequest } from "./TranslationProvider";

export interface GeminiProviderOptions extends RemoteProviderOptions {
  apiKey: string;
  temperature: number;
  maxOutputTokens: number;
  thinkingLevel: "minimal" | "low" | "medium" | "high";
}

export class GeminiTranslationProvider extends RemoteTranslationProvider {
  readonly name = "Gemini";
  private readonly client: GoogleGenAI;

  constructor(private readonly options: GeminiProviderOptions) {
    super(options, "Gemini");
    this.client = new GoogleGenAI({ apiKey: options.apiKey });
  }

  protected async complete(prompt: string, request: TranslationRequest, signal: AbortSignal): Promise<RemoteCompletion> {
    const response = await this.client.models.generateContent({
      model: this.options.model,
      contents: prompt,
      config: {
        abortSignal: signal,
        temperature: this.options.temperature,
        maxOutputTokens: this.options.maxOutputTokens,
        thinkingConfig: {
          thinkingLevel: toGeminiThinkingLevel(this.options.thinkingLevel)
        },
        responseMimeType: "application/json",
        responseSchema: TranslationResponseSchema
      }
    });

    signal.throwIfAborted();
    const text = extractGeneratedText(response);
    return { text, usage: extractGeminiUsage(response, request, text) };
  }
}

function extractGeneratedText(response: { text?: string }): string {
  const text = response.text ?? "";
  if (!text.trim()) {
    throw new Error("Gemini returned no text output.");
  }
  return text;
}

function toGeminiThinkingLevel(level: GeminiProviderOptions["thinkingLevel"]): ThinkingLevel {
  switch (level) {
    case "high":
      return ThinkingLevel.HIGH;
    case "medium":
      return ThinkingLevel.MEDIUM;
    case "low":
      return ThinkingLevel.LOW;
    default:
      return ThinkingLevel.MINIMAL;
  }
}

function extractGeminiUsage(
  response: {
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
      thoughtsTokenCount?: number;
    };
  },
  request: TranslationRequest,
  rawOutput: string
): TokenUsage {
  const usage = response.usageMetadata;
  if (!usage) {
    return fallbackUsage(request, rawOutput);
  }

  return normalizeUsage(
    usage.promptTokenCount ?? request.estimatedInputTokens,
    usage.candidatesTokenCount ?? estimateTextTokens(rawOutput),
    usage.totalTokenCount,
    usage.thoughtsTokenCount
  );
}
