import { normalizeLineEndings, parseSrtTimestamp, SubtitleDocument, SubtitleCue } from "./SubtitleCue";

const TIMING_PATTERN = /^(.+?)\s*-->\s*(.+?)(?:\s+.*)?$/;

export function parseSrt(input: string): SubtitleDocument {
  const normalized = normalizeLineEndings(input).trim();
  if (!normalized) {
    return { format: "srt", cues: [] };
  }

  const blocks = normalized.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];

  blocks.forEach((block, blockIndex) => {
    const lines = block.split("\n");
    if (lines.length < 2) {
      return;
    }

    let timingIndex = 0;
    let originalIndex = blockIndex + 1;

    if (/^\d+$/.test(lines[0].trim())) {
      originalIndex = Number(lines[0].trim());
      timingIndex = 1;
    }

    const timing = lines[timingIndex]?.match(TIMING_PATTERN);
    if (!timing) {
      throw new Error(`Invalid SRT timing block near cue ${originalIndex}`);
    }

    const startTime = timing[1].trim();
    const endTime = timing[2].trim();
    cues.push({
      id: cues.length + 1,
      originalIndex,
      startTime,
      endTime,
      startMs: parseSrtTimestamp(startTime),
      endMs: parseSrtTimestamp(endTime),
      text: lines.slice(timingIndex + 1).join("\n").trim()
    });
  });

  return { format: "srt", cues };
}
