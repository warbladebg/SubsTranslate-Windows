import { describe, expect, it } from "vitest";
import { inferAudioBitRate } from "../src/main/ffprobeService";

describe("FFprobe audio bitrate fallback", () => {
  it("prefers the stream bitrate and reads Matroska BPS tags when it is absent", () => {
    expect(inferAudioBitRate("640000", { BPS: "384000" })).toBe(640_000);
    expect(inferAudioBitRate(undefined, { "BPS-eng": "1509000" })).toBe(1_509_000);
  });

  it("derives bitrate from Matroska byte-count and duration tags", () => {
    expect(inferAudioBitRate(undefined, {
      "NUMBER_OF_BYTES-eng": "46800000",
      "DURATION-eng": "00:13:00.000000000"
    })).toBe(480_000);
  });

  it("does not invent a bitrate without sufficient metadata", () => {
    expect(inferAudioBitRate(undefined, { DURATION: "00:42:00.000000000" })).toBeUndefined();
  });
});
