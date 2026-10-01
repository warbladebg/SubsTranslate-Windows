import { describe, expect, it, vi } from "vitest";
import type { AudioTrack } from "../src/core/video/AudioTrack";
import type { ProbeResult } from "../src/core/video/ProbeResult";
import type { SubtitleTrack } from "../src/core/video/SubtitleTrack";
import type { MediaBatchSessionCheckpoint, MediaBatchSessionItem } from "../src/main/mediaBatchSessionService";
import type { MediaTransformProgress } from "../src/main/mediaTransformService";
import type { AppSettings } from "../src/main/settingsService";
import type { MediaWorkflowConfig } from "../src/main/workflowProfileService";
import {
  findMediaBatchStartError,
  runMediaBatch,
  type MediaBatchApi,
  type MediaBatchRunRequest
} from "../src/renderer/components/media/mediaBatchRunner";

const audioTrack: AudioTrack = { index: 1, codecName: "aac", codecType: "audio", language: "eng", title: "" };
const subtitleTrack: SubtitleTrack = {
  index: 2,
  codecName: "subrip",
  codecType: "subtitle",
  language: "eng",
  title: "",
  isSupported: true,
  isTextBased: true,
  isImageBased: false,
  requiresOcr: false,
  supportedFormat: "srt"
};
const settings = { providerId: "gemini" } as AppSettings;
const copyConfig: MediaWorkflowConfig = {
  audioProfileId: "copy",
  audioGainDb: 0,
  keepOnlySelectedAudioTrack: false,
  subtitleWorkflow: "existing",
  subtitleEncodingId: "utf-8",
  keepOnlyNewSubtitleTrack: false,
  outputConflictMode: "versioned",
  outputMode: "new-file",
  outputContainerId: "mkv"
};

function probeFor(filePath: string): ProbeResult {
  return {
    filePath,
    formatName: "matroska",
    videoTracks: [],
    audioTracks: [audioTrack],
    subtitleTracks: [subtitleTrack],
    otherStreams: []
  };
}

function createHarness(overrides: Partial<MediaBatchApi> = {}) {
  const checkpoints: MediaBatchSessionCheckpoint[] = [];
  const progress: MediaTransformProgress[] = [];
  let cancelled = false;
  let latestItems: MediaBatchSessionItem[] = [];
  const api: MediaBatchApi = {
    probeVideo: vi.fn(async (path: string) => probeFor(path)),
    prepareMediaForTranslation: vi.fn(async (request) => ({
      id: `prep:${request.videoPath}`,
      extractedSubtitlePath: `${request.videoPath}.en.srt`
    })),
    startTranslation: vi.fn(async (request) => ({ outputPath: `${request.videoPath}.bg.srt` }) as never),
    finalizeMediaTranslation: vi.fn(async (id: string) => ({ outputPath: `${id}.out.mkv` }) as never),
    startMediaTransform: vi.fn(async (request) => ({ outputPath: `${request.videoPath}.out.mkv` }) as never),
    discardMediaTranslationPreparation: vi.fn(async () => undefined),
    saveMediaBatchCheckpoint: vi.fn(async (checkpoint) => {
      checkpoints.push(structuredClone(checkpoint));
      return { ...checkpoint, id: "session-1" } as never;
    }),
    ...overrides
  };
  return {
    api,
    checkpoints,
    progress,
    items: () => latestItems,
    cancel: () => {
      cancelled = true;
    },
    hooks: {
      api,
      isCancelled: () => cancelled,
      markCancelled: () => {
        cancelled = true;
      },
      onItems: (items: MediaBatchSessionItem[]) => {
        latestItems = items;
      },
      appendProgress: (entry: MediaTransformProgress | ((current: MediaTransformProgress[]) => MediaTransformProgress)) => {
        progress.push(typeof entry === "function" ? entry(progress) : entry);
      },
      setActiveFile: vi.fn(),
      setTranslationActive: vi.fn(),
      setTranslationRange: vi.fn(),
      setMediaRange: vi.fn()
    }
  };
}

function batchRequest(overrides: Partial<MediaBatchRunRequest> = {}): MediaBatchRunRequest {
  const videoPaths = ["D:\\Shows\\one.mkv", "D:\\Shows\\two.mkv"];
  return {
    translateFirst: false,
    config: copyConfig,
    resume: false,
    previousItems: [],
    translationSettings: settings,
    audioTrackIndex: audioTrack.index,
    subtitleTrack,
    videoPaths,
    subtitlePaths: ["D:\\Subs\\one.srt", "D:\\Subs\\two.srt"],
    subtitleMatches: { [videoPaths[0]]: "D:\\Subs\\one.srt", [videoPaths[1]]: "D:\\Subs\\two.srt" },
    referenceVideoPath: videoPaths[0],
    referenceProbe: probeFor(videoPaths[0]),
    ...overrides
  };
}

describe("findMediaBatchStartError", () => {
  const ready = {
    videoPaths: ["D:\\a.mkv", "D:\\b.mkv"],
    referenceVideoPath: "D:\\a.mkv",
    referenceProbe: probeFor("D:\\a.mkv"),
    config: copyConfig,
    audioTrackIndex: 1,
    missingSubtitleVideoPaths: [],
    translateFirst: false,
    providerId: "gemini" as const,
    hasGeminiKey: true,
    hasVercelKey: true
  };

  it("accepts a ready batch", () => {
    expect(findMediaBatchStartError(ready)).toBeUndefined();
  });

  it("explains each missing prerequisite", () => {
    expect(findMediaBatchStartError({ ...ready, videoPaths: [] })).toMatch(/at least one video/);
    expect(findMediaBatchStartError({ ...ready, referenceProbe: undefined })).toMatch(/reference file/);
    expect(findMediaBatchStartError({
      ...ready,
      audioTrackIndex: undefined,
      config: { ...copyConfig, keepOnlySelectedAudioTrack: true }
    })).toMatch(/audio track/);
    expect(findMediaBatchStartError({ ...ready, missingSubtitleVideoPaths: ["D:\\b.mkv"] })).toMatch(/matching subtitle/);
    expect(findMediaBatchStartError({ ...ready, translateFirst: true, hasGeminiKey: false })).toMatch(/Gemini API key/);
    expect(findMediaBatchStartError({ ...ready, videoPaths: ["D:\\a.mkv", "D:\\x\\a.mkv"], outputDirectory: "D:\\out" }))
      .toMatch(/same output name/);
  });
});

describe("runMediaBatch", () => {
  it("builds every file with its matched subtitle and records a completed checkpoint", async () => {
    const harness = createHarness();
    const request = batchRequest();

    const outcome = await runMediaBatch(request, harness.hooks);

    expect(outcome).toEqual({ kind: "finished", cancelled: false, completed: 2, failed: 0 });
    expect(harness.api.startMediaTransform).toHaveBeenCalledTimes(2);
    expect(vi.mocked(harness.api.startMediaTransform).mock.calls[1][0]).toMatchObject({
      videoPath: request.videoPaths[1],
      subtitlePath: "D:\\Subs\\two.srt",
      subtitleLanguage: "bul"
    });
    expect(harness.api.probeVideo).toHaveBeenCalledTimes(1);
    expect(harness.items().map((item) => item.status)).toEqual(["Complete", "Complete"]);
    expect(harness.checkpoints.at(-1)?.status).toBe("completed");
    expect(harness.progress.at(-1)).toMatchObject({ stage: "Complete", progressPercent: 100 });
  });

  it("pauses on a quota error and keeps the translated work for resuming", async () => {
    let calls = 0;
    const harness = createHarness({
      startTranslation: vi.fn(async (request) => {
        calls += 1;
        if (calls === 2) throw new Error("429 RESOURCE_EXHAUSTED: quota exceeded");
        return { outputPath: `${request.videoPath}.bg.srt` } as never;
      })
    });
    const request = batchRequest({ translateFirst: true, config: { ...copyConfig, subtitleWorkflow: "translate" } });

    const outcome = await runMediaBatch(request, harness.hooks);

    expect(outcome).toMatchObject({ kind: "paused", sessionId: "session-1", completed: 1 });
    expect(harness.items().map((item) => item.status)).toEqual(["Complete", "Paused"]);
    expect(harness.checkpoints.at(-1)).toMatchObject({ status: "paused" });
    expect(harness.api.discardMediaTranslationPreparation).toHaveBeenCalledWith(`prep:${request.videoPaths[1]}`);
    expect(harness.progress.at(-1)?.message).toMatch(/paused at 1\/2/);
  });

  it("skips completed files when resuming a saved batch", async () => {
    const harness = createHarness();
    const request = batchRequest({
      resume: true,
      resumeSessionId: "session-1",
      previousItems: [
        { videoPath: "D:\\Shows\\one.mkv", status: "Complete", outputPath: "D:\\Shows\\one.out.mkv" },
        { videoPath: "D:\\Shows\\two.mkv", status: "Paused" }
      ]
    });

    const outcome = await runMediaBatch(request, harness.hooks);

    expect(outcome).toMatchObject({ kind: "finished", completed: 2 });
    expect(harness.api.startMediaTransform).toHaveBeenCalledTimes(1);
    expect(harness.checkpoints[0].id).toBe("session-1");
  });

  it("marks the remaining files cancelled after a cancellation", async () => {
    const harness = createHarness();
    vi.mocked(harness.api.startMediaTransform).mockImplementationOnce(async (request) => {
      harness.cancel();
      return { outputPath: `${request.videoPath}.out.mkv` } as never;
    });

    const outcome = await runMediaBatch(batchRequest(), harness.hooks);

    expect(outcome).toEqual({ kind: "finished", cancelled: true, completed: 1, failed: 0 });
    expect(harness.items().map((item) => item.status)).toEqual(["Complete", "Cancelled"]);
    expect(harness.checkpoints.at(-1)?.status).toBe("cancelled");
  });

  it("continues past a failed file and reports it", async () => {
    const harness = createHarness();
    vi.mocked(harness.api.startMediaTransform).mockRejectedValueOnce(new Error("ffmpeg exited with code 1"));

    const outcome = await runMediaBatch(batchRequest(), harness.hooks);

    expect(outcome).toEqual({ kind: "finished", cancelled: false, completed: 1, failed: 1 });
    expect(harness.items()[0]).toMatchObject({ status: "Failed", error: "ffmpeg exited with code 1" });
  });
});
