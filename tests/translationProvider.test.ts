import { describe, expect, it } from "vitest";
import { compactContextLines, requestFromChunk } from "../src/core/translation/TranslationProvider";

describe("translation provider request shaping", () => {
  it("compacts surrounding context without removing cue identity", () => {
    const compacted = compactContextLines([
      {
        id: 10,
        text: `  ${"This neighboring subtitle line is intentionally long. ".repeat(8)}  `
      }
    ]);

    expect(compacted).toHaveLength(1);
    expect(compacted[0].id).toBe(10);
    expect(compacted[0].text.length).toBeLessThanOrEqual(100);
    expect(compacted[0].text).toMatch(/\.\.\.$/);
    expect(compacted[0].text).not.toMatch(/\s{2,}/);
  });

  it("carries explicit translation style into chunk requests", () => {
    const request = requestFromChunk(
      {
        id: 1,
        sceneId: 1,
        sceneBreakCueIds: [],
        cues: [
          {
            id: 7,
            originalIndex: 7,
            startMs: 0,
            endMs: 1000,
            startTime: "00:00:00,000",
            endTime: "00:00:01,000",
            text: "Hello."
          }
        ],
        contextBefore: [],
        contextAfter: [],
        estimatedInputTokens: 2
      },
      {
        targetLanguage: "Bulgarian",
        style: "careful Bulgarian subtitles"
      }
    );

    expect(request.style).toBe("careful Bulgarian subtitles");
    expect(request.targetLines).toEqual([{ id: 7, text: "Hello." }]);
  });
});
