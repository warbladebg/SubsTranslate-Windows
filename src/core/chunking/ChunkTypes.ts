import { SubtitleCue } from "../subtitle/SubtitleCue";

export interface SubtitleChunk {
  id: number;
  sceneId: number;
  sceneBreakCueIds: number[];
  cues: SubtitleCue[];
  contextBefore: SubtitleCue[];
  contextAfter: SubtitleCue[];
  estimatedInputTokens: number;
}

export interface SceneChunkerOptions {
  sceneGapMs: number;
  maxCueCount: number;
  maxCharacters: number;
  maxScenesPerChunk: number;
  contextCueCount: number;
}

export const defaultSceneChunkerOptions: SceneChunkerOptions = {
  sceneGapMs: 5000,
  maxCueCount: 80,
  maxCharacters: 5000,
  maxScenesPerChunk: 4,
  contextCueCount: 4
};
