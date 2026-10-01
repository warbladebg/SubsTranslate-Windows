import type { AudioTransformProfile } from "../../../core/media/AudioProfiles";
import type { AudioTrack } from "../../../core/video/AudioTrack";
import type { MediaTransformProgress } from "../../../main/mediaTransformService";
import type { MediaBatchItemStatus } from "../../../main/mediaBatchSessionService";

export const MEDIA_PROGRESS_HISTORY_LIMIT = 80;

export function formatAudioTrack(track: AudioTrack): string {
  const parts = [
    `#${track.index}`,
    track.language || "und",
    track.codecName,
    formatAudioBitRate(track.bitRate),
    track.channels ? `${track.channels}ch` : undefined,
    formatChannelLayout(track.channelLayout),
    track.title || undefined
  ].filter(Boolean);
  return parts.join(" / ");
}

function formatAudioBitRate(bitRate?: number): string | undefined {
  if (!bitRate || !Number.isFinite(bitRate) || bitRate <= 0) {
    return undefined;
  }
  if (bitRate >= 1_000_000) {
    const megabits = bitRate / 1_000_000;
    return `${megabits.toFixed(2).replace(/\.?0+$/, "")} Mbps`;
  }
  return `${Math.round(bitRate / 1_000)} kbps`;
}

function formatChannelLayout(channelLayout?: string): string | undefined {
  if (channelLayout?.toLocaleLowerCase() === "5.1(side)") {
    return "5.1 side surrounds";
  }
  return channelLayout;
}

export function formatProfileDetails(profile: AudioTransformProfile): string {
  if (profile.codec === "copy") {
    return "no audio transcode";
  }
  return `${profile.bitRate ? `${Number.parseInt(profile.bitRate, 10)} kbps` : "lossless"} / ${profile.channels === 6 ? "5.1" : "2.0"}`;
}

export function formatGainDb(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} dB`;
}

export function batchStatusClass(status: MediaBatchItemStatus): "ok" | "warn" | "error" {
  if (status === "Complete") {
    return "ok";
  }
  if (status === "Failed" || status === "Cancelled") {
    return "error";
  }
  return "warn";
}

export function findLatestProgressPercent(progress: MediaTransformProgress[]): number {
  for (let index = progress.length - 1; index >= 0; index -= 1) {
    if (progress[index].progressPercent !== undefined) {
      return progress[index].progressPercent!;
    }
  }
  return 0;
}
