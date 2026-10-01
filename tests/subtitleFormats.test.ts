import { describe, expect, it } from "vitest";
import { parseAss } from "../src/core/subtitle/AssParser";
import { parseWebVtt } from "../src/core/subtitle/WebVttParser";

describe("subtitle format parsers", () => {
  it("parses ASS dialogue and strips override tags", () => {
    const doc = parseAss(`[Script Info]
Title: Example

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.20,0:00:03.40,Default,,0,0,0,,{\\i1}Hello\\Nthere
`);

    expect(doc.cues).toHaveLength(1);
    expect(doc.cues[0].startTime).toBe("00:00:01,200");
    expect(doc.cues[0].endTime).toBe("00:00:03,400");
    expect(doc.cues[0].text).toBe("Hello\nthere");
  });

  it("parses WebVTT cues into SRT timestamps", () => {
    const doc = parseWebVtt(`WEBVTT

first
00:01.000 --> 00:03.000
Hello
`);

    expect(doc.cues).toHaveLength(1);
    expect(doc.cues[0].startTime).toBe("00:00:01,000");
    expect(doc.cues[0].endTime).toBe("00:00:03,000");
  });
});
