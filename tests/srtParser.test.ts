import { describe, expect, it } from "vitest";
import { parseSrt } from "../src/core/subtitle/SrtParser";
import { writeSrt } from "../src/core/subtitle/SrtWriter";

describe("SRT parser and writer", () => {
  it("preserves cue count and exact timestamps while writing sequential cue numbers", () => {
    const document = parseSrt(`12
00:00:01,000 --> 00:00:03,500
Hello there.

15
00:00:04,000 --> 00:00:05,000
OK
`);

    expect(document.cues).toHaveLength(2);
    expect(document.cues[0].startTime).toBe("00:00:01,000");
    expect(document.cues[0].endTime).toBe("00:00:03,500");

    const output = writeSrt(
      document.cues.map((cue) => ({ ...cue, text: `[BG] ${cue.text}` })),
      { rewrap: false }
    );

    expect(output).toContain("1\n00:00:01,000 --> 00:00:03,500");
    expect(output).toContain("2\n00:00:04,000 --> 00:00:05,000");
    expect(output).not.toContain("12\n00:00:01,000");
  });
});
