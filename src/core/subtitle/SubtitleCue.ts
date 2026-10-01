export type SubtitleFormat = "srt" | "ass" | "ssa" | "webvtt" | "pgs";

export interface SubtitleCue {
  id: number;
  originalIndex: number;
  startTime: string;
  endTime: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface SubtitleDocument {
  format: SubtitleFormat;
  cues: SubtitleCue[];
}

export function normalizeLineEndings(input: string): string {
  return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/^\uFEFF/, "");
}

export function parseSrtTimestamp(value: string): number {
  const match = value.trim().match(/^(\d{1,2}):(\d{2}):(\d{2}),(\d{3})$/);
  if (!match) {
    throw new Error(`Invalid SRT timestamp: ${value}`);
  }

  const [, hours, minutes, seconds, millis] = match;
  return (
    Number(hours) * 60 * 60 * 1000 +
    Number(minutes) * 60 * 1000 +
    Number(seconds) * 1000 +
    Number(millis)
  );
}

export function formatSrtTimestamp(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms));
  const hours = Math.floor(safeMs / 3_600_000);
  const minutes = Math.floor((safeMs % 3_600_000) / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1000);
  const millis = safeMs % 1000;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

export function parseVttTimestamp(value: string): number {
  const trimmed = value.trim();
  const match = trimmed.match(/^(?:(\d{1,2}):)?(\d{2}):(\d{2})\.(\d{3})$/);
  if (!match) {
    throw new Error(`Invalid WebVTT timestamp: ${value}`);
  }

  const [, hours = "0", minutes, seconds, millis] = match;
  return (
    Number(hours) * 60 * 60 * 1000 +
    Number(minutes) * 60 * 1000 +
    Number(seconds) * 1000 +
    Number(millis)
  );
}

export function vttToSrtTimestamp(value: string): string {
  return formatSrtTimestamp(parseVttTimestamp(value));
}

export function assTimestampToSrt(value: string): string {
  const match = value.trim().match(/^(\d+):(\d{2}):(\d{2})\.(\d{1,2})$/);
  if (!match) {
    throw new Error(`Invalid ASS timestamp: ${value}`);
  }

  const [, hours, minutes, seconds, centiseconds] = match;
  const ms =
    Number(hours) * 60 * 60 * 1000 +
    Number(minutes) * 60 * 1000 +
    Number(seconds) * 1000 +
    Number(centiseconds.padEnd(2, "0")) * 10;

  return formatSrtTimestamp(ms);
}
