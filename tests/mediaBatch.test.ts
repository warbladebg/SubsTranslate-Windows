import { describe, expect, it } from "vitest";
import {
  findBatchOutputCollisions,
  matchBatchAudioTrack,
  matchBatchSubtitleFiles,
  matchBatchSubtitleTrack
} from "../src/core/media/MediaBatch";
import type { AudioTrack } from "../src/core/video/AudioTrack";
import type { SubtitleTrack } from "../src/core/video/SubtitleTrack";

const referenceAudioTracks: AudioTrack[] = [
  { index: 1, codecName: "aac", codecType: "audio", language: "eng", title: "Main" },
  { index: 3, codecName: "ac3", codecType: "audio", language: "deu", title: "Dub" }
];

const referenceSubtitleTracks: SubtitleTrack[] = [
  subtitle(2, "eng", "subrip"),
  subtitle(4, "deu", "ass")
];

describe("media batch matching", () => {
  it("uses the same audio-track position across files with different stream indexes", () => {
    const targetTracks: AudioTrack[] = [
      { index: 2, codecName: "aac", codecType: "audio", language: "eng", title: "Main" },
      { index: 7, codecName: "eac3", codecType: "audio", language: "deu", title: "Dub" }
    ];

    expect(matchBatchAudioTrack(referenceAudioTracks, 3, targetTracks)?.index).toBe(7);
    expect(matchBatchAudioTrack(referenceAudioTracks, undefined, targetTracks)?.index).toBe(2);
  });

  it("prefers audio metadata over position when track ordering changes", () => {
    const targetTracks: AudioTrack[] = [
      { index: 2, codecName: "aac", codecType: "audio", language: "eng", title: "Commentary" },
      { index: 5, codecName: "eac3", codecType: "audio", language: "deu", title: "Dub" },
      { index: 9, codecName: "eac3", codecType: "audio", language: "eng", title: "Main" }
    ];

    expect(matchBatchAudioTrack(referenceAudioTracks, 1, targetTracks)?.index).toBe(9);
    expect(matchBatchAudioTrack(referenceAudioTracks, 3, targetTracks)?.index).toBe(5);
  });

  it("does not prefer a matching title in the wrong language", () => {
    const targetTracks: AudioTrack[] = [
      { index: 4, codecName: "aac", codecType: "audio", language: "fra", title: "Main" },
      { index: 8, codecName: "eac3", codecType: "audio", language: "eng", title: "Primary" }
    ];

    expect(matchBatchAudioTrack(referenceAudioTracks, 1, targetTracks)?.index).toBe(8);
  });

  it("prefers matching subtitle language and codec, then language", () => {
    const exactTargets = [subtitle(5, "eng", "ass"), subtitle(8, "eng", "subrip")];
    const languageTargets = [subtitle(5, "eng", "ass"), subtitle(8, "fra", "subrip")];

    expect(matchBatchSubtitleTrack(referenceSubtitleTracks[0], referenceSubtitleTracks, exactTargets)?.index).toBe(8);
    expect(matchBatchSubtitleTrack(referenceSubtitleTracks[0], referenceSubtitleTracks, languageTargets)?.index).toBe(5);
  });

  it("preserves the selected subtitle variant when languages and codecs repeat", () => {
    const tracks = [subtitle(6, "rus", "subrip"), subtitle(7, "rus", "subrip"), subtitle(8, "eng", "subrip")];
    expect(matchBatchSubtitleTrack(tracks[1], tracks, tracks)?.index).toBe(7);
    expect(matchBatchSubtitleTrack(tracks[1], tracks, [subtitle(9, "rus", "subrip"), subtitle(10, "rus", "subrip")])?.index).toBe(10);
  });

  it("does not silently default an invalid explicit audio selection to the first track", () => {
    expect(matchBatchAudioTrack(referenceAudioTracks, 99, referenceAudioTracks)).toBeUndefined();
  });

  it("matches sidecar subtitles by video filename and Bulgarian suffix", () => {
    const videos = ["D:\\Shows\\Pilot.mkv", "D:\\Shows\\Episode.02.mp4", "D:\\Shows\\Missing.mkv"];
    const result = matchBatchSubtitleFiles(videos, [
      "D:\\Subs\\Pilot.bg.srt",
      "D:\\Subs\\Episode.02.bulgarian.ass"
    ]);

    expect(result.matches[videos[0]]).toBe("D:\\Subs\\Pilot.bg.srt");
    expect(result.matches[videos[1]]).toBe("D:\\Subs\\Episode.02.bulgarian.ass");
    expect(result.missingVideoPaths).toEqual([videos[2]]);
  });

  it("does not guess when duplicate subtitle stems are selected", () => {
    const video = "D:\\Shows\\Pilot.mkv";
    const result = matchBatchSubtitleFiles([video], ["D:\\A\\Pilot.srt", "D:\\B\\Pilot.bg.srt"]);
    expect(result.matches).toEqual({});
    expect(result.missingVideoPaths).toEqual([video]);
  });

  it("detects same-stem outputs in a shared folder before a batch starts", () => {
    const videos = ["D:\\Season 1\\Movie.mkv", "D:\\Season 2\\Movie.mp4", "D:\\Season 2\\Extra.mkv"];

    expect(findBatchOutputCollisions(videos, "D:\\Finished")).toEqual([
      { outputStem: "Movie", videoPaths: videos.slice(0, 2) }
    ]);
    expect(findBatchOutputCollisions(videos)).toEqual([]);
  });

  it("detects same-stem outputs already sharing a source folder", () => {
    const videos = ["D:\\Shows\\Movie.mkv", "D:\\Shows\\Movie.mp4"];
    expect(findBatchOutputCollisions(videos)).toHaveLength(1);
  });
});

function subtitle(index: number, language: string, codecName: string): SubtitleTrack {
  return {
    index,
    codecName,
    codecType: "subtitle",
    language,
    title: "",
    isSupported: true,
    isTextBased: true,
    isImageBased: false,
    requiresOcr: false,
    supportedFormat: codecName === "ass" ? "ass" : "srt"
  };
}
