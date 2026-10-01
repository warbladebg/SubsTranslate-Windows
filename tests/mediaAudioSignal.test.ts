import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AudioProfileId } from "../src/core/media/AudioProfiles";
import { probeVideo } from "../src/main/ffprobeService";
import { transformMedia } from "../src/main/mediaTransformService";
import { runProcess } from "../src/main/processUtils";
import { getFfmpegPath, getFfprobePath } from "../src/main/staticBinaries";

const sampleRate = 48_000;
// LFE uses 80 Hz so codec low-pass filtering does not look like channel loss.
const surroundFrequencies = [220, 330, 440, 80, 660, 770];

interface PcmAudio {
  channels: number;
  samples: Float32Array;
}

interface ChannelStats {
  peak: number;
  rms: number;
}

describe("media transform audio signal integrity", () => {
  it("preserves all six speaker channels without swaps, leakage, clipping, dropouts, or loudness drift in AC-3 and E-AC-3", async () => {
    const dir = await createTempDirectory("surround");
    const sourcePath = join(dir, "surround-source.mkv");
    await createSignalSource(sourcePath, "5.1", surroundFrequencies, 0.04, 3, "flac");

    const sourceProbe = await probeVideo(sourcePath);
    const sourcePcm = await decodeAudio(sourcePath, join(dir, "source.f32"), 6);

    for (const profileId of ["ac3-5-1", "eac3-5-1"] satisfies AudioProfileId[]) {
      const result = await transformMedia(
        {
          videoPath: sourcePath,
          audioTrackIndex: sourceProbe.audioTracks[0].index,
          audioProfileId: profileId,
          outputDirectory: dir,
          outputConflictMode: "overwrite",
          outputContainerId: "mkv"
        },
        () => undefined
      );
      const outputPcm = await decodeAudio(result.outputPath, join(dir, `${profileId}.f32`), 6);

      assertPcmIsFinite(outputPcm);
      expect(Math.abs(durationSeconds(outputPcm) - durationSeconds(sourcePcm))).toBeLessThan(0.05);

      for (let channel = 0; channel < 6; channel += 1) {
        const expectedAmplitude = toneAmplitude(outputPcm, channel, surroundFrequencies[channel]);
        const unexpectedAmplitudes = surroundFrequencies
          .filter((_, frequencyChannel) => frequencyChannel !== channel)
          .map((frequency) => toneAmplitude(outputPcm, channel, frequency));
        const loudestUnexpected = Math.max(...unexpectedAmplitudes);

        expect(expectedAmplitude).toBeGreaterThan(0.025);
        expect(expectedAmplitude / Math.max(loudestUnexpected, 1e-8)).toBeGreaterThan(8);
        expect(channelStats(outputPcm, channel).peak).toBeLessThan(0.95);
        expect(minimumWindowRmsRatio(outputPcm, channel)).toBeGreaterThan(0.5);

        const sourceRms = channelStats(sourcePcm, channel).rms;
        const outputRms = channelStats(outputPcm, channel).rms;
        expect(Math.abs(decibels(outputRms / sourceRms))).toBeLessThan(1.25);
      }
    }
  });

  it("downmixes 5.1 to AAC stereo with correct left, right, center, and surround routing", async () => {
    const dir = await createTempDirectory("downmix");
    const sourcePath = join(dir, "downmix-source.mkv");
    await createSignalSource(sourcePath, "5.1", surroundFrequencies, 0.035, 3, "flac");

    const sourceProbe = await probeVideo(sourcePath);
    const result = await transformMedia(
      {
        videoPath: sourcePath,
        audioTrackIndex: sourceProbe.audioTracks[0].index,
        audioProfileId: "aac-stereo",
        outputDirectory: dir,
        outputConflictMode: "overwrite",
        outputContainerId: "mkv"
      },
      () => undefined
    );
    const pcm = await decodeAudio(result.outputPath, join(dir, "downmix.f32"), 2);

    assertPcmIsFinite(pcm);
    const left = 0;
    const right = 1;
    const leftFront = toneAmplitude(pcm, left, surroundFrequencies[0]);
    const rightFrontLeak = toneAmplitude(pcm, right, surroundFrequencies[0]);
    const rightFront = toneAmplitude(pcm, right, surroundFrequencies[1]);
    const leftFrontLeak = toneAmplitude(pcm, left, surroundFrequencies[1]);
    const centerLeft = toneAmplitude(pcm, left, surroundFrequencies[2]);
    const centerRight = toneAmplitude(pcm, right, surroundFrequencies[2]);
    const leftSurround = toneAmplitude(pcm, left, surroundFrequencies[4]);
    const leftSurroundLeak = toneAmplitude(pcm, right, surroundFrequencies[4]);
    const rightSurround = toneAmplitude(pcm, right, surroundFrequencies[5]);
    const rightSurroundLeak = toneAmplitude(pcm, left, surroundFrequencies[5]);

    expect(leftFront / Math.max(rightFrontLeak, 1e-8)).toBeGreaterThan(8);
    expect(rightFront / Math.max(leftFrontLeak, 1e-8)).toBeGreaterThan(8);
    expect(leftSurround / Math.max(leftSurroundLeak, 1e-8)).toBeGreaterThan(8);
    expect(rightSurround / Math.max(rightSurroundLeak, 1e-8)).toBeGreaterThan(8);
    expect(centerLeft).toBeGreaterThan(0.01);
    expect(centerRight).toBeGreaterThan(0.01);
    expect(centerLeft / centerRight).toBeGreaterThan(0.8);
    expect(centerLeft / centerRight).toBeLessThan(1.2);
    expect(channelStats(pcm, left).peak).toBeLessThan(0.95);
    expect(channelStats(pcm, right).peak).toBeLessThan(0.95);
    expect(minimumWindowRmsRatio(pcm, left)).toBeGreaterThan(0.5);
    expect(minimumWindowRmsRatio(pcm, right)).toBeGreaterThan(0.5);
  });

  it("keeps AAC stereo loudness, signal boundaries, and continuous playback stable", async () => {
    const dir = await createTempDirectory("aac-stability");
    const sourcePath = join(dir, "stereo-source.mkv");
    await createSignalSource(sourcePath, "stereo", [997, 1499], 0.18, 5, "flac");

    const sourceProbe = await probeVideo(sourcePath);
    const sourcePcm = await decodeAudio(sourcePath, join(dir, "source.f32"), 2);
    const result = await transformMedia(
      {
        videoPath: sourcePath,
        audioTrackIndex: sourceProbe.audioTracks[0].index,
        audioProfileId: "aac-stereo",
        outputDirectory: dir,
        outputConflictMode: "overwrite",
        outputContainerId: "mkv"
      },
      () => undefined
    );
    const outputPcm = await decodeAudio(result.outputPath, join(dir, "output.f32"), 2);

    assertPcmIsFinite(outputPcm);
    expect(Math.abs(durationSeconds(outputPcm) - durationSeconds(sourcePcm))).toBeLessThan(0.04);
    expect(Math.abs(signalStartSeconds(outputPcm) - signalStartSeconds(sourcePcm))).toBeLessThan(0.025);
    expect(Math.abs(signalEndSeconds(outputPcm) - signalEndSeconds(sourcePcm))).toBeLessThan(0.04);

    for (let channel = 0; channel < 2; channel += 1) {
      const sourceStats = channelStats(sourcePcm, channel);
      const outputStats = channelStats(outputPcm, channel);
      expect(Math.abs(decibels(outputStats.rms / sourceStats.rms))).toBeLessThan(0.75);
      expect(outputStats.peak).toBeLessThan(0.5);
      expect(minimumWindowRmsRatio(outputPcm, channel)).toBeGreaterThan(0.65);
    }
  });

  it("downmixes 7.1 to E-AC-3 5.1 without losing front, center, LFE, side, or rear content", async () => {
    const dir = await createTempDirectory("seven-one-downmix");
    const sourcePath = join(dir, "seven-one-source.mkv");
    const frequencies = [220, 330, 440, 80, 660, 770, 880, 990];
    await createSignalSource(sourcePath, "7.1", frequencies, 0.025, 3, "flac");

    const sourceProbe = await probeVideo(sourcePath);
    const result = await transformMedia(
      {
        videoPath: sourcePath,
        audioTrackIndex: sourceProbe.audioTracks[0].index,
        audioProfileId: "eac3-5-1",
        outputDirectory: dir,
        outputConflictMode: "overwrite",
        outputContainerId: "mkv"
      },
      () => undefined
    );
    const pcm = await decodeAudio(result.outputPath, join(dir, "output.f32"), 6);

    assertPcmIsFinite(pcm);
    expect(Math.abs(durationSeconds(pcm) - 3)).toBeLessThan(0.06);
    for (let channel = 0; channel < 6; channel += 1) {
      expect(channelStats(pcm, channel).peak).toBeLessThan(0.95);
      expect(minimumWindowRmsRatio(pcm, channel)).toBeGreaterThan(0.45);
    }

    expect(toneAmplitude(pcm, 0, frequencies[0])).toBeGreaterThan(0.012);
    expect(toneAmplitude(pcm, 1, frequencies[1])).toBeGreaterThan(0.012);
    expect(toneAmplitude(pcm, 2, frequencies[2])).toBeGreaterThan(0.012);
    expect(toneAmplitude(pcm, 3, frequencies[3])).toBeGreaterThan(0.006);
    expect(toneAmplitude(pcm, 4, frequencies[4])).toBeGreaterThan(0.006);
    expect(toneAmplitude(pcm, 4, frequencies[6])).toBeGreaterThan(0.006);
    expect(toneAmplitude(pcm, 5, frequencies[5])).toBeGreaterThan(0.006);
    expect(toneAmplitude(pcm, 5, frequencies[7])).toBeGreaterThan(0.006);
    expect(toneAmplitude(pcm, 4, frequencies[6]) / Math.max(toneAmplitude(pcm, 5, frequencies[6]), 1e-8)).toBeGreaterThan(8);
    expect(toneAmplitude(pcm, 5, frequencies[7]) / Math.max(toneAmplitude(pcm, 4, frequencies[7]), 1e-8)).toBeGreaterThan(8);
  });

  it("transcodes DTS and TrueHD sources without corrupt, silent, clipped, or discontinuous output", async () => {
    const cases: Array<{
      sourceCodec: "dca" | "truehd";
      sourceLayout: "5.1" | "7.1";
      sourceFrequencies: number[];
      outputProfile: AudioProfileId;
    }> = [
      {
        sourceCodec: "dca",
        sourceLayout: "5.1",
        sourceFrequencies: surroundFrequencies,
        outputProfile: "ac3-5-1"
      },
      {
        sourceCodec: "truehd",
        sourceLayout: "5.1",
        sourceFrequencies: surroundFrequencies,
        outputProfile: "eac3-5-1"
      }
    ];

    for (const testCase of cases) {
      const dir = await createTempDirectory(testCase.sourceCodec);
      const sourcePath = join(dir, `${testCase.sourceCodec}-source.mkv`);
      await createSignalSource(
        sourcePath,
        testCase.sourceLayout,
        testCase.sourceFrequencies,
        0.025,
        3,
        testCase.sourceCodec
      );
      const sourceProbe = await probeVideo(sourcePath);
      expect(sourceProbe.audioTracks[0].codecName).toBe(testCase.sourceCodec === "dca" ? "dts" : "truehd");

      const result = await transformMedia(
        {
          videoPath: sourcePath,
          audioTrackIndex: sourceProbe.audioTracks[0].index,
          audioProfileId: testCase.outputProfile,
          outputDirectory: dir,
          outputConflictMode: "overwrite",
          outputContainerId: "mkv"
        },
        () => undefined
      );
      const pcm = await decodeAudio(result.outputPath, join(dir, "output.f32"), 6);

      assertPcmIsFinite(pcm);
      expect(Math.abs(durationSeconds(pcm) - 3)).toBeLessThan(0.06);
      for (let channel = 0; channel < 6; channel += 1) {
        const stats = channelStats(pcm, channel);
        expect(stats.rms).toBeGreaterThan(0.005);
        expect(stats.peak).toBeLessThan(0.95);
        expect(minimumWindowRmsRatio(pcm, channel)).toBeGreaterThan(0.4);
      }
    }
  });

  it("preserves a deliberate audio/video timestamp offset within one codec frame", async () => {
    const dir = await createTempDirectory("sync");
    const sourcePath = join(dir, "offset-source.mkv");
    await createSignalSource(sourcePath, "stereo", [997, 1499], 0.12, 3.5, "flac", 0.25);
    const sourceProbe = await probeVideo(sourcePath);
    const sourceOffset = await audioVideoStartOffset(sourcePath);

    const result = await transformMedia(
      {
        videoPath: sourcePath,
        audioTrackIndex: sourceProbe.audioTracks[0].index,
        audioProfileId: "aac-stereo",
        outputDirectory: dir,
        outputConflictMode: "overwrite",
        outputContainerId: "mkv"
      },
      () => undefined
    );
    const outputOffset = await audioVideoStartOffset(result.outputPath);
    const sourcePcm = await decodeAudio(sourcePath, join(dir, "sync-source.f32"), 2);
    const outputPcm = await decodeAudio(result.outputPath, join(dir, "sync-output.f32"), 2);
    const sourceAudibleStart = sourceOffset + signalStartSeconds(sourcePcm);
    const outputAudibleStart = outputOffset + signalStartSeconds(outputPcm);

    expect(sourceOffset).toBeCloseTo(0.25, 3);
    expect(Math.abs(outputOffset - sourceOffset)).toBeLessThan(1024 / sampleRate + 0.006);
    expect(Math.abs(outputAudibleStart - sourceAudibleStart)).toBeLessThan(0.003);
  });

  it("applies positive and negative gain uniformly across every 5.1 channel", async () => {
    const dir = await createTempDirectory("gain-accuracy");
    const sourcePath = join(dir, "gain-source.mkv");
    await createSignalSource(sourcePath, "5.1", surroundFrequencies, 0.08, 3, "flac");
    const sourceProbe = await probeVideo(sourcePath);
    const sourcePcm = await decodeAudio(sourcePath, join(dir, "source.f32"), 6);
    let zeroGainSignalStart: number | undefined;

    for (const gainDb of [0, -3, 3]) {
      const result = await transformMedia(
        {
          videoPath: sourcePath,
          audioTrackIndex: sourceProbe.audioTracks[0].index,
          audioProfileId: "ac3-5-1",
          audioGainDb: gainDb,
          outputDirectory: dir,
          outputConflictMode: "versioned",
          outputContainerId: "mkv"
        },
        () => undefined
      );
      const outputPcm = await decodeAudio(result.outputPath, join(dir, `gain-${gainDb}.f32`), 6);

      expect(result.audioGainDb).toBe(gainDb);
      expect(Math.abs(durationSeconds(outputPcm) - durationSeconds(sourcePcm))).toBeLessThan(0.05);
      expect(Math.abs(signalStartSeconds(outputPcm) - signalStartSeconds(sourcePcm))).toBeLessThan(0.035);
      if (gainDb === 0) {
        zeroGainSignalStart = signalStartSeconds(outputPcm);
      } else {
        expect(Math.abs(signalStartSeconds(outputPcm) - zeroGainSignalStart!)).toBeLessThan(0.001);
      }
      for (let channel = 0; channel < 6; channel += 1) {
        const measuredGainDb = decibels(channelStats(outputPcm, channel).rms / channelStats(sourcePcm, channel).rms);
        expect(Math.abs(measuredGainDb - gainDb)).toBeLessThan(0.2);
        expect(channelStats(outputPcm, channel).peak).toBeLessThan(0.95);
        expect(minimumWindowRmsRatio(outputPcm, channel)).toBeGreaterThan(0.5);
        expect(toneAmplitude(outputPcm, channel, surroundFrequencies[channel])).toBeGreaterThan(0.025);
      }
    }
  });

  it("prevents hard clipping during a +6 dB multichannel boost without changing the channel layout", async () => {
    const dir = await createTempDirectory("gain-limiter");
    const sourcePath = join(dir, "hot-source.mkv");
    await createSignalSource(sourcePath, "5.1", surroundFrequencies, 0.65, 3, "flac");
    const sourceProbe = await probeVideo(sourcePath);
    const result = await transformMedia(
      {
        videoPath: sourcePath,
        audioTrackIndex: sourceProbe.audioTracks[0].index,
        audioProfileId: "eac3-5-1",
        audioGainDb: 6,
        outputDirectory: dir,
        outputConflictMode: "overwrite",
        outputContainerId: "mkv"
      },
      () => undefined
    );
    const outputProbe = await probeVideo(result.outputPath);
    const outputPcm = await decodeAudio(result.outputPath, join(dir, "limited.f32"), 6);

    expect(outputProbe.audioTracks[0].channels).toBe(6);
    assertPcmIsFinite(outputPcm);
    for (let channel = 0; channel < 6; channel += 1) {
      const stats = channelStats(outputPcm, channel);
      expect(stats.rms).toBeGreaterThan(0.1);
      expect(stats.peak).toBeLessThanOrEqual(0.98);
      expect(minimumWindowRmsRatio(outputPcm, channel)).toBeGreaterThan(0.25);
      expect(toneAmplitude(outputPcm, channel, surroundFrequencies[channel])).toBeGreaterThan(0.1);
    }
  });
});

async function createTempDirectory(label: string): Promise<string> {
  const path = join(tmpdir(), `subtitle-audio-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(path, { recursive: true });
  return path;
}

async function createSignalSource(
  outputPath: string,
  channelLayout: "stereo" | "5.1" | "7.1",
  frequencies: number[],
  amplitude: number,
  duration: number,
  audioCodec: "flac" | "dca" | "truehd",
  audioOffset = 0
): Promise<void> {
  const expressions = frequencies.map((frequency) => `${amplitude}*sin(2*PI*${frequency}*t)`).join("|");
  const args = [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=160x90:d=${duration + audioOffset}:r=10`
  ];
  if (audioOffset > 0) {
    args.push("-itsoffset", String(audioOffset));
  }
  args.push(
    "-f",
    "lavfi",
    "-i",
    `aevalsrc=${expressions}:s=${sampleRate}:d=${duration}:c=${channelLayout}`,
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    audioCodec,
    "-metadata:s:a:0",
    "language=eng"
  );
  if (audioCodec === "dca" || audioCodec === "truehd") {
    args.push("-strict", "-2");
  }
  args.push(outputPath);
  await runProcess(getFfmpegPath(), args);
}

async function decodeAudio(inputPath: string, outputPath: string, channels: number): Promise<PcmAudio> {
  await runProcess(getFfmpegPath(), [
    "-y",
    "-v",
    "error",
    "-i",
    inputPath,
    "-map",
    "0:a:0",
    "-vn",
    "-ac",
    String(channels),
    "-ar",
    String(sampleRate),
    "-c:a",
    "pcm_f32le",
    "-f",
    "f32le",
    outputPath
  ]);
  const buffer = await readFile(outputPath);
  const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  return { channels, samples: new Float32Array(bytes) };
}

function assertPcmIsFinite(pcm: PcmAudio): void {
  expect(pcm.samples.length).toBeGreaterThan(0);
  let firstInvalidSample = -1;
  for (let index = 0; index < pcm.samples.length; index += 1) {
    if (!Number.isFinite(pcm.samples[index])) {
      firstInvalidSample = index;
      break;
    }
  }
  expect(firstInvalidSample).toBe(-1);
}

function durationSeconds(pcm: PcmAudio): number {
  return pcm.samples.length / pcm.channels / sampleRate;
}

function channelStats(pcm: PcmAudio, channel: number): ChannelStats {
  const frameCount = pcm.samples.length / pcm.channels;
  const firstFrame = Math.min(Math.round(sampleRate * 0.2), Math.floor(frameCount * 0.1));
  const lastFrame = Math.max(firstFrame + 1, frameCount - firstFrame);
  let peak = 0;
  let squareSum = 0;
  for (let frame = firstFrame; frame < lastFrame; frame += 1) {
    const sample = pcm.samples[frame * pcm.channels + channel];
    peak = Math.max(peak, Math.abs(sample));
    squareSum += sample * sample;
  }
  return { peak, rms: Math.sqrt(squareSum / (lastFrame - firstFrame)) };
}

function toneAmplitude(pcm: PcmAudio, channel: number, frequency: number): number {
  const frameCount = pcm.samples.length / pcm.channels;
  const firstFrame = Math.min(Math.round(sampleRate * 0.5), Math.floor(frameCount * 0.15));
  const lastFrame = Math.max(firstFrame + 1, frameCount - firstFrame);
  const count = lastFrame - firstFrame;
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const coefficient = 2 * Math.cos(omega);
  let previous = 0;
  let previousPrevious = 0;
  for (let frame = firstFrame; frame < lastFrame; frame += 1) {
    const sample = pcm.samples[frame * pcm.channels + channel];
    const current = sample + coefficient * previous - previousPrevious;
    previousPrevious = previous;
    previous = current;
  }
  const power = previousPrevious ** 2 + previous ** 2 - coefficient * previous * previousPrevious;
  return (2 * Math.sqrt(Math.max(0, power))) / count;
}

function minimumWindowRmsRatio(pcm: PcmAudio, channel: number): number {
  const frameCount = pcm.samples.length / pcm.channels;
  const windowFrames = Math.round(sampleRate * 0.02);
  const firstFrame = Math.round(sampleRate * 0.2);
  const lastFrame = frameCount - firstFrame;
  const values: number[] = [];
  for (let start = firstFrame; start + windowFrames <= lastFrame; start += windowFrames) {
    let squareSum = 0;
    for (let frame = start; frame < start + windowFrames; frame += 1) {
      const sample = pcm.samples[frame * pcm.channels + channel];
      squareSum += sample * sample;
    }
    values.push(Math.sqrt(squareSum / windowFrames));
  }
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return median > 0 ? (sorted[0] ?? 0) / median : 0;
}

function signalStartSeconds(pcm: PcmAudio): number {
  const frameCount = pcm.samples.length / pcm.channels;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < pcm.channels; channel += 1) {
      if (Math.abs(pcm.samples[frame * pcm.channels + channel]) > 0.005) {
        return frame / sampleRate;
      }
    }
  }
  return durationSeconds(pcm);
}

function signalEndSeconds(pcm: PcmAudio): number {
  const frameCount = pcm.samples.length / pcm.channels;
  for (let frame = frameCount - 1; frame >= 0; frame -= 1) {
    for (let channel = 0; channel < pcm.channels; channel += 1) {
      if (Math.abs(pcm.samples[frame * pcm.channels + channel]) > 0.005) {
        return frame / sampleRate;
      }
    }
  }
  return 0;
}

function decibels(ratio: number): number {
  return 20 * Math.log10(ratio);
}

async function audioVideoStartOffset(path: string): Promise<number> {
  const { stdout } = await runProcess(getFfprobePath(), [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,start_time",
    "-of",
    "json",
    path
  ]);
  const parsed = JSON.parse(stdout) as {
    streams: Array<{ codec_type: string; start_time?: string }>;
  };
  const videoStart = Number(parsed.streams.find((stream) => stream.codec_type === "video")?.start_time ?? 0);
  const audioStart = Number(parsed.streams.find((stream) => stream.codec_type === "audio")?.start_time ?? 0);
  return audioStart - videoStart;
}
