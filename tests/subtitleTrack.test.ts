import { describe, expect, it } from "vitest";
import {
  classifySubtitleCodec,
  findEnglishSubtitleTrack,
  type SubtitleTrack
} from "../src/core/video/SubtitleTrack";

describe("subtitle track classification", () => {
  it("supports text-based subtitle codecs", () => {
    expect(classifySubtitleCodec("subrip").supportedFormat).toBe("srt");
    expect(classifySubtitleCodec("ass").supportedFormat).toBe("ass");
    expect(classifySubtitleCodec("webvtt").supportedFormat).toBe("webvtt");
  });

  it("supports PGS image-based subtitles through OCR", () => {
    const result = classifySubtitleCodec("hdmv_pgs_subtitle");

    expect(result.isSupported).toBe(true);
    expect(result.isTextBased).toBe(false);
    expect(result.isImageBased).toBe(true);
    expect(result.requiresOcr).toBe(true);
    expect(result.supportedFormat).toBe("pgs");
    expect(result.reason).toMatch(/OCR/);
  });
});

describe("subtitle track preferences", () => {
  it("finds English by common language codes or a descriptive title", () => {
    expect(findEnglishSubtitleTrack([
      track(2, "spa", "Spanish"),
      track(3, "eng", "SDH")
    ])?.index).toBe(3);

    expect(findEnglishSubtitleTrack([
      track(4, "und", "English commentary")
    ])?.index).toBe(4);
  });

  it("does not silently pick a different language", () => {
    expect(findEnglishSubtitleTrack([
      track(1, "fra", "French"),
      track(2, "deu", "German")
    ])).toBeUndefined();
  });
});

function track(index: number, language: string, title: string): SubtitleTrack {
  return {
    index,
    language,
    title,
    codecName: "subrip",
    codecType: "subtitle",
    isSupported: true,
    isTextBased: true,
    isImageBased: false,
    requiresOcr: false,
    supportedFormat: "srt"
  };
}
