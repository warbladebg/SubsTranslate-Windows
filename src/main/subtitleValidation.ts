import { parseSrt } from "../core/subtitle/SrtParser";
import { runProcess } from "./processUtils";
import { getFfmpegPath, getFfprobePath } from "./staticBinaries";

export function requireReadableSrt(content: string) {
  const cues = parseSrt(content).cues;
  if (!cues.length || !cues.some(cue => cue.text.trim())) {
    throw new Error("The subtitle track contains no readable cues. No subtitle file was exported.");
  }
  return cues;
}

export async function readSubtitleAsSrt(path: string, streamIndex: number, signal?: AbortSignal): Promise<string> {
  const result = await runProcess(getFfmpegPath(), [
    "-nostdin", "-v", "error", "-i", path, "-map", `0:${streamIndex}`,
    "-vn", "-an", "-dn", "-c:s", "srt", "-f", "srt", "pipe:1"
  ], signal);
  requireReadableSrt(result.stdout);
  return result.stdout;
}

export function verifyEmbeddedCues(expectedContent: string, actualContent: string): void {
  const expected = requireReadableSrt(expectedContent);
  const actual = requireReadableSrt(actualContent);
  if (expected.length !== actual.length || expected.some((cue, index) =>
    Math.abs(cue.startMs - actual[index].startMs) > 50 ||
    Math.abs(cue.endMs - actual[index].endMs) > 50 ||
    normalizeText(cue.text) !== normalizeText(actual[index].text)
  )) {
    throw new Error("Embedded subtitles failed verification: cues or timings were lost. The original movie has not been replaced.");
  }
}

function normalizeText(text: string): string {
  // Containers may change styling and line wrapping, but must retain dialogue.
  return text.replace(/<[^>]*>/g, "").replace(/\{\\[^}]*\}/g, "").replace(/\s+/g, " ").trim();
}

export async function verifySubtitlePlayback(path: string, streamIndex: number, expectedContent: string, signal?: AbortSignal): Promise<void> {
  const cues = requireReadableSrt(expectedContent);
  // Cue counts alone miss subtitles written at EOF with earlier timestamps.
  // Seek using all streams so video timestamps bound each inspection window.
  const samples = [...new Set([Math.min(1, cues.length - 1), Math.floor(cues.length / 2), cues.length - 1])].map(index => cues[index]);
  const intervals = samples.map(cue => `${Math.max(0, cue.startMs / 1000 - 5)}%${cue.startMs / 1000 + 2}`).join(",");
  const { stdout } = await runProcess(getFfprobePath(), [
    "-v", "error", "-read_intervals", intervals, "-show_packets",
    "-show_entries", "packet=stream_index,pts_time", "-of", "json", path
  ], signal);
  const packets = (JSON.parse(stdout) as { packets?: { stream_index: number; pts_time?: string }[] }).packets ?? [];
  const timestamps = packets.filter(packet => packet.stream_index === streamIndex && packet.pts_time !== undefined)
    .map(packet => Number(packet.pts_time) * 1000);
  if (samples.some(cue => !timestamps.some(timestamp => Math.abs(timestamp - cue.startMs) <= 50))) {
    throw new Error("Embedded subtitles are not available at their playback times. The movie failed subtitle interleaving verification and has not been installed.");
  }
}
