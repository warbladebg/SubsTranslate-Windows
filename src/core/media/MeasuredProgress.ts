/** Measured work only; reserve the final percent for successful output validation. */
export function measuredWorkProgress(completed: number, total: number, start = 0, end = 99): number {
  if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0) return start;
  return Math.round((start + (end - start) * Math.max(0, Math.min(1, completed / total))) * 10) / 10;
}

export function parseFfmpegProgressLine(line: string, durationSeconds: number | undefined): number | undefined {
  if (line === "progress=end") return 99;
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return undefined;
  const [key, value] = line.split("=");
  let seconds: number;
  if (key === "out_time_us" || key === "out_time_ms") {
    if (!value?.trim()) return undefined;
    seconds = Number(value) / 1_000_000;
  } else if (key === "out_time") {
    const match = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(value ?? "");
    if (!match) return undefined;
    seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  } else return undefined;
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return measuredWorkProgress(seconds, durationSeconds);
}
