import { describe, expect, it } from "vitest";
import { createSceneChunks } from "../src/core/chunking/SceneChunker";
import { SubtitleCue } from "../src/core/subtitle/SubtitleCue";

describe("scene-aware chunker", () => {
  it("batches short scenes while marking context resets", () => {
    const cues: SubtitleCue[] = [
      cue(1, 0, 1000, "A"),
      cue(2, 1200, 2000, "B"),
      cue(3, 9000, 10_000, "C"),
      cue(4, 10_100, 11_000, "D")
    ];

    const chunks = createSceneChunks(cues, { sceneGapMs: 5000, maxCueCount: 10, maxCharacters: 200, contextCueCount: 2 });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].cues.map((item) => item.id)).toEqual([1, 2, 3, 4]);
    expect(chunks[0].sceneBreakCueIds).toEqual([3]);
    expect(chunks[0].contextBefore).toHaveLength(0);
    expect(chunks[0].contextAfter).toHaveLength(0);
  });

  it("splits large scenes into bounded chunks", () => {
    const cues = Array.from({ length: 6 }, (_, index) => cue(index + 1, index * 1000, index * 1000 + 500, "Text"));
    const chunks = createSceneChunks(cues, { maxCueCount: 2, maxCharacters: 200, sceneGapMs: 5000, contextCueCount: 1 });

    expect(chunks).toHaveLength(3);
    expect(chunks[0].sceneBreakCueIds).toEqual([]);
    expect(chunks[1].contextBefore.map((item) => item.id)).toEqual([2]);
    expect(chunks[1].contextAfter.map((item) => item.id)).toEqual([5]);
  });

  it("detects shorter likely cuts but keeps a split sentence together", () => {
    const cues: SubtitleCue[] = [
      cue(1, 0, 900, "One."),
      cue(2, 1000, 1900, "Two."),
      cue(3, 2000, 2900, "Three."),
      cue(4, 3000, 3900, "Four."),
      cue(5, 4000, 4900, "The meeting is over."),
      cue(6, 7800, 8700, "Where are we going?"),
      cue(7, 9000, 10_000, "I need you to"),
      cue(8, 17_000, 18_000, "finish this."),
      cue(9, 32_000, 33_000, "A hard reset")
    ];

    const chunks = createSceneChunks(cues, {
      sceneGapMs: 5000,
      maxCueCount: 20,
      maxCharacters: 500,
      contextCueCount: 2
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].sceneBreakCueIds).toEqual([6, 9]);
  });

  it("limits how many detected scenes are packed into one model request", () => {
    const cues = Array.from({ length: 8 }, (_, index) =>
      cue(index + 1, index * 20_000, index * 20_000 + 1000, `Scene ${index + 1}.`)
    );

    const chunks = createSceneChunks(cues, {
      sceneGapMs: 5000,
      maxCueCount: 100,
      maxCharacters: 5000,
      maxScenesPerChunk: 4,
      contextCueCount: 2
    });

    expect(chunks).toHaveLength(2);
    expect(chunks[0].cues.map((item) => item.id)).toEqual([1, 2, 3, 4]);
    expect(chunks[0].sceneBreakCueIds).toEqual([2, 3, 4]);
    expect(chunks[1].cues.map((item) => item.id)).toEqual([5, 6, 7, 8]);
    expect(chunks[1].sceneBreakCueIds).toEqual([6, 7, 8]);
  });
});

function cue(id: number, startMs: number, endMs: number, text: string): SubtitleCue {
  return {
    id,
    originalIndex: id,
    startMs,
    endMs,
    startTime: `00:00:${String(Math.floor(startMs / 1000)).padStart(2, "0")},000`,
    endTime: `00:00:${String(Math.floor(endMs / 1000)).padStart(2, "0")},000`,
    text
  };
}
