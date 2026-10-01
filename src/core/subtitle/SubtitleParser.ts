import { parseAss } from "./AssParser";
import { SubtitleDocument, SubtitleFormat } from "./SubtitleCue";
import { parseSrt } from "./SrtParser";
import { parseWebVtt } from "./WebVttParser";

export function parseSubtitle(input: string, format: SubtitleFormat): SubtitleDocument {
  if (format === "srt") {
    return parseSrt(input);
  }

  if (format === "webvtt") {
    return parseWebVtt(input);
  }

  if (format === "pgs") {
    throw new Error("Image-based PGS subtitles must be OCR'd to SRT before parsing.");
  }

  return parseAss(input, format);
}
