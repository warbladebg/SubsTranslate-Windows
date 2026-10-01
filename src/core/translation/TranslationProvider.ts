import { SubtitleChunk } from "../chunking/ChunkTypes";
import { SubtitleCue } from "../subtitle/SubtitleCue";
import type { TokenUsage } from "../usage/TokenUsage";

const MAX_CONTEXT_LINE_CHARS = 100;
const MAX_CONTEXT_TOTAL_CHARS = 320;

export interface Glossary {
  [source: string]: string;
}

export interface TranslationLine {
  id: number;
  text: string;
  sceneStart?: boolean;
}

export interface TranslationRequest {
  targetLanguage: string;
  style: string;
  glossary: Glossary;
  contextBefore: TranslationLine[];
  targetLines: TranslationLine[];
  contextAfter: TranslationLine[];
  estimatedInputTokens: number;
  chunkId?: number;
  chunkIndex?: number;
  cacheKey?: string;
}

export interface TranslationEntry {
  id: number;
  translation: string;
}

export interface TranslationResult {
  translations: TranslationEntry[];
  warnings: string[];
}

export interface TranslationProvider {
  name: string;
  translateChunk(request: TranslationRequest, signal: AbortSignal): Promise<TranslationResult>;
}

export interface ModelExchangeAudit {
  provider: string;
  model: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: "success" | "failed";
  chunkId?: number;
  chunkIndex?: number;
  request: TranslationRequest;
  prompt: string;
  rawOutput?: string;
  parsedOutput?: TranslationResult;
  usage: TokenUsage;
  error?: string;
}

export type ModelExchangeRecorder = (exchange: ModelExchangeAudit) => void | Promise<void>;

export interface RequestFromChunkOptions {
  targetLanguage?: string;
  glossary?: Glossary;
  style?: string;
}

export function requestFromChunk(
  chunk: SubtitleChunk,
  options: RequestFromChunkOptions = {}
): TranslationRequest {
  return {
    targetLanguage: options.targetLanguage ?? "Bulgarian",
    style: options.style ?? "natural Bulgarian subtitles, concise, suitable for TV dialogue",
    glossary: options.glossary ?? {},
    contextBefore: compactContextLines(toLines(chunk.contextBefore)),
    targetLines: toLines(chunk.cues, new Set(chunk.sceneBreakCueIds)),
    contextAfter: compactContextLines(toLines(chunk.contextAfter)),
    estimatedInputTokens: chunk.estimatedInputTokens
  };
}

function toLines(cues: SubtitleCue[], sceneBreakCueIds: Set<number> = new Set()): TranslationLine[] {
  return cues.map((cue) => ({
    id: cue.id,
    text: cue.text,
    ...(sceneBreakCueIds.has(cue.id) ? { sceneStart: true } : {})
  }));
}

export function compactContextLines(lines: TranslationLine[]): TranslationLine[] {
  let usedChars = 0;
  const compacted: TranslationLine[] = [];

  for (const line of lines) {
    const text = compactContextText(line.text);
    if (!text) {
      continue;
    }

    const remainingChars = MAX_CONTEXT_TOTAL_CHARS - usedChars;
    if (remainingChars <= 0) {
      break;
    }

    const boundedText = text.length > remainingChars ? truncateText(text, remainingChars) : text;
    compacted.push({ id: line.id, text: boundedText });
    usedChars += boundedText.length;
  }

  return compacted;
}

function compactContextText(text: string): string {
  return truncateText(text.replace(/\s+/g, " ").trim(), MAX_CONTEXT_LINE_CHARS);
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  if (maxChars <= 3) {
    return text.slice(0, maxChars);
  }

  return `${text.slice(0, maxChars - 3).trimEnd()}...`;
}
