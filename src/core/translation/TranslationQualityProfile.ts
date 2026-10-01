export type TranslationQuality = "fast" | "balanced" | "best";
export type TranslationThinkingLevel = "minimal" | "low" | "medium" | "high";

export interface TranslationQualityProfile {
  contextCueCount: number;
  maxCueCount: number;
  maxCharacters: number;
  maxScenesPerChunk: number;
  style: string;
}

const QUALITY_PROFILES: Record<TranslationQuality, TranslationQualityProfile> = {
  fast: {
    contextCueCount: 2,
    maxCueCount: 100,
    maxCharacters: 7000,
    maxScenesPerChunk: 16,
    style: "fast Bulgarian subtitles, concise, preserve meaning, avoid over-polishing"
  },
  balanced: {
    contextCueCount: 4,
    maxCueCount: 80,
    maxCharacters: 5000,
    maxScenesPerChunk: 12,
    style: "careful, idiomatic Bulgarian TV dialogue with correct spelling, grammar and consistent terminology"
  },
  best: {
    contextCueCount: 6,
    maxCueCount: 80,
    maxCharacters: 5000,
    maxScenesPerChunk: 12,
    style: "careful, idiomatic Bulgarian TV dialogue with correct spelling, grammar and consistent terminology"
  }
};

export function getTranslationQualityProfile(quality: TranslationQuality): TranslationQualityProfile {
  return QUALITY_PROFILES[quality] ?? QUALITY_PROFILES.balanced;
}

export function getAutomaticTranslationThinkingLevel(
  _quality: TranslationQuality
): TranslationThinkingLevel {
  return "minimal";
}
