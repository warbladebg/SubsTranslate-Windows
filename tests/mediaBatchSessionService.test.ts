import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SubtitleTrack } from "../src/core/video/SubtitleTrack";
import {
  MediaBatchSessionService,
  type MediaBatchSessionCheckpoint,
  type MediaBatchSessionStatus
} from "../src/main/mediaBatchSessionService";
import { normalizeAppSettings } from "../src/main/settingsService";

describe("media batch session service", () => {
  it("round-trips everything needed to continue the exact paused workflow", async () => {
    const storePath = await createStorePath();
    const service = new MediaBatchSessionService(storePath);
    const saved = await service.save(createCheckpoint({
      status: "paused",
      pauseReason: "Vercel AI Gateway returned 402: insufficient credits.",
      items: [
        {
          videoPath: "D:\\Shows\\Episode 1.mkv",
          status: "Paused",
          translatedSubtitlePath: "D:\\Temp\\Episode 1.bg.srt",
          error: "Insufficient credits"
        },
        {
          videoPath: "D:\\Shows\\Episode 2.mkv",
          status: "Queued"
        }
      ]
    }));

    const restored = await new MediaBatchSessionService(storePath).getResumable();

    expect(restored).toMatchObject({
      id: saved.id,
      status: "paused",
      videoPaths: ["D:\\Shows\\Episode 1.mkv", "D:\\Shows\\Episode 2.mkv"],
      subtitlePaths: ["D:\\Subs\\Episode 1.srt", "D:\\Subs\\Episode 2.srt"],
      referenceVideoPath: "D:\\Shows\\Episode 1.mkv",
      referenceAudioTrackIndex: 2,
      referenceSubtitleTrack: { index: 5, language: "eng", codecName: "subrip" },
      config: {
        audioProfileId: "ac3-5-1",
        audioGainDb: 1.5,
        subtitleWorkflow: "translate",
        subtitleEncodingId: "utf-8-bom",
        outputConflictMode: "cancel",
        outputMode: "new-file",
        outputContainerId: "mp4"
      },
      translateFirst: true,
      translationSettings: {
        targetLanguage: "Bulgarian",
        targetLanguageCode: "bg",
        providerId: "vercel",
        quality: "balanced",
        contextMode: "larger"
      },
      outputDirectory: "D:\\Finished",
      pauseReason: "Vercel AI Gateway returned 402: insufficient credits.",
      items: [
        {
          videoPath: "D:\\Shows\\Episode 1.mkv",
          status: "Paused",
          translatedSubtitlePath: "D:\\Temp\\Episode 1.bg.srt",
          error: "Insufficient credits"
        },
        { videoPath: "D:\\Shows\\Episode 2.mkv", status: "Queued" }
      ]
    });
  });

  it("turns files that were active when the app closed into resumable paused items", async () => {
    const storePath = await createStorePath();
    const service = new MediaBatchSessionService(storePath);
    await service.save(createCheckpoint({
      status: "running",
      pauseReason: undefined,
      items: [
        { videoPath: "D:\\Shows\\Probe.mkv", status: "Probing" },
        { videoPath: "D:\\Shows\\Translate.mkv", status: "Translating", error: "Saved provider message" },
        { videoPath: "D:\\Shows\\Build.mkv", status: "Building", translatedSubtitlePath: "D:\\Temp\\Build.bg.srt" },
        { videoPath: "D:\\Shows\\Later.mkv", status: "Queued" },
        { videoPath: "D:\\Shows\\Done.mkv", status: "Complete", outputPath: "D:\\Finished\\Done.mkv" },
        { videoPath: "D:\\Shows\\Bad.mkv", status: "Failed", error: "Unsupported stream" }
      ]
    }));

    const restored = await service.getResumable();
    expect(restored?.status).toBe("paused");
    expect(restored?.pauseReason).toBe("The previous media batch stopped before completion.");
    expect(restored?.items.map(({ status }) => status)).toEqual([
      "Paused",
      "Paused",
      "Paused",
      "Queued",
      "Complete",
      "Failed"
    ]);
    expect(restored?.items[0].error).toBe("The app closed while this file was active.");
    expect(restored?.items[1].error).toBe("Saved provider message");
    expect(restored?.items[2].translatedSubtitlePath).toBe("D:\\Temp\\Build.bg.srt");

    const persisted = JSON.parse(await readFile(storePath, "utf8"));
    expect(persisted.status).toBe("paused");
    expect(persisted.items.map((item: { status: string }) => item.status)).toEqual(restored?.items.map(({ status }) => status));
  });

  it.each<MediaBatchSessionStatus>(["completed", "cancelled"])(
    "does not offer a %s batch as resumable",
    async (status) => {
      const storePath = await createStorePath();
      const service = new MediaBatchSessionService(storePath);
      await service.save(createCheckpoint({ status }));

      expect(await service.getResumable()).toBeUndefined();
    }
  );

  it("recovers the previous checkpoint if a crash leaves only the backup", async () => {
    const storePath = await createStorePath();
    const service = new MediaBatchSessionService(storePath);
    const first = await service.save(createCheckpoint({ pauseReason: "First durable checkpoint." }));
    await service.save(createCheckpoint({
      id: first.id,
      pauseReason: "New checkpoint being installed.",
      items: [{ videoPath: "D:\\Shows\\Episode 1.mkv", status: "Complete" }]
    }));

    // This is the on-disk state if the process exits after primary -> backup
    // and before the prepared replacement -> primary rename.
    await rm(storePath);
    const recovered = await new MediaBatchSessionService(storePath).getResumable();

    expect(recovered?.id).toBe(first.id);
    expect(recovered?.pauseReason).toBe("First durable checkpoint.");
    expect(JSON.parse(await readFile(storePath, "utf8")).pauseReason).toBe("First durable checkpoint.");
  });

  it("discards both checkpoint copies only for the matching session id", async () => {
    const storePath = await createStorePath();
    const service = new MediaBatchSessionService(storePath);
    const saved = await service.save(createCheckpoint());
    await service.save(createCheckpoint({ id: saved.id, pauseReason: "Creates the backup copy." }));

    expect(await service.discard("a-stale-session-id")).toBe(false);
    await expect(readFile(storePath, "utf8")).resolves.toContain(saved.id);
    await expect(readFile(`${storePath}.bak`, "utf8")).resolves.toContain(saved.id);

    expect(await service.discard(saved.id)).toBe(true);
    await expect(readFile(storePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(`${storePath}.bak`, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await service.discard(saved.id)).toBe(false);
  });
});

function createCheckpoint(
  overrides: Partial<MediaBatchSessionCheckpoint> = {}
): MediaBatchSessionCheckpoint {
  const referenceSubtitleTrack: SubtitleTrack = {
    index: 5,
    codecName: "subrip",
    codecType: "subtitle",
    language: "eng",
    title: "English",
    isSupported: true,
    isTextBased: true,
    isImageBased: false,
    requiresOcr: false,
    supportedFormat: "srt"
  };

  return {
    status: "paused",
    videoPaths: ["D:\\Shows\\Episode 1.mkv", "D:\\Shows\\Episode 2.mkv"],
    subtitlePaths: ["D:\\Subs\\Episode 1.srt", "D:\\Subs\\Episode 2.srt"],
    referenceVideoPath: "D:\\Shows\\Episode 1.mkv",
    referenceAudioTrackIndex: 2,
    referenceSubtitleTrack,
    config: {
      audioProfileId: "ac3-5-1",
      audioGainDb: 1.5,
      keepOnlySelectedAudioTrack: true,
      subtitleWorkflow: "translate",
      subtitleEncodingId: "utf-8-bom",
      keepOnlyNewSubtitleTrack: true,
      outputConflictMode: "cancel",
      outputMode: "new-file",
      outputContainerId: "mp4"
    },
    translateFirst: true,
    translationSettings: normalizeAppSettings({
      targetLanguage: "Bulgarian",
      targetLanguageCode: "bg",
      providerId: "vercel",
      quality: "best",
      contextMode: "larger"
    }),
    outputDirectory: "D:\\Finished",
    items: [
      { videoPath: "D:\\Shows\\Episode 1.mkv", status: "Paused" },
      { videoPath: "D:\\Shows\\Episode 2.mkv", status: "Queued" }
    ],
    pauseReason: "Quota reached.",
    ...overrides
  };
}

async function createStorePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "media-batch-session-"));
  return join(directory, "session.json");
}
