import { AudioTrack } from "./AudioTrack";
import { OtherMediaStream, VideoTrack } from "./MediaStream";
import { SubtitleTrack } from "./SubtitleTrack";

export interface ProbeResult {
  filePath: string;
  formatName: string;
  durationSeconds?: number;
  videoTracks: VideoTrack[];
  audioTracks: AudioTrack[];
  subtitleTracks: SubtitleTrack[];
  otherStreams: OtherMediaStream[];
}
