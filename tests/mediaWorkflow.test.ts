import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSubtitle } from "../src/core/subtitle/SubtitleParser";
import { probeVideo } from "../src/main/ffprobeService";
import { runProcess } from "../src/main/processUtils";
import { getFfmpegPath } from "../src/main/staticBinaries";
import {
  buildSubtitleAttachmentArgs,
  finalizeMediaTranslation,
  prepareMediaForTranslation,
  transformMedia
} from "../src/main/mediaTransformService";
import { getMediaContainerProfile } from "../src/core/media/MediaContainers";
import { verifySubtitlePlayback } from "../src/main/subtitleValidation";
import { exportSubtitleTrack } from "../src/main/subtitleExportService";
import { extractSubtitleTrack } from "../src/main/subtitleExtractionService";

describe("embedded subtitle media workflow", () => {
  it("keeps subtitles playable with sparse cover streams in both embedding paths", async () => {
    const dir = join(tmpdir(), `subtitle-interleave-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const coverPath = join(dir, "cover.jpg");
    const sourcePath = join(dir, "source.mkv");
    const preparedPath = join(dir, "prepared.mkv");
    const subtitlePath = join(dir, "translation.srt");
    const attachedPath = join(dir, "attached.mkv");
    const brokenPath = join(dir, "broken.mkv");
    const content = "1\n00:02:05,000 --> 00:02:06,000\nFirst\n\n2\n00:02:07,000 --> 00:02:08,000\nSecond\n\n3\n00:02:15,000 --> 00:02:16,000\nThird\n\n4\n00:02:30,000 --> 00:02:31,000\nFourth\n";
    await writeFile(subtitlePath, content);
    await runProcess(getFfmpegPath(), ["-y", "-f", "lavfi", "-i", "color=c=red:s=64x64", "-frames:v", "1", coverPath]);
    await runProcess(getFfmpegPath(), [
      "-y", "-f", "lavfi", "-i", "color=c=black:s=160x90:d=180:r=5",
      "-f", "lavfi", "-i", "sine=frequency=1000:duration=180", "-map", "0:v", "-map", "1:a",
      "-c:v", "libx264", "-c:a", "aac", "-attach", coverPath, "-metadata:s:t:0", "mimetype=image/jpeg", sourcePath
    ]);
    await runProcess(getFfmpegPath(), ["-y", "-i", sourcePath, "-map", "0", "-c", "copy", preparedPath]);
    const args = buildSubtitleAttachmentArgs({ mediaPath: preparedPath, subtitlePath, outputPath: attachedPath,
      container: getMediaContainerProfile("mkv"), existingSubtitleCount: 0, subtitleLanguage: "bul", subtitleTitle: "Bulgarian" });
    const legacyArgs = [...args];
    legacyArgs.splice(legacyArgs.indexOf("-max_interleave_delta"), 2);
    legacyArgs[legacyArgs.length - 1] = brokenPath;
    await runProcess(getFfmpegPath(), legacyArgs);
    await expect(verifySubtitlePlayback(brokenPath, 3, content)).rejects.toThrow(/interleaving/i);
    await runProcess(getFfmpegPath(), args);
    await expect(verifySubtitlePlayback(attachedPath, 3, content)).resolves.toBeUndefined();
    const transformed = await transformMedia({ videoPath: preparedPath, subtitlePath, audioProfileId: "copy",
      outputDirectory: dir, outputConflictMode: "versioned", outputContainerId: "mkv" }, () => undefined);
    await expect(verifySubtitlePlayback(transformed.outputPath, 3, content)).resolves.toBeUndefined();
  }, 15000);

  it("rejects a real empty embedded track and preserves a movie when given an empty subtitle", async () => {
    const dir = join(tmpdir(), `subtitle-empty-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const subtitlePath = join(dir, "late.srt");
    const videoPath = join(dir, "source.mkv");
    const exportsPath = join(dir, "exports");
    await writeFile(subtitlePath, "1\n00:00:10,000 --> 00:00:11,000\nToo late.\n");
    await runProcess(getFfmpegPath(), [
      "-y", "-f", "lavfi", "-i", "color=c=black:s=160x90:d=1:r=1",
      "-i", subtitlePath, "-map", "0:v", "-map", "1:s", "-t", "1",
      "-c:v", "libx264", "-c:s", "srt", videoPath
    ]);
    const probe = await probeVideo(videoPath);
    expect(probe.subtitleTracks).toHaveLength(1);
    await expect(exportSubtitleTrack({ videoPath, track: probe.subtitleTracks[0], outputDirectory: exportsPath })).rejects.toThrow(/no readable cues/i);
    expect(await readdir(exportsPath)).toEqual([]);
    const before = await readFile(videoPath);
    await writeFile(subtitlePath, "");
    await expect(transformMedia({
      videoPath, subtitlePath, audioProfileId: "copy", outputDirectory: dir,
      outputConflictMode: "overwrite", outputMode: "replace-original", outputContainerId: "mkv"
    }, () => undefined)).rejects.toThrow();
    expect(await readFile(videoPath)).toEqual(before);
  });

  it("probes and extracts an embedded SRT track from a local MKV", async () => {
    const dir = join(tmpdir(), `subtitle-media-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const srtPath = join(dir, "sample.srt");
    const mkvPath = join(dir, "sample.mkv");

    await writeFile(
      srtPath,
      "1\n00:00:00,000 --> 00:00:01,000\nHello there.\n\n2\n00:00:01,000 --> 00:00:02,000\nOK\n",
      "utf8"
    );

    await runProcess(getFfmpegPath(), [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=160x90:d=2:r=1",
      "-i",
      srtPath,
      "-map",
      "0:v",
      "-map",
      "1:s",
      "-t",
      "2",
      "-c:v",
      "libx264",
      "-c:s",
      "srt",
      "-metadata:s:s:0",
      "language=eng",
      mkvPath
    ]);

    const probed = await probeVideo(mkvPath);
    const track = probed.subtitleTracks.find((item) => item.isTextBased);
    expect(track).toBeTruthy();

    const extracted = await extractSubtitleTrack(mkvPath, track!);
    const cached = await extractSubtitleTrack(mkvPath, track!);
    const parsed = parseSubtitle(extracted.content, extracted.format);

    expect(parsed.cues).toHaveLength(2);
    expect(parsed.cues[0].text).toBe("Hello there.");
    expect(cached.filePath).toBe(extracted.filePath);
    expect(cached.content).toBe(extracted.content);

    const exported = await exportSubtitleTrack({
      videoPath: mkvPath,
      track: track!,
      outputDirectory: dir
    });
    expect(exported.outputPath.endsWith(".srt")).toBe(true);
    expect(await readFile(exported.outputPath, "utf8")).toContain("Hello there.");
  });

  it("extracts text subtitles while converting audio, then attaches the translation without rereading the source", async () => {
    const dir = join(tmpdir(), `combined-media-translation-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const sourceSrtPath = join(dir, "source.srt");
    const translatedSrtPath = join(dir, "translated.bg.srt");
    const sourcePath = join(dir, "source.mkv");

    await writeFile(sourceSrtPath, "1\n00:00:00,000 --> 00:00:01,000\nHello.\n", "utf8");
    await writeFile(translatedSrtPath, "1\n00:00:00,000 --> 00:00:01,000\nЗдравей.\n", "utf8");
    await runProcess(getFfmpegPath(), [
      "-y",
      "-f", "lavfi", "-i", "color=c=black:s=160x90:d=1:r=1",
      "-f", "lavfi", "-i", "sine=frequency=1000:duration=1",
      "-i", sourceSrtPath,
      "-map", "0:v",
      "-map", "1:a",
      "-map", "2:s",
      "-c:v", "libx264",
      "-c:a", "aac",
      "-c:s", "srt",
      "-metadata:s:s:0", "language=eng",
      "-shortest",
      sourcePath
    ]);

    const sourceProbe = await probeVideo(sourcePath);
    const textTrack = sourceProbe.subtitleTracks.find((track) => track.isTextBased)!;
    const preparation = await prepareMediaForTranslation({
      videoPath: sourcePath,
      audioTrackIndex: sourceProbe.audioTracks[0].index,
      audioProfileId: "ac3-5-1",
      subtitleTrack: textTrack,
      outputDirectory: dir,
      outputConflictMode: "overwrite",
      outputContainerId: "mkv"
    }, () => undefined);

    expect(await readFile(preparation.extractedSubtitlePath, "utf8")).toContain("Hello.");
    await expect(stat(preparation.finalOutputPath)).rejects.toThrow();
    expect((await probeVideo(preparation.preparedMediaPath)).audioTracks[0].codecName).toBe("ac3");

    const result = await finalizeMediaTranslation(
      preparation,
      { subtitlePath: translatedSrtPath },
      () => undefined
    );
    const finalProbe = await probeVideo(result.outputPath);
    expect(finalProbe.audioTracks[0].codecName).toBe("ac3");
    expect(finalProbe.subtitleTracks.map((track) => track.language)).toEqual(["eng", "bul"]);
    await expect(stat(preparation.preparedMediaPath)).rejects.toThrow();
  });

  it("can replace an original MKV after embedding Bulgarian subtitles and converted audio", async () => {
    const dir = join(tmpdir(), `subtitle-media-replace-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const srtPath = join(dir, "translated.bg.srt");
    const mkvPath = join(dir, "replace-me.mkv");

    await writeFile(srtPath, "1\n00:00:00,000 --> 00:00:01,000\nЗдравей.\n", "utf8");

    await runProcess(getFfmpegPath(), [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=160x90:d=1:r=1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=1000:duration=1",
      "-t",
      "1",
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      "-shortest",
      mkvPath
    ]);

    const before = await probeVideo(mkvPath);
    expect(before.audioTracks[0].codecName).toBe("aac");

    const result = await transformMedia(
      {
        videoPath: mkvPath,
        audioTrackIndex: before.audioTracks[0].index,
        audioProfileId: "ac3-5-1",
        subtitlePath: srtPath,
        outputConflictMode: "overwrite",
        outputMode: "replace-original"
      },
      () => undefined
    );

    expect(result.outputPath).toBe(mkvPath);
    expect(result.outputMode).toBe("replace-original");

    const after = await probeVideo(mkvPath);
    expect(after.audioTracks[0].codecName).toBe("ac3");
    expect(after.audioTracks[0].channels).toBe(6);
    expect(after.subtitleTracks.some((track) => track.language === "bul")).toBe(true);
  });

  it("normalizes a selected UTF-16 LE subtitle file before embedding it", async () => {
    const dir = join(tmpdir(), `subtitle-media-utf16-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const srtPath = join(dir, "translated.bg.srt");
    const sourcePath = join(dir, "utf16-source.mkv");
    const subtitleText = "1\r\n00:00:00,000 --> 00:00:00,800\r\nБългарски текст.\r\n";

    await writeFile(
      srtPath,
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(subtitleText, "utf16le")])
    );
    await runProcess(getFfmpegPath(), [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=160x90:d=1:r=1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1",
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      "-shortest",
      sourcePath
    ]);

    const result = await transformMedia(
      {
        videoPath: sourcePath,
        audioProfileId: "copy",
        subtitlePath: srtPath,
        subtitleEncodingId: "utf-16-le",
        outputDirectory: dir,
        outputConflictMode: "overwrite"
      },
      () => undefined
    );

    const outputProbe = await probeVideo(result.outputPath);
    const addedTrack = outputProbe.subtitleTracks.at(-1)!;
    const extracted = await extractSubtitleTrack(result.outputPath, addedTrack);
    expect(parseSubtitle(extracted.content, extracted.format).cues[0].text).toBe("Български текст.");
  });

  it("builds an MP4 with copied video, two preserved audio tracks, converted text subtitles, and selected-track AAC", async () => {
    const dir = join(tmpdir(), `subtitle-media-mp4-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const existingSrtPath = join(dir, "existing.srt");
    const translatedSrtPath = join(dir, "translated.bg.srt");
    const sourcePath = join(dir, "multi-track.mkv");

    await writeFile(existingSrtPath, "1\n00:00:00,000 --> 00:00:01,500\nExisting subtitle.\n", "utf8");
    await writeFile(translatedSrtPath, "1\n00:00:00,000 --> 00:00:01,500\nДобавен превод.\n", "utf8");

    await runProcess(getFfmpegPath(), [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=navy:s=160x90:d=2:r=5",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=2",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:duration=2",
      "-i",
      existingSrtPath,
      "-t",
      "2",
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-map",
      "2:a",
      "-map",
      "3:s",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a:0",
      "ac3",
      "-b:a:0",
      "384k",
      "-ac:a:0",
      "6",
      "-c:a:1",
      "aac",
      "-b:a:1",
      "128k",
      "-c:s",
      "srt",
      "-metadata:s:a:0",
      "language=eng",
      "-metadata:s:a:1",
      "language=deu",
      "-metadata:s:s:0",
      "language=eng",
      sourcePath
    ]);

    const before = await probeVideo(sourcePath);
    const progress: number[] = [];
    const result = await transformMedia(
      {
        videoPath: sourcePath,
        audioTrackIndex: before.audioTracks[0].index,
        audioProfileId: "aac-stereo",
        subtitlePath: translatedSrtPath,
        outputDirectory: dir,
        outputConflictMode: "overwrite",
        outputContainerId: "mp4"
      },
      (message) => {
        if (message.progressPercent !== undefined) {
          progress.push(message.progressPercent);
        }
      }
    );

    expect(result.outputContainerId).toBe("mp4");
    expect(result.outputPath).toMatch(/\.bg\.aac-stereo\.mp4$/);
    expect(progress.at(-1)).toBe(100);

    const after = await probeVideo(result.outputPath);
    expect(after.videoTracks.map((track) => track.codecName)).toEqual(["h264"]);
    expect(after.audioTracks.map((track) => track.codecName)).toEqual(["aac", "aac"]);
    expect(after.audioTracks.map((track) => track.language)).toEqual(["eng", "deu"]);
    expect(after.audioTracks[0].channels).toBe(2);
    expect(after.audioTracks[0].sampleRate).toBe(48_000);
    expect(after.subtitleTracks.map((track) => track.codecName)).toEqual(["mov_text", "mov_text"]);
    expect(after.subtitleTracks.map((track) => track.language)).toEqual(["eng", "bul"]);

    const pruned = await transformMedia(
      {
        videoPath: sourcePath,
        audioTrackIndex: before.audioTracks[0].index,
        audioProfileId: "aac-stereo",
        keepOnlySelectedAudioTrack: true,
        subtitlePath: translatedSrtPath,
        keepOnlyNewSubtitleTrack: true,
        outputDirectory: join(dir, "pruned"),
        outputConflictMode: "overwrite",
        outputContainerId: "mp4"
      },
      () => undefined
    );
    const prunedProbe = await probeVideo(pruned.outputPath);
    expect(pruned.keptOnlySelectedAudioTrack).toBe(true);
    expect(pruned.keptOnlyNewSubtitleTrack).toBe(true);
    expect(prunedProbe.audioTracks).toHaveLength(1);
    expect(prunedProbe.audioTracks[0]).toMatchObject({ codecName: "aac", language: "eng", channels: 2 });
    expect(prunedProbe.subtitleTracks).toHaveLength(1);
    expect(prunedProbe.subtitleTracks[0]).toMatchObject({ codecName: "mov_text", language: "bul" });

    const prunedMkv = await transformMedia(
      {
        videoPath: sourcePath,
        audioTrackIndex: before.audioTracks[1].index,
        audioProfileId: "copy",
        keepOnlySelectedAudioTrack: true,
        subtitlePath: translatedSrtPath,
        keepOnlyNewSubtitleTrack: true,
        outputDirectory: join(dir, "pruned-mkv"),
        outputConflictMode: "overwrite",
        outputContainerId: "mkv"
      },
      () => undefined
    );
    const prunedMkvProbe = await probeVideo(prunedMkv.outputPath);
    expect(prunedMkvProbe.audioTracks).toHaveLength(1);
    expect(prunedMkvProbe.audioTracks[0]).toMatchObject({ codecName: "aac", language: "deu" });
    expect(prunedMkvProbe.subtitleTracks).toHaveLength(1);
    expect(prunedMkvProbe.subtitleTracks[0]).toMatchObject({ codecName: "subrip", language: "bul" });

    const versioned = await transformMedia(
      {
        videoPath: sourcePath,
        audioTrackIndex: before.audioTracks[0].index,
        audioProfileId: "aac-stereo",
        subtitlePath: translatedSrtPath,
        outputDirectory: dir,
        outputConflictMode: "versioned",
        outputContainerId: "mp4"
      },
      () => undefined
    );
    expect(versioned.outputPath).toMatch(/\.bg\.aac-stereo\.2\.mp4$/);
  });

  it("builds MOV with E-AC-3 5.1 while copying video", async () => {
    const dir = join(tmpdir(), `subtitle-media-mov-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const sourcePath = join(dir, "mov-source.mkv");

    await runProcess(getFfmpegPath(), [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=160x90:d=1:r=5",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=1000:duration=1",
      "-t",
      "1",
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      sourcePath
    ]);

    const before = await probeVideo(sourcePath);
    const result = await transformMedia(
      {
        videoPath: sourcePath,
        audioTrackIndex: before.audioTracks[0].index,
        audioProfileId: "eac3-5-1",
        outputDirectory: dir,
        outputConflictMode: "overwrite",
        outputContainerId: "mov"
      },
      () => undefined
    );

    const after = await probeVideo(result.outputPath);
    expect(result.outputPath.endsWith(".mov")).toBe(true);
    expect(after.videoTracks[0].codecName).toBe("h264");
    expect(after.audioTracks[0].codecName).toBe("eac3");
    expect(after.audioTracks[0].channels).toBe(6);
  });

  it("rejects MP4 before writing when the source contains an attachment", async () => {
    const dir = join(tmpdir(), `subtitle-media-attachment-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const attachmentPath = join(dir, "note.txt");
    const sourcePath = join(dir, "with-attachment.mkv");
    const expectedOutputPath = join(dir, "with-attachment.remux.mp4");
    await writeFile(attachmentPath, "Preserve me", "utf8");

    await runProcess(getFfmpegPath(), [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=160x90:d=1:r=1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=1000:duration=1",
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      "-attach",
      attachmentPath,
      "-metadata:s:t:0",
      "mimetype=text/plain",
      sourcePath
    ]);

    await expect(
      transformMedia(
        {
          videoPath: sourcePath,
          audioProfileId: "copy",
          outputDirectory: dir,
          outputConflictMode: "overwrite",
          outputContainerId: "mp4"
        },
        () => undefined
      )
    ).rejects.toThrow(/attachments/i);
    await expect(stat(expectedOutputPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cancels safely after preparation and removes partial output", async () => {
    const dir = join(tmpdir(), `subtitle-media-cancel-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const sourcePath = join(dir, "cancel-source.mkv");
    const expectedOutputPath = join(dir, "cancel-source.dd-5.1.mkv");

    await runProcess(getFfmpegPath(), [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=160x90:d=2:r=5",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=1000:duration=2",
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      sourcePath
    ]);

    const before = await probeVideo(sourcePath);
    const controller = new AbortController();
    await expect(
      transformMedia(
        {
          videoPath: sourcePath,
          audioTrackIndex: before.audioTracks[0].index,
          audioProfileId: "ac3-5-1",
          outputDirectory: dir,
          outputConflictMode: "overwrite",
          outputContainerId: "mkv"
        },
        (message) => {
          if (message.stage === "Remuxing") {
            controller.abort();
          }
        },
        controller.signal
      )
    ).rejects.toMatchObject({ name: "AbortError" });

    await expect(stat(expectedOutputPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readdir(dir)).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });
});

// Opt-in local regression; the source is read only and all outputs use a temp folder.
it.skipIf(!process.env.MEDIA_TRACK_TEST_SOURCE)("preserves non-first tracks from the supplied multi-track video", async () => {
  const dir = join(tmpdir(), `real-track-selection-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  const clipPath = join(dir, "clip.mkv");
  await runProcess(getFfmpegPath(), ["-y", "-ss", "120", "-i", process.env.MEDIA_TRACK_TEST_SOURCE!, "-t", "15", "-map", "0", "-c", "copy", clipPath]);
  const probe = await probeVideo(clipPath);
  const subtitle = probe.subtitleTracks.find((track) => track.index === 7)!;
  const audio = probe.audioTracks.find((track) => track.index === 5)!;
  expect(subtitle.language).toBe("rus");
  expect(audio.language).toBe("spa");
  const selectedExtraction = await extractSubtitleTrack(clipPath, subtitle);
  const prepared = await prepareMediaForTranslation({ videoPath: clipPath, audioTrackIndex: audio.index, audioProfileId: "ac3-5-1", keepOnlySelectedAudioTrack: true, subtitleTrack: subtitle, outputDirectory: dir, outputConflictMode: "versioned", outputContainerId: "mkv" }, () => undefined);
  const output = await probeVideo(prepared.preparedMediaPath);
  expect(output.audioTracks).toHaveLength(1);
  expect(output.audioTracks[0].language).toBe("spa");
  expect(output.audioTracks[0].codecName).toBe("ac3");
  expect(await readFile(prepared.extractedSubtitlePath, "utf8")).toBe(selectedExtraction.content);
}, 60000);
