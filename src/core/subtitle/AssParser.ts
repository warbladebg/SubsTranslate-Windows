import { assTimestampToSrt, parseSrtTimestamp, SubtitleCue, SubtitleDocument, normalizeLineEndings } from "./SubtitleCue";
import { cleanAssText } from "./TextCleaner";

export function parseAss(input: string, format: "ass" | "ssa" = "ass"): SubtitleDocument {
  const lines = normalizeLineEndings(input).split("\n");
  let inEvents = false;
  let fields: string[] = [];
  const cues: SubtitleCue[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[Events]$/i.test(trimmed)) {
      inEvents = true;
      continue;
    }

    if (!inEvents) {
      continue;
    }

    if (/^\[.+]$/.test(trimmed)) {
      break;
    }

    if (/^Format:/i.test(trimmed)) {
      fields = trimmed
        .replace(/^Format:\s*/i, "")
        .split(",")
        .map((field) => field.trim().toLowerCase());
      continue;
    }

    if (!/^Dialogue:/i.test(trimmed) || fields.length === 0) {
      continue;
    }

    const raw = trimmed.replace(/^Dialogue:\s*/i, "");
    const values = splitAssDialogue(raw, fields.length);
    const startRaw = values[fields.indexOf("start")];
    const endRaw = values[fields.indexOf("end")];
    const textRaw = values[fields.indexOf("text")];

    if (!startRaw || !endRaw || textRaw === undefined) {
      continue;
    }

    const startTime = assTimestampToSrt(startRaw);
    const endTime = assTimestampToSrt(endRaw);
    cues.push({
      id: cues.length + 1,
      originalIndex: cues.length + 1,
      startTime,
      endTime,
      startMs: parseSrtTimestamp(startTime),
      endMs: parseSrtTimestamp(endTime),
      text: cleanAssText(textRaw)
    });
  }

  return { format, cues };
}

function splitAssDialogue(raw: string, expectedFields: number): string[] {
  const values = raw.split(",");
  if (values.length <= expectedFields) {
    return values.map((value) => value.trim());
  }

  const head = values.slice(0, expectedFields - 1).map((value) => value.trim());
  const text = values.slice(expectedFields - 1).join(",").trim();
  return [...head, text];
}
