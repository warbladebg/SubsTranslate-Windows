import { estimateTextTokens, normalizeUsage, TokenUsage } from "../usage/TokenUsage";
import { TranslationRequest } from "./TranslationProvider";
import { abortableDelay } from "../async/abortableDelay";

export function sleepWithAbort(label: string, ms: number, signal: AbortSignal): Promise<void> {
  return abortableDelay(ms, signal, `${label} wait cancelled.`);
}

export function fallbackUsage(request: TranslationRequest, rawOutput = ""): TokenUsage {
  return normalizeUsage(request.estimatedInputTokens, rawOutput ? estimateTextTokens(rawOutput) : 0);
}
