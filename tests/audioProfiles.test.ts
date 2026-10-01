import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { audioTransformProfiles } from "../src/core/media/AudioProfiles";
import { getMediaContainerProfile } from "../src/core/media/MediaContainers";
import { probeVideo } from "../src/main/ffprobeService";
import { buildMediaTransformArgs, transformMedia } from "../src/main/mediaTransformService";
import { runProcess } from "../src/main/processUtils";
import { getFfmpegPath } from "../src/main/staticBinaries";

describe("editable audio profiles", () => {
  it("uses the selected encoder and bitrate in the media command", () => {
    const profile = audioTransformProfiles.find((item) => item.id === "custom-mp3-2-256")!;
    const args = buildMediaTransformArgs({
      videoPath: "input.mkv",
      outputPath: "output.mkv",
      audioTracks: [{ index: 1, codecName: "aac", codecType: "audio", language: "eng", title: "Audio" }],
      subtitleTracks: [],
      audioTrackIndex: 1,
      profile,
      container: getMediaContainerProfile("mkv"),
      subtitleLanguage: "bul",
      subtitleTitle: "Bulgarian"
    });
    expect(args.slice(args.indexOf("-c:a:0"), args.indexOf("-c:a:0") + 2)).toEqual(["-c:a:0", "libmp3lame"]);
    expect(args.slice(args.indexOf("-b:a:0"), args.indexOf("-b:a:0") + 2)).toEqual(["-b:a:0", "256k"]);
  });

  it("encodes representative configured formats with the bundled FFmpeg", async () => {
    const dir = await mkdtemp(join(tmpdir(), "substranslate-audio-profiles-"));
    try {
      for (const id of [
        "custom-aac-2-320", "custom-aac-6-512", "custom-ac3-2-384", "ac3-5-1",
        "custom-eac3-2-384", "eac3-5-1", "custom-mp3-2-320",
        "custom-opus-2-256", "custom-opus-6-512", "custom-vorbis-2-256", "custom-vorbis-6-512",
        "custom-flac-2-lossless", "custom-flac-6-lossless",
        "custom-alac-2-lossless", "custom-alac-6-lossless"
      ]) {
        const profile = audioTransformProfiles.find((item) => item.id === id)!;
        const path = join(dir, `${id}.mkv`);
        await runProcess(getFfmpegPath(), [
          "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
          `anullsrc=channel_layout=${profile.channels === 6 ? "5.1" : "stereo"}:sample_rate=48000`,
          "-t", "0.1", "-c:a", profile.encoder ?? profile.codec,
          ...(profile.bitRate ? ["-b:a", profile.bitRate] : []), "-y", path
        ]);
        const probe = await probeVideo(path);
        expect(probe.audioTracks[0]?.codecName, id).toBe(profile.codec);
        expect(probe.audioTracks[0]?.channels, id).toBe(profile.channels);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("builds a valid MKV with newly selectable lossy and lossless profiles", async () => {
    const dir = await mkdtemp(join(tmpdir(), "substranslate-audio-workflow-"));
    try {
      const source = join(dir, "source.mkv");
      await runProcess(getFfmpegPath(), [
        "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=32x32:r=25",
        "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
        "-t", "0.5", "-c:v", "mpeg4", "-c:a", "pcm_s16le", "-y", source
      ]);
      const selectedTrack = (await probeVideo(source)).audioTracks[0];
      for (const audioProfileId of ["custom-mp3-2-256", "custom-opus-2-192", "custom-flac-2-lossless"] as const) {
        const result = await transformMedia({
          videoPath: source,
          audioTrackIndex: selectedTrack.index,
          audioProfileId,
          outputDirectory: dir,
          outputConflictMode: "overwrite",
          outputContainerId: "mkv"
        }, () => undefined);
        const profile = audioTransformProfiles.find((item) => item.id === audioProfileId)!;
        expect((await probeVideo(result.outputPath)).audioTracks[0]?.codecName).toBe(profile.codec);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
