import { describe, expect, it } from "vitest";
import { audioTransformProfiles } from "../src/core/media/AudioProfiles";
import { getMediaContainerProfile } from "../src/core/media/MediaContainers";
import {
  buildAudioGainFilter,
  buildMediaTransformArgs,
  validateContainerCompatibility
} from "../src/main/mediaTransformService";

const audioTracks = [
  {
    index: 1,
    codecName: "dts",
    codecType: "audio" as const,
    language: "eng",
    title: "DTS-HD MA 5.1",
    channels: 6
  },
  {
    index: 2,
    codecName: "aac",
    codecType: "audio" as const,
    language: "eng",
    title: "Commentary",
    channels: 2
  }
];

const subtitleTracks = [
  {
    index: 3,
    codecName: "hdmv_pgs_subtitle",
    codecType: "subtitle" as const,
    language: "eng",
    title: "",
    isSupported: true,
    isTextBased: false,
    isImageBased: true,
    requiresOcr: true,
    supportedFormat: "pgs" as const
  }
];

describe("media transform service", () => {
  it("builds an ffmpeg command that copies video, adds subtitles, and converts only the selected audio output", () => {
    const profile = audioTransformProfiles.find((item) => item.id === "ac3-5-1")!;
    const args = buildMediaTransformArgs({
      videoPath: "input.mkv",
      outputPath: "output.mkv",
      audioTracks,
      subtitleTracks,
      audioTrackIndex: 2,
      profile,
      container: getMediaContainerProfile("mkv"),
      subtitlePath: "translated.bg.srt",
      subtitleLanguage: "bul",
      subtitleTitle: "Bulgarian"
    });

    expect(args).toContain("-map");
    expect(args).toContain("1:0");
    expect(args).toContain("-c:v");
    expect(args[args.indexOf("-c:v") + 1]).toBe("copy");
    expect(args).toContain("-c:a");
    expect(args[args.indexOf("-c:a") + 1]).toBe("copy");
    expect(args).toContain("-c:a:1");
    expect(args[args.indexOf("-c:a:1") + 1]).toBe("ac3");
    expect(args).toContain("-b:a:1");
    expect(args[args.indexOf("-b:a:1") + 1]).toBe("640k");
    expect(args).toContain("-metadata:s:s:1");
    expect(args.slice(args.indexOf("-sub_charenc"), args.indexOf("-sub_charenc") + 4)).toEqual([
      "-sub_charenc",
      "UTF-8",
      "-i",
      "translated.bg.srt"
    ]);
    expect(args).not.toContain("libx264");
    expect(args).not.toContain("libx265");
  });

  it("keeps all streams copied for the original audio profile", () => {
    const profile = audioTransformProfiles.find((item) => item.id === "copy")!;
    const args = buildMediaTransformArgs({
      videoPath: "input.mkv",
      outputPath: "output.mkv",
      audioTracks,
      subtitleTracks: [],
      profile,
      container: getMediaContainerProfile("mkv"),
      subtitleLanguage: "bul",
      subtitleTitle: "Bulgarian"
    });

    expect(args).toContain("-c");
    expect(args[args.indexOf("-c") + 1]).toBe("copy");
    expect(args.some((arg) => /^-c:a:\d+$/.test(arg))).toBe(false);
  });

  it("extracts a text subtitle as a second output during the media pass", () => {
    const profile = audioTransformProfiles.find((item) => item.id === "copy")!;
    const args = buildMediaTransformArgs({
      videoPath: "input.mkv",
      outputPath: "prepared.mkv",
      audioTracks,
      subtitleTracks: [],
      profile,
      container: getMediaContainerProfile("mkv"),
      subtitleLanguage: "bul",
      subtitleTitle: "Bulgarian",
      reserveSubtitleAddition: true,
      textSubtitleExtraction: {
        trackIndex: 3,
        outputPath: "source.srt",
        codecArgs: ["-c:s", "copy"]
      }
    });

    expect(args).toEqual(expect.arrayContaining([
      "prepared.mkv",
      "-map", "0:3",
      "-vn",
      "-an",
      "-dn",
      "-c:s", "copy",
      "source.srt"
    ]));
  });

  it("maps only the selected audio and newly added subtitle when pruning MKV tracks", () => {
    const profile = audioTransformProfiles.find((item) => item.id === "copy")!;
    const args = buildMediaTransformArgs({
      videoPath: "input.mkv",
      outputPath: "output.mkv",
      audioTracks,
      subtitleTracks,
      audioTrackIndex: 2,
      profile,
      container: getMediaContainerProfile("mkv"),
      keepOnlySelectedAudioTrack: true,
      subtitlePath: "translated.bg.srt",
      keepOnlyNewSubtitleTrack: true,
      subtitleLanguage: "bul",
      subtitleTitle: "Bulgarian"
    });

    expect(args).toEqual(expect.arrayContaining([
      "-map", "0",
      "-map", "-0:a?",
      "-map", "0:2",
      "-map", "-0:s?",
      "-map", "1:0"
    ]));
    expect(args).toContain("-metadata:s:s:0");
    expect(args).not.toContain("-metadata:s:s:1");
  });

  it("builds MP4 output with explicit stream groups and converts text subtitles to mov_text", () => {
    const profile = audioTransformProfiles.find((item) => item.id === "aac-stereo")!;
    const args = buildMediaTransformArgs({
      videoPath: "input.mkv",
      outputPath: "output.mp4",
      audioTracks,
      subtitleTracks: [],
      audioTrackIndex: 1,
      profile,
      container: getMediaContainerProfile("mp4"),
      subtitlePath: "translated.bg.srt",
      subtitleLanguage: "bul",
      subtitleTitle: "Bulgarian"
    });

    expect(args).toContain("0:v?");
    expect(args).toContain("0:a?");
    expect(args).toContain("0:s?");
    expect(args[args.indexOf("-c:s") + 1]).toBe("mov_text");
    expect(args.at(-1)).toBe("output.mp4");
  });

  it("allows an incompatible source audio codec when that exact track is converted", () => {
    const profile = audioTransformProfiles.find((item) => item.id === "ac3-5-1")!;

    expect(() =>
      validateContainerCompatibility({
        container: getMediaContainerProfile("mp4"),
        videoTracks: [{ index: 0, codecName: "h264", codecType: "video" }],
        audioTracks: [audioTracks[0]],
        subtitleTracks: [],
        otherStreams: [],
        selectedAudioTrackIndex: 1,
        profile
      })
    ).not.toThrow();
  });

  it("refuses MP4 when a copied stream would be lost or incompatible", () => {
    const profile = audioTransformProfiles.find((item) => item.id === "copy")!;
    const base = {
      container: getMediaContainerProfile("mp4"),
      videoTracks: [{ index: 0, codecName: "h264", codecType: "video" as const }],
      audioTracks: [audioTracks[1]],
      subtitleTracks: [],
      otherStreams: [],
      profile
    };

    expect(() => validateContainerCompatibility({ ...base, audioTracks: [audioTracks[0]] })).toThrow(/dts audio/i);
    expect(() => validateContainerCompatibility({ ...base, subtitleTracks })).toThrow(/image subtitles/i);
    expect(() =>
      validateContainerCompatibility({
        ...base,
        otherStreams: [{ index: 4, codecName: "ttf", codecType: "attachment" }]
      })
    ).toThrow(/attachments/i);
  });

  it("applies gain only to the selected transcoded track and limits positive boosts", () => {
    const profile = audioTransformProfiles.find((item) => item.id === "ac3-5-1")!;
    const args = buildMediaTransformArgs({
      videoPath: "input.mkv",
      outputPath: "output.mkv",
      audioTracks,
      subtitleTracks: [],
      audioTrackIndex: 2,
      profile,
      container: getMediaContainerProfile("mkv"),
      audioGainDb: 3,
      subtitleLanguage: "bul",
      subtitleTitle: "Bulgarian"
    });

    expect(args).toContain("-filter:a:1");
    expect(args[args.indexOf("-filter:a:1") + 1]).toBe(
      "volume=+3dB:precision=double,alimiter=limit=0.97:attack=5:release=50:level=0:latency=1"
    );
    expect(args).not.toContain("-filter:a:0");
  });

  it("uses a transparent volume filter for attenuation and validates unsafe combinations", () => {
    expect(buildAudioGainFilter(-2.5)).toBe("volume=-2.5dB:precision=double");
    expect(() => buildAudioGainFilter(6.5)).toThrow(/between -6 dB and \+6 dB/i);

    const copyProfile = audioTransformProfiles.find((item) => item.id === "copy")!;
    expect(() =>
      buildMediaTransformArgs({
        videoPath: "input.mkv",
        outputPath: "output.mkv",
        audioTracks,
        subtitleTracks: [],
        profile: copyProfile,
        container: getMediaContainerProfile("mkv"),
        audioGainDb: 1,
        subtitleLanguage: "bul",
        subtitleTitle: "Bulgarian"
      })
    ).toThrow(/cannot be used with Keep Original Audio/i);
  });
});
