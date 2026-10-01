export type UsageProviderId = "mock" | "gemini" | "vercel";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  thinkingTokens?: number;
}

export interface ModelPricing {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  source: string;
}

const pricingByModel = new Map<string, ModelPricing>([
  [
    "gemini-3.5-flash-lite",
    {
      inputUsdPerMillion: 0.3,
      outputUsdPerMillion: 2.5,
      source: "Google Gemini API list price"
    }
  ],
  [
    "google/gemini-3.5-flash-lite",
    {
      inputUsdPerMillion: 0.3,
      outputUsdPerMillion: 2.5,
      source: "Vercel AI Gateway zero-markup provider list price"
    }
  ],
  [
    "gemini-3.1-flash-lite",
    {
      inputUsdPerMillion: 0.25,
      outputUsdPerMillion: 1.5,
      source: "Google Gemini API list price"
    }
  ],
  [
    "google/gemini-3.1-flash-lite",
    {
      inputUsdPerMillion: 0.25,
      outputUsdPerMillion: 1.5,
      source: "Vercel AI Gateway zero-markup provider list price"
    }
  ]
]);

export function emptyTokenUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0
  };
}

export function addTokenUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  const thinkingTokens =
    left.thinkingTokens !== undefined || right.thinkingTokens !== undefined
      ? (left.thinkingTokens ?? 0) + (right.thinkingTokens ?? 0)
      : undefined;

  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    thinkingTokens
  };
}

export function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function normalizeUsage(inputTokens = 0, outputTokens = 0, totalTokens?: number, thinkingTokens?: number): TokenUsage {
  return {
    inputTokens: Math.max(0, Math.round(inputTokens)),
    outputTokens: Math.max(0, Math.round(outputTokens)),
    totalTokens: Math.max(0, Math.round(totalTokens ?? inputTokens + outputTokens)),
    thinkingTokens: thinkingTokens === undefined ? undefined : Math.max(0, Math.round(thinkingTokens))
  };
}

export function estimateCostUsd(providerId: UsageProviderId, modelId: string, usage: TokenUsage): number | undefined {
  const pricing = getModelPricing(providerId, modelId);
  if (!pricing) {
    return undefined;
  }

  const billableOutputTokens = usage.outputTokens + (usage.thinkingTokens ?? 0);
  return (usage.inputTokens / 1_000_000) * pricing.inputUsdPerMillion
    + (billableOutputTokens / 1_000_000) * pricing.outputUsdPerMillion;
}

export function getModelPricing(_providerId: UsageProviderId, modelId: string): ModelPricing | undefined {
  return pricingByModel.get(modelId);
}
