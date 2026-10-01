import { estimateTextTokens, normalizeUsage, TokenUsage } from "../usage/TokenUsage";
import { TranslationResponseSchema } from "./PromptBuilder";
import { fallbackUsage } from "./ProviderRuntime";
import {
  RemoteResponseError,
  RemoteTranslationProvider,
  type RemoteCompletion,
  type RemoteProviderOptions
} from "./RemoteTranslationProvider";
import type { TranslationRequest } from "./TranslationProvider";

const VERCEL_AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";

export interface VercelProviderOptions extends RemoteProviderOptions {
  apiKey: string;
  temperature: number;
  maxOutputTokens: number;
  fetchImpl?: typeof fetch;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export class VercelTranslationProvider extends RemoteTranslationProvider {
  readonly name = "Vercel AI Gateway";
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: VercelProviderOptions) {
    super(options, "Vercel");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  protected async complete(prompt: string, request: TranslationRequest, signal: AbortSignal): Promise<RemoteCompletion> {
    const response = await this.fetchImpl(`${VERCEL_AI_GATEWAY_BASE_URL}/chat/completions`, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.options.model,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: this.options.temperature,
        max_tokens: this.options.maxOutputTokens,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "translation_response",
            schema: TranslationResponseSchema
          }
        }
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new RemoteResponseError(`Vercel AI Gateway request failed with ${response.status}: ${errorBody}`, errorBody);
    }

    signal.throwIfAborted();
    const body = (await response.json()) as ChatCompletionResponse;
    const text = extractChoiceText(body);
    return { text, usage: extractVercelUsage(body, request, text) };
  }
}

function extractChoiceText(response: ChatCompletionResponse): string {
  const text = response.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) {
    throw new Error("Vercel AI Gateway returned no text output.");
  }
  return text;
}

function extractVercelUsage(body: ChatCompletionResponse, request: TranslationRequest, rawOutput: string): TokenUsage {
  if (!body.usage) {
    return fallbackUsage(request, rawOutput);
  }

  return normalizeUsage(
    body.usage.prompt_tokens ?? request.estimatedInputTokens,
    body.usage.completion_tokens ?? estimateTextTokens(rawOutput),
    body.usage.total_tokens
  );
}
