import { normalizeLineEndings, parseSrtTimestamp, SubtitleCue, SubtitleDocument, vttToSrtTimestamp } from "./SubtitleCue";
import { cleanSubtitleText } from "./TextCleaner";

const TIMING_PATTERN = /^(.+?)\s*-->\s*(.+?)(?:\s+.*)?$/;

export function parseWebVtt(input: string): SubtitleDocument {
  const normalized = normalizeLineEndings(input);
  const lines = normalized.split("\n");
  const cues: SubtitleCue[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line || line === "WEBVTT" || line.startsWith("NOTE") || line.startsWith("STYLE") || line.startsWith("REGION")) {
      index += 1;
      continue;
    }

    let timingLine = line;
    if (!TIMING_PATTERN.test(timingLine) && index + 1 < lines.length) {
      index += 1;
      timingLine = lines[index].trim();
    }

    const timing = timingLine.match(TIMING_PATTERN);
    if (!timing) {
      index += 1;
      continue;
    }

    const startTime = vttToSrtTimestamp(timing[1].trim());
    const endTime = vttToSrtTimestamp(timing[2].trim());
    const textLines: string[] = [];
    index += 1;

    while (index < lines.length && lines[index].trim()) {
      textLines.push(lines[index]);
      index += 1;
    }

    cues.push({
      id: cues.length + 1,
      originalIndex: cues.length + 1,
      startTime,
      endTime,
      startMs: parseSrtTimestamp(startTime),
      endMs: parseSrtTimestamp(endTime),
      text: cleanSubtitleText(textLines.join("\n"))
    });
  }

  return { format: "webvtt", cues };
}
