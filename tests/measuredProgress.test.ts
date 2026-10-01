import { describe, expect, it } from "vitest";
import { measuredWorkProgress, parseFfmpegProgressLine } from "../src/core/media/MeasuredProgress";

describe("measured progress", () => {
  it("advances during FFmpeg processing using elapsed output time", () => {
    expect(parseFfmpegProgressLine("out_time_us=25000000", 100)).toBe(24.8);
    expect(parseFfmpegProgressLine("out_time_ms=50000000", 100)).toBe(49.5);
    expect(parseFfmpegProgressLine("out_time=00:01:15.000", 100)).toBe(74.3);
    expect(parseFfmpegProgressLine("progress=end", 100)).toBe(99);
  });
  it("rejects missing duration and invalid FFmpeg timestamps", () => {
    for (const line of ["out_time_us=N/A", "out_time_us=-1000000", "out_time_us=", "out_time=N/A"]) {
      expect(parseFfmpegProgressLine(line, 100)).toBeUndefined();
    }
    expect(parseFfmpegProgressLine("out_time_us=25000000", undefined)).toBeUndefined();
  });
  it("weights differently sized subtitle chunks by completed cues", () => {
    expect(measuredWorkProgress(10, 100)).toBe(9.9);
    expect(measuredWorkProgress(90, 100)).toBe(89.1);
    expect(measuredWorkProgress(100, 100)).toBe(99);
    expect(measuredWorkProgress(50, 100, 30)).toBe(64.5);
    expect(measuredWorkProgress(1, 0)).toBe(0);
  });
});
