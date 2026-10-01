import { TranslationRequest, TranslationResult } from "./TranslationProvider";
import { looksLikeUnreadableTranslation } from "./TranslationQuality";

const CYRILLIC_PATTERN = /[\u0400-\u04FF]/;
const NON_CYRILLIC_ONLY_PATTERN = /^[\d\s.,!?;:'"()[\]{}\-–—…/\\&%+*#@A-Za-z]+$/;

export function validateTranslationResult(raw: unknown, request?: TranslationRequest): TranslationResult {
  if (!raw || typeof raw !== "object") {
    throw new Error("Translation response must be an object.");
  }

  const translations = (raw as { translations?: unknown }).translations;
  if (!Array.isArray(translations)) {
    throw new Error("Translation response must include a translations array.");
  }

  const normalized = translations.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("Every translation entry must be an object.");
    }

    const id = (entry as { id?: unknown }).id;
    const translation = (entry as { translation?: unknown }).translation;
    if (typeof id !== "number" || !Number.isFinite(id)) {
      throw new Error("Every translation entry must include a numeric id.");
    }
    if (typeof translation !== "string") {
      throw new Error(`Translation ${id} must include a string translation.`);
    }
    return { id, translation };
  });

  const warnings: string[] = [];

  if (request) {
    const requestedLines = new Map<number, TranslationRequest["targetLines"][number]>();
    for (const line of request.targetLines) {
      if (!requestedLines.has(line.id)) requestedLines.set(line.id, line);
    }
    const seen = new Set<number>();

    for (const entry of normalized) {
      if (!requestedLines.has(entry.id)) {
        throw new Error(`Unexpected translation id ${entry.id}.`);
      }
      if (seen.has(entry.id)) {
        throw new Error(`Duplicate translation id ${entry.id}.`);
      }
      seen.add(entry.id);

      const original = requestedLines.get(entry.id);
      if (original?.text.trim() && !entry.translation.trim()) {
        throw new Error(`Translation ${entry.id} is empty.`);
      }

      if (looksLikeUnreadableTranslation(entry.translation)) {
        throw new Error(`Translation ${entry.id} looks unreadable.`);
      }

      if (entry.translation.trim() && !CYRILLIC_PATTERN.test(entry.translation) && !NON_CYRILLIC_ONLY_PATTERN.test(entry.translation)) {
        warnings.push(`Translation ${entry.id} has no Cyrillic characters.`);
      }
    }

    for (const id of requestedLines.keys()) {
      if (!seen.has(id)) {
        throw new Error(`Missing translation id ${id}.`);
      }
    }
  }

  return { translations: normalized, warnings };
}
