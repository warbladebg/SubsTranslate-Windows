import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeAppSettings } from "../src/main/settingsService";
import {
  createWorkflowProfileDraft,
  workflowProfileToMediaConfig,
  WorkflowProfileService
} from "../src/main/workflowProfileService";

describe("workflow profile service", () => {
  it("preserves overlapping saves and continues after a rejected save", async () => {
    const service = new WorkflowProfileService(await createStorePath());
    const draft = createWorkflowProfileDraft(normalizeAppSettings({}));
    await expect(service.save(draft)).rejects.toThrow();
    const saved = await Promise.all(["Living room", "Headphones", "Archive"].map((name) => service.save({ ...draft, name })));
    const profiles = await service.list();
    expect(new Set(profiles.map((profile) => profile.id))).toEqual(new Set(saved.map((profile) => profile.id)));
  });
  it("persists, updates, and deletes one unified workflow profile", async () => {
    const storePath = await createStorePath();
    const service = new WorkflowProfileService(storePath);
    const settings = normalizeAppSettings({ providerId: "gemini", quality: "best", contextMode: "larger" });
    const draft = createWorkflowProfileDraft(settings);
    draft.name = "  Best   living room  ";
    draft.config.translation.trackPreference = "english";
    const saved = await service.save(draft);

    expect(saved.name).toBe("Best living room");
    expect(saved.kind).toBe("workflow");
    expect(saved.config.translation.enabled).toBe(true);
    expect(saved.config.media.enabled).toBe(true);
    expect((await service.list()).map((profile) => profile.id)).toEqual([saved.id]);

    const updated = await service.save({
      ...saved,
      name: "Subtitle only",
      config: {
        ...saved.config,
        translation: { ...saved.config.translation, sampleMode: "first20" },
        media: { ...saved.config.media, enabled: false }
      }
    });
    expect(updated.id).toBe(saved.id);
    expect(updated.createdAt).toBe(saved.createdAt);
    expect(updated.config.translation.sampleMode).toBe("first20");
    expect(updated.config.media.enabled).toBe(false);

    await service.delete(saved.id);
    expect(await service.list()).toEqual([]);
  });

  it("normalizes media output and derives the operational media config", async () => {
    const storePath = await createStorePath();
    const service = new WorkflowProfileService(storePath);
    const draft = createWorkflowProfileDraft(normalizeAppSettings({}));
    draft.name = "TV MKV";
    draft.config.media.outputMode = "replace-original";
    draft.config.media.outputContainerId = "mp4";
    draft.config.media.audioGainDb = 2;
    draft.config.media.keepOnlySelectedAudioTrack = true;
    draft.config.media.keepOnlyNewSubtitleTrack = true;
    draft.config.translation.trackPreference = "english";
    const saved = await service.save(draft);
    const mediaConfig = workflowProfileToMediaConfig(saved);

    expect(saved.config.media.outputContainerId).toBe("mkv");
    expect(mediaConfig.subtitleWorkflow).toBe("translate");
    expect(mediaConfig.subtitleTrackPreference).toBe("english");
    expect(mediaConfig.audioGainDb).toBe(2);
    expect(mediaConfig.keepOnlySelectedAudioTrack).toBe(true);
    expect(mediaConfig.keepOnlyNewSubtitleTrack).toBe(true);
    expect(JSON.parse(await readFile(storePath, "utf8"))).toMatchObject({ version: 2 });
  });

  it("allows Translation and Media parts to be disabled independently", async () => {
    const service = new WorkflowProfileService(await createStorePath());
    const translationOnly = createWorkflowProfileDraft(normalizeAppSettings({}));
    translationOnly.name = "Translation only";
    translationOnly.config.media.enabled = false;
    expect((await service.save(translationOnly)).config.media.enabled).toBe(false);

    const mediaOnly = createWorkflowProfileDraft(normalizeAppSettings({}));
    mediaOnly.name = "Media only";
    mediaOnly.config.translation.enabled = false;
    mediaOnly.config.media.audioEnabled = false;
    mediaOnly.config.media.subtitlesEnabled = false;
    const saved = await service.save(mediaOnly);
    expect(saved.config.translation.enabled).toBe(false);
    expect(workflowProfileToMediaConfig(saved).audioProfileId).toBe("copy");
    expect(workflowProfileToMediaConfig(saved).subtitleWorkflow).toBe("none");
    expect(workflowProfileToMediaConfig(saved).keepOnlyNewSubtitleTrack).toBe(false);
  });

  it("rejects unnamed profiles and profiles with every part disabled", async () => {
    const service = new WorkflowProfileService(await createStorePath());
    const unnamed = createWorkflowProfileDraft(normalizeAppSettings({}));
    unnamed.name = " ";
    await expect(service.save(unnamed)).rejects.toThrow(/name is required/i);

    const empty = createWorkflowProfileDraft(normalizeAppSettings({}));
    empty.name = "Does nothing";
    empty.config.translation.enabled = false;
    empty.config.media.enabled = false;
    await expect(service.save(empty)).rejects.toThrow(/enable translation or media/i);
  });

  it("migrates legacy linked Translation and Media profiles into the unified model", async () => {
    const storePath = await createStorePath();
    const settings = normalizeAppSettings({ providerId: "gemini", quality: "best" });
    await writeFile(storePath, JSON.stringify({
      version: 1,
      profiles: [{
        id: "translation-profile",
        name: "Bulgarian best",
        kind: "translation",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        config: { settings, sampleMode: "none" }
      }, {
        id: "media-profile",
        name: "Living room",
        kind: "media",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        config: {
          audioProfileId: "ac3-5-1",
          audioGainDb: 1,
          subtitleWorkflow: "translate",
          subtitleTrackPreference: "english",
          translationProfileId: "translation-profile",
          subtitleEncodingId: "utf-8",
          outputConflictMode: "versioned",
          outputMode: "new-file",
          outputContainerId: "mkv"
        }
      }]
    }), "utf8");

    const migrated = await new WorkflowProfileService(storePath).list();
    expect(migrated).toHaveLength(2);
    expect(migrated.every((profile) => profile.kind === "workflow")).toBe(true);
    expect(migrated[0].config.media.enabled).toBe(false);
    expect(migrated[1].config.translation.enabled).toBe(true);
    expect(migrated[1].config.translation.settings.quality).toBe("balanced");
    expect(migrated[1].config.translation.trackPreference).toBe("english");
  });

  it("recovers the previous profile store if replacement was interrupted", async () => {
    const storePath = await createStorePath();
    const service = new WorkflowProfileService(storePath);
    const firstDraft = createWorkflowProfileDraft(normalizeAppSettings({ providerId: "gemini" }));
    firstDraft.name = "Durable profile";
    const first = await service.save(firstDraft);
    const newestDraft = createWorkflowProfileDraft(normalizeAppSettings({ providerId: "mock" }));
    newestDraft.name = "Newest profile";
    await service.save(newestDraft);

    await rm(storePath);
    const recovered = await new WorkflowProfileService(storePath).list();

    expect(recovered.map(({ id }) => id)).toEqual([first.id]);
    expect(JSON.parse(await readFile(storePath, "utf8")).profiles).toMatchObject([{ id: first.id }]);
  });
});

async function createStorePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "subtitle-workflow-profiles-"));
  return join(directory, "profiles.json");
}
