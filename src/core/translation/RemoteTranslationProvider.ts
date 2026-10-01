import { GeminiRateLimiter, isResourceExhaustedError } from "../rateLimit/GeminiRateLimiter";
import type { TokenUsage } from "../usage/TokenUsage";
import { errorMessage } from "../util/errors";
import { buildTranslationPrompt } from "./PromptBuilder";
import { fallbackUsage, sleepWithAbort } from "./ProviderRuntime";
import type { ModelExchangeRecorder, TranslationProvider, TranslationRequest, TranslationResult } from "./TranslationProvider";
import { validateTranslationResult } from "./TranslationValidator";

export interface RemoteProviderOptions {
  model: string;
  rateLimiter: GeminiRateLimiter;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  onRetry?: (message: string) => void;
  onExchange?: ModelExchangeRecorder;
}

/** One model reply: the generated JSON text and the tokens it cost. */
export interface RemoteCompletion {
  text: string;
  usage: TokenUsage;
}

/** An error reply whose body is worth keeping in the audit log. */
export class RemoteResponseError extends Error {
  constructor(message: string, readonly rawOutput: string) {
    super(message);
  }
}

interface ExchangeOutcome {
  rawOutput?: string;
  parsedOutput?: TranslationResult;
  usage: TokenUsage;
  status: "success" | "failed";
  error?: string;
}

/**
 * The pipeline every hosted model shares: wait for a rate-limit slot, build the prompt,
 * validate the reply, record the exchange for auditing, and back off on HTTP 429.
 * Subclasses only send the prompt and return the model's text.
 */
export abstract class RemoteTranslationProvider implements TranslationProvider {
  abstract readonly name: string;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;

  protected constructor(private readonly runtime: RemoteProviderOptions, sleepLabel: string) {
    this.sleep = runtime.sleep ?? ((ms, signal) => sleepWithAbort(sleepLabel, ms, signal));
  }

  protected abstract complete(prompt: string, request: TranslationRequest, signal: AbortSignal): Promise<RemoteCompletion>;

  async translateChunk(request: TranslationRequest, signal: AbortSignal): Promise<TranslationResult> {
    const { rateLimiter, onRetry } = this.runtime;
    try {
      return await this.callModel(request, signal);
    } catch (error) {
      if (!isResourceExhaustedError(error)) {
        throw error;
      }

      rateLimiter.reduceActiveRpm(0.5);
      onRetry?.(`${this.name} returned 429. Pausing for 60 seconds and retrying the same chunk.`);
      await this.sleep(60_000, signal);

      try {
        return await this.callModel(request, signal);
      } catch (secondError) {
        if (!isResourceExhaustedError(secondError)) {
          throw secondError;
        }

        rateLimiter.forceOneRequestPerMinute();
        onRetry?.(`${this.name} returned another 429. Pausing for 5 minutes and switching to one request per minute.`);
        await this.sleep(300_000, signal);
        return this.callModel(request, signal);
      }
    }
  }

  private async callModel(request: TranslationRequest, signal: AbortSignal): Promise<TranslationResult> {
    await this.runtime.rateLimiter.waitForSlot(request.estimatedInputTokens, signal);
    const prompt = buildTranslationPrompt(request);
    const startedAtMs = Date.now();
    let rawOutput: string | undefined;

    try {
      const completion = await this.complete(prompt, request, signal);
      rawOutput = completion.text;
      const result = validateTranslationResult(JSON.parse(rawOutput), request);
      this.runtime.rateLimiter.recordSuccess();
      await this.recordExchange(startedAtMs, request, prompt, {
        rawOutput,
        parsedOutput: result,
        usage: completion.usage,
        status: "success"
      });
      return result;
    } catch (error) {
      rawOutput ??= error instanceof RemoteResponseError ? error.rawOutput : undefined;
      this.runtime.rateLimiter.recordFailure(error);
      await this.recordExchange(startedAtMs, request, prompt, {
        rawOutput,
        usage: fallbackUsage(request, rawOutput),
        status: "failed",
        error: errorMessage(error)
      });
      throw error;
    }
  }

  private async recordExchange(
    startedAtMs: number,
    request: TranslationRequest,
    prompt: string,
    outcome: ExchangeOutcome
  ): Promise<void> {
    try {
      await this.runtime.onExchange?.({
        provider: this.name,
        model: this.runtime.model,
        startedAt: new Date(startedAtMs).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAtMs,
        chunkId: request.chunkId,
        chunkIndex: request.chunkIndex,
        request,
        prompt,
        ...outcome
      });
    } catch {
      // Translation should continue even if local audit logging fails.
    }
  }
}
