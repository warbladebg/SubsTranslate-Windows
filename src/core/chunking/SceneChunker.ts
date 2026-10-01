import { SubtitleCue } from "../subtitle/SubtitleCue";
import { defaultSceneChunkerOptions, SceneChunkerOptions, SubtitleChunk } from "./ChunkTypes";

const STRONG_SEGMENT_PATTERN = /\b(credits|previously on|commercial break|title card|song:|sign:|caption:)\b/i;
const STRUCTURAL_SCENE_PATTERN = /\b(previously on|opening credits|end credits|commercial break|title card)\b/i;
const MIN_ADAPTIVE_SCENE_GAP_MS = 2500;

interface Scene {
  id: number;
  cues: SubtitleCue[];
}

interface ScenePosition {
  scene: Scene;
  index: number;
}

export function createSceneChunks(
  cues: SubtitleCue[],
  options: Partial<SceneChunkerOptions> = {}
): SubtitleChunk[] {
  const resolved = { ...defaultSceneChunkerOptions, ...options };
  const scenes = splitIntoScenes(cues, resolved.sceneGapMs);
  const chunks: SubtitleChunk[] = [];
  const sceneByCueId = new Map<number, ScenePosition>();
  const sceneStartCueIds = new Set<number>();
  for (const scene of scenes) {
    sceneStartCueIds.add(scene.cues[0].id);
    for (const [index, cue] of scene.cues.entries()) {
      // Preserve the first position within the last scene containing this ID.
      if (sceneByCueId.get(cue.id)?.scene !== scene) {
        sceneByCueId.set(cue.id, { scene, index });
      }
    }
  }

  let current: SubtitleCue[] = [];
  let characterCount = 0;
  let sceneCount = 0;
  for (const cue of cues) {
    const cueLength = cue.text.length;
    const startsScene = sceneStartCueIds.has(cue.id);
    const shouldStartNewChunk =
      current.length > 0 &&
      (current.length >= resolved.maxCueCount ||
        characterCount + cueLength > resolved.maxCharacters ||
        (startsScene && sceneCount >= resolved.maxScenesPerChunk) ||
        STRONG_SEGMENT_PATTERN.test(cue.text));

    if (shouldStartNewChunk) {
      chunks.push(
        buildChunk(chunks.length + 1, current, sceneByCueId, sceneStartCueIds, resolved.contextCueCount)
      );
      current = [];
      characterCount = 0;
      sceneCount = 0;
    }

    if (current.length === 0) {
      sceneCount = 1;
    } else if (startsScene) {
      sceneCount += 1;
    }
    current.push(cue);
    characterCount += cueLength;
  }

  if (current.length > 0) {
    chunks.push(buildChunk(chunks.length + 1, current, sceneByCueId, sceneStartCueIds, resolved.contextCueCount));
  }

  return chunks;
}

export function splitIntoScenes(cues: SubtitleCue[], sceneGapMs = defaultSceneChunkerOptions.sceneGapMs): Scene[] {
  const scenes: Scene[] = [];
  let current: SubtitleCue[] = [];
  const adaptiveGapMs = calculateAdaptiveSceneGap(cues, sceneGapMs);
  const hardGapMs = Math.max(sceneGapMs * 2, 12_000);

  cues.forEach((cue, index) => {
    const previous = cues[index - 1];
    const gap = previous ? cue.startMs - previous.endMs : 0;
    const startsNewScene =
      index > 0 &&
      (STRUCTURAL_SCENE_PATTERN.test(cue.text) ||
        gap >= hardGapMs ||
        (gap > sceneGapMs && !isLikelySentenceContinuation(previous.text, cue.text)) ||
        (gap >= adaptiveGapMs && hasTextualBoundaryEvidence(previous.text, cue.text)));

    if (startsNewScene && current.length > 0) {
      scenes.push({ id: scenes.length + 1, cues: current });
      current = [];
    }

    current.push(cue);
  });

  if (current.length > 0) {
    scenes.push({ id: scenes.length + 1, cues: current });
  }

  return scenes;
}

function buildChunk(
  id: number,
  cues: SubtitleCue[],
  sceneByCueId: Map<number, ScenePosition>,
  sceneStartCueIds: Set<number>,
  contextCueCount: number
): SubtitleChunk {
  const first = sceneByCueId.get(cues[0].id);
  const last = sceneByCueId.get(cues[cues.length - 1].id);
  if (!first || !last) {
    throw new Error("Cannot build a subtitle chunk without scene metadata.");
  }

  const contextBefore = first.scene.cues.slice(Math.max(0, first.index - contextCueCount), first.index);
  const contextAfter = last.scene.cues.slice(last.index + 1, last.index + 1 + contextCueCount);
  const estimatedInputTokens = estimateTokens([...contextBefore, ...cues, ...contextAfter]);

  return {
    id,
    sceneId: first.scene.id,
    sceneBreakCueIds: cues.slice(1).filter((cue) => sceneStartCueIds.has(cue.id)).map((cue) => cue.id),
    cues,
    contextBefore,
    contextAfter,
    estimatedInputTokens
  };
}

function calculateAdaptiveSceneGap(cues: SubtitleCue[], configuredGapMs: number): number {
  const ordinaryGaps = cues
    .slice(1)
    .map((cue, index) => cue.startMs - cues[index].endMs)
    .filter((gap) => gap > 0 && gap <= configuredGapMs)
    .sort((left, right) => left - right);
  if (ordinaryGaps.length === 0) {
    return configuredGapMs;
  }

  const middle = Math.floor(ordinaryGaps.length / 2);
  const median =
    ordinaryGaps.length % 2 === 0
      ? (ordinaryGaps[middle - 1] + ordinaryGaps[middle]) / 2
      : ordinaryGaps[middle];
  return Math.min(configuredGapMs, Math.max(MIN_ADAPTIVE_SCENE_GAP_MS, median * 6));
}

function isLikelySentenceContinuation(previous: string, current: string): boolean {
  const previousText = previous.trim();
  const currentText = current.trim().replace(/^[-–—]\s*/, "");
  return /[,;:–—-]$/.test(previousText) || /^[a-z]/.test(currentText);
}

function hasTextualBoundaryEvidence(previous: string, current: string): boolean {
  const previousText = previous.trim();
  const currentText = current.trim();
  const previousLooksComplete = /[.!?]["'’”)]?$/.test(previousText);
  const currentLooksLikeFreshUtterance = /^(?:[-–—]\s*)?[A-Z0-9[]/.test(currentText);
  return previousLooksComplete && currentLooksLikeFreshUtterance && !isLikelySentenceContinuation(previous, current);
}

export function estimateTokens(cues: SubtitleCue[]): number {
  const chars = cues.reduce((total, cue) => total + cue.text.length, 0);
  return Math.max(1, Math.ceil(chars / 4));
}
