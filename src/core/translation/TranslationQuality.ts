export const UNREADABLE_SUBTITLE_PLACEHOLDER = "[неразчетим субтитър]";

const CYRILLIC_PATTERN = /[\u0400-\u04FF]/gu;
const LATIN_PATTERN = /[A-Za-z]/g;
const LETTER_PATTERN = /\p{L}/gu;
const WORD_PATTERN = /[\p{L}\p{N}]{2,}/gu;
const LATIN_WORD_PATTERN = /[A-Za-z][A-Za-z0-9']*/g;
const MIXED_ALNUM_WORD_PATTERN = /\b(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{4,}\b/;
const OCR_JUNK_PATTERN = /(?:[=_—-]\s*){5,}|[¥£#\\|]{2,}|(?:\b[A-Z]{1,3}\b\s*){5,}/u;
const SHORT_ALLOWED_LATIN_PATTERN = /^[\d\s.,!?;:'"()[\]{}\-–—…/\\&%+*#@A-Za-z]+$/;
const COMMON_ENGLISH_WORDS = new Set([
  "a",
  "about",
  "after",
  "all",
  "am",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "can",
  "come",
  "could",
  "did",
  "do",
  "does",
  "down",
  "for",
  "from",
  "get",
  "go",
  "going",
  "got",
  "had",
  "has",
  "have",
  "he",
  "her",
  "here",
  "him",
  "his",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "just",
  "know",
  "let",
  "like",
  "look",
  "make",
  "me",
  "mr",
  "my",
  "no",
  "not",
  "now",
  "of",
  "off",
  "oh",
  "ok",
  "okay",
  "on",
  "one",
  "or",
  "out",
  "right",
  "said",
  "see",
  "she",
  "sir",
  "so",
  "some",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "they",
  "this",
  "to",
  "up",
  "us",
  "want",
  "was",
  "we",
  "well",
  "were",
  "what",
  "when",
  "where",
  "who",
  "why",
  "will",
  "with",
  "would",
  "yeah",
  "yes",
  "you",
  "your"
]);

export function looksLikeUnreadableTranslation(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  const latinLetters = countMatches(trimmed, LATIN_PATTERN);
  const cyrillicLetters = countMatches(trimmed, CYRILLIC_PATTERN);
  const totalLetters = countMatches(trimmed, LETTER_PATTERN);
  const words = countMatches(trimmed, WORD_PATTERN);

  if (OCR_JUNK_PATTERN.test(trimmed) || MIXED_ALNUM_WORD_PATTERN.test(trimmed)) {
    return true;
  }

  if (latinLetters <= 2 && SHORT_ALLOWED_LATIN_PATTERN.test(trimmed)) {
    return false;
  }

  if (cyrillicLetters === 0 && isLikelyAllowedLatinCue(trimmed)) {
    return false;
  }

  if (cyrillicLetters > 0 && latinLetters > 0 && hasOnlyAllowedEmbeddedLatin(trimmed)) {
    return false;
  }

  if (latinLetters >= 10 && cyrillicLetters === 0 && words >= 2) {
    return true;
  }

  if (latinLetters >= 8 && latinLetters > cyrillicLetters) {
    return true;
  }

  if (totalLetters >= 8 && cyrillicLetters === 0 && !SHORT_ALLOWED_LATIN_PATTERN.test(trimmed)) {
    return true;
  }

  return false;
}

export function looksLikeUnreadableSource(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  const latinLetters = countMatches(trimmed, LATIN_PATTERN);
  const words = getLatinWords(trimmed);
  const badShortFragments = words.filter((word) => word.length <= 2 && !COMMON_ENGLISH_WORDS.has(word.toLowerCase())).length;
  const knownWords = words.filter((word) => COMMON_ENGLISH_WORDS.has(word.toLowerCase())).length;
  const unknownRatio = words.length === 0 ? 0 : (words.length - knownWords) / words.length;

  return (
    OCR_JUNK_PATTERN.test(trimmed) ||
    MIXED_ALNUM_WORD_PATTERN.test(trimmed) ||
    /[\\¥£#=]/.test(trimmed) ||
    (latinLetters >= 14 && words.length >= 3 && badShortFragments > 0 && unknownRatio >= 0.5) ||
    (latinLetters >= 18 && words.length >= 4 && unknownRatio >= 0.7 && !isLikelyAllowedLatinCue(trimmed))
  );
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function getLatinWords(text: string): string[] {
  return text.match(LATIN_WORD_PATTERN) ?? [];
}

function hasOnlyAllowedEmbeddedLatin(text: string): boolean {
  const latinWords = getLatinWords(text);
  return latinWords.length > 0 && latinWords.length <= 3 && latinWords.every(isNameAcronymOrRoman);
}

function isLikelyAllowedLatinCue(text: string): boolean {
  const latinWords = getLatinWords(text);
  return latinWords.length > 0 && latinWords.length <= 5 && latinWords.every(isNameAcronymOrRoman);
}

function isNameAcronymOrRoman(word: string): boolean {
  return /^[A-Z][a-z]+(?:'[A-Za-z]+)?$/.test(word) || /^[A-Z]{2,6}$/.test(word) || /^[IVXLCDM]+$/i.test(word);
}
