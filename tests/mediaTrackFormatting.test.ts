import { describe, expect, it } from "vitest";
import type { AudioTrack } from "../src/core/video/AudioTrack";
import { formatAudioTrack } from "../src/renderer/components/media/mediaFormatting";

describe("media audio-track formatting", () => {
  it("shows bitrate and explains the FFmpeg side-surround layout", () => {
    expect(formatAudioTrack(audioTrack({
      index: 1,
      bitRate: 384_000,
      channelLayout: "5.1(side)"
    }))).toBe("#1 / rus / ac3 / 384 kbps / 6ch / 5.1 side surrounds / Novafilm");
  });

  it("uses Mbps for high-bitrate tracks and omits unavailable bitrate metadata", () => {
    expect(formatAudioTrack(audioTrack({
      index: 4,
      language: "eng",
      codecName: "dts",
      bitRate: 1_509_000,
      channelLayout: "5.1(side)",
      title: ""
    }))).toBe("#4 / eng / dts / 1.51 Mbps / 6ch / 5.1 side surrounds");

    expect(formatAudioTrack(audioTrack({
      index: 2,
      bitRate: undefined,
      channelLayout: "stereo"
    }))).toBe("#2 / rus / ac3 / 6ch / stereo / Novafilm");
  });
});

function audioTrack(overrides: Partial<AudioTrack>): AudioTrack {
  return {
    index: 1,
    codecName: "ac3",
    codecType: "audio",
    language: "rus",
    title: "Novafilm",
    channels: 6,
    ...overrides
  };
}
