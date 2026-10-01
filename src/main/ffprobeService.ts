import { ProbeResult } from "../core/video/ProbeResult";
import { AudioTrack } from "../core/video/AudioTrack";
import { OtherMediaStream, VideoTrack } from "../core/video/MediaStream";
import { classifySubtitleCodec, SubtitleTrack } from "../core/video/SubtitleTrack";
import { getFfprobePath } from "./staticBinaries";
import { runProcess } from "./processUtils";

interface FfprobeStream {
  index: number;
  codec_name?: string;
  codec_long_name?: string;
  codec_type?: string;
  channels?: number;
  channel_layout?: string;
  sample_rate?: string;
  bit_rate?: string;
  tags?: Record<string, string | undefined> & {
    language?: string;
    title?: string;
  };
}

interface FfprobeJson {
  streams?: FfprobeStream[];
  format?: {
    format_name?: string;
    duration?: string;
  };
}

export async function probeVideo(filePath: string, signal?: AbortSignal): Promise<ProbeResult> {
  const { stdout } = await runProcess(
    getFfprobePath(),
    ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath],
    signal
  );
  const parsed = JSON.parse(stdout) as FfprobeJson;
  const subtitleTracks = (parsed.streams ?? [])
    .filter((stream) => stream.codec_type === "subtitle")
    .map(toSubtitleTrack);
  const audioTracks = (parsed.streams ?? [])
    .filter((stream) => stream.codec_type === "audio")
    .map(toAudioTrack);
  const videoTracks = (parsed.streams ?? [])
    .filter((stream) => stream.codec_type === "video")
    .map(toVideoTrack);
  const otherStreams = (parsed.streams ?? [])
    .filter((stream) => !["video", "audio", "subtitle"].includes(stream.codec_type ?? ""))
    .map(toOtherMediaStream);

  return {
    filePath,
    formatName: parsed.format?.format_name ?? "unknown",
    durationSeconds: parsed.format?.duration ? Number(parsed.format.duration) : undefined,
    videoTracks,
    audioTracks,
    subtitleTracks,
    otherStreams
  };
}

function toVideoTrack(stream: FfprobeStream): VideoTrack {
  return {
    index: stream.index,
    codecName: stream.codec_name ?? "unknown",
    codecLongName: stream.codec_long_name,
    codecType: "video"
  };
}

function toOtherMediaStream(stream: FfprobeStream): OtherMediaStream {
  return {
    index: stream.index,
    codecName: stream.codec_name ?? "unknown",
    codecType: stream.codec_type ?? "unknown"
  };
}

function toAudioTrack(stream: FfprobeStream): AudioTrack {
  return {
    index: stream.index,
    codecName: stream.codec_name ?? "unknown",
    codecLongName: stream.codec_long_name,
    codecType: "audio",
    language: stream.tags?.language ?? "und",
    title: stream.tags?.title ?? "",
    channels: stream.channels,
    channelLayout: stream.channel_layout,
    sampleRate: stream.sample_rate ? Number(stream.sample_rate) : undefined,
    bitRate: inferAudioBitRate(stream.bit_rate, stream.tags)
  };
}

export function inferAudioBitRate(
  streamBitRate?: string,
  tags?: Record<string, string | undefined>
): number | undefined {
  const declaredBitRate = positiveNumber(streamBitRate)
    ?? positiveNumber(findTag(tags, "BPS"));
  if (declaredBitRate) {
    return Math.round(declaredBitRate);
  }

  const byteCount = positiveNumber(findTag(tags, "NUMBER_OF_BYTES"));
  const durationSeconds = parseTagDuration(findTag(tags, "DURATION"));
  if (!byteCount || !durationSeconds) {
    return undefined;
  }
  return Math.round(byteCount * 8 / durationSeconds);
}

function findTag(
  tags: Record<string, string | undefined> | undefined,
  requestedName: string
): string | undefined {
  const normalizedName = requestedName.toLocaleUpperCase();
  return Object.entries(tags ?? {}).find(([name]) => {
    const normalized = name.toLocaleUpperCase();
    return normalized === normalizedName || normalized === `${normalizedName}-ENG`;
  })?.[1];
}

function parseTagDuration(value?: string): number | undefined {
  const numericDuration = positiveNumber(value);
  if (numericDuration) {
    return numericDuration;
  }
  const match = /^(\d+):([0-5]?\d):([0-5]?\d(?:\.\d+)?)$/.exec(value?.trim() ?? "");
  if (!match) {
    return undefined;
  }
  const seconds = Number(match[1]) * 3_600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

function positiveNumber(value?: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function toSubtitleTrack(stream: FfprobeStream): SubtitleTrack {
  const codecName = stream.codec_name ?? "unknown";
  const classification = classifySubtitleCodec(codecName);
  return {
    index: stream.index,
    codecName,
    codecType: "subtitle",
    language: stream.tags?.language ?? "und",
    title: stream.tags?.title ?? "",
    ...classification
  };
}
