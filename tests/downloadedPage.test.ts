// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadedLibrarySnapshot } from "../src/core/downloads/DownloadedLibrary";
import type { AppSettings } from "../src/main/settingsService";
import type { WorkflowProfile } from "../src/main/workflowProfileService";
import { DownloadedPage } from "../src/renderer/components/DownloadedPage";
import { installDevSubtitleTranslatorMock } from "../src/renderer/devSubtitleTranslatorMock";

beforeEach(() => {
  Object.defineProperty(window, "subtitleTranslator", {
    configurable: true,
    writable: true,
    value: undefined
  });
  installDevSubtitleTranslatorMock();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Downloaded page", () => {
  it("starts and stops seeding only when the user presses the Seed control", async () => {
    const user = userEvent.setup();
    window.subtitleTranslator.getDownloadedLibrary = vi.fn(async () => library);
    window.subtitleTranslator.getTorrentSeedStatus = vi.fn(async () => "stopped" as const);
    window.subtitleTranslator.startTorrentSeeding = vi.fn(async () => undefined);
    window.subtitleTranslator.stopTorrentSeeding = vi.fn(async () => undefined);

    render(createElement(DownloadedPage, {
      workflowProfiles: [workflowProfile], onPrepareWorkflow: vi.fn(async () => undefined)
    }));

    expect(await screen.findByRole("button", { name: "Seed torrent" })).toBeTruthy();
    expect(window.subtitleTranslator.startTorrentSeeding).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Seed torrent" }));
    expect(window.subtitleTranslator.startTorrentSeeding).toHaveBeenCalledWith(
      "tv-drive", library.titles[0].files[0].path
    );
    await user.click(await screen.findByRole("button", { name: "Stop seeding" }));
    expect(window.subtitleTranslator.stopTorrentSeeding).toHaveBeenCalledOnce();
  });

  it("shows a newly imported title after Rescan", async () => {
    const user = userEvent.setup();
    window.subtitleTranslator.getDownloadedLibrary = vi.fn(async () => ({ ...library, titles: [] }));
    window.subtitleTranslator.rescanDownloadedLibrary = vi.fn(async () => library);

    render(createElement(DownloadedPage, {
      workflowProfiles: [workflowProfile],
      onPrepareWorkflow: vi.fn(async () => undefined)
    }));

    expect(await screen.findByText("No downloaded titles yet")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Rescan" }));
    expect(await screen.findByRole("button", { name: /Test Show/ })).toBeTruthy();
    expect(window.subtitleTranslator.rescanDownloadedLibrary).toHaveBeenCalledOnce();
  });

  it("prepares either one episode or the downloaded files for an entire season", async () => {
    const user = userEvent.setup();
    window.subtitleTranslator.getDownloadedLibrary = vi.fn(async () => library);
    window.subtitleTranslator.rescanDownloadedLibrary = vi.fn(async () => library);
    window.subtitleTranslator.openPath = vi.fn(async () => undefined);
    window.subtitleTranslator.deleteDownloadedFile = vi.fn(async () => ({
      ...library,
      titles: [{
        ...library.titles[0],
        files: [library.titles[0].files[0]]
      }]
    }));
    window.subtitleTranslator.scanExternalDownloadLocations = vi.fn(async () => ({
      defaultLocationId: "tv-drive",
      scannedAt: "2026-07-20T00:00:00.000Z",
      locations: library.locations!
    }));
    const onPrepareWorkflow = vi.fn(async () => undefined);

    render(createElement(DownloadedPage, {
      workflowProfiles: [workflowProfile],
      onPrepareWorkflow
    }));

    expect(await screen.findByRole("button", { name: /Test Show/ })).toBeTruthy();
    expect(screen.getAllByText("TV Drive").length).toBeGreaterThan(0);
    expect(screen.getByText("Backup Drive · not connected")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Find drives" }));
    expect(window.subtitleTranslator.scanExternalDownloadLocations).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Entire season" }));
    await user.click(screen.getByRole("button", { name: "Prepare workflow in Media" }));

    expect(onPrepareWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeLabel: "Season 1",
        videoPaths: ["D:\\Library\\TV Shows\\Test Show [tt1]\\Season 01\\S01E01.mkv", "D:\\Library\\TV Shows\\Test Show [tt1]\\Season 01\\S01E02.mkv"],
        outputDirectory: "D:\\Library\\TV Shows\\Test Show [tt1]\\Processed\\Season 01"
      }),
      workflowProfile
    );

    await user.click(screen.getByRole("button", { name: "Episode" }));
    await user.click(screen.getByRole("button", { name: /S01E02/ }));
    await user.click(screen.getByRole("button", { name: "Play selected" }));
    expect(window.subtitleTranslator.openPath).toHaveBeenCalledWith(
      "D:\\Library\\TV Shows\\Test Show [tt1]\\Season 01\\S01E02.mkv"
    );
    await user.click(screen.getByRole("button", { name: "Prepare workflow in Media" }));
    expect(onPrepareWorkflow).toHaveBeenLastCalledWith(
      expect.objectContaining({ scopeLabel: "S01E02" }),
      workflowProfile
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Delete selected" }));
    expect(window.confirm).toHaveBeenCalledWith("Move S01E02.mkv to the Recycle Bin?");
    expect(window.subtitleTranslator.deleteDownloadedFile).toHaveBeenCalledWith({
      libraryLocationId: "tv-drive",
      titleKey: "series:tt1",
      fileId: "episode-2"
    });
    expect(screen.queryByRole("button", { name: /S01E02/ })).toBeNull();
  });

  it("shows imported TV files without episode numbers in an Unsorted group", async () => {
    const user = userEvent.setup();
    const importedLibrary: DownloadedLibrarySnapshot = {
      ...library,
      titles: [{
        ...library.titles[0],
        files: [{
          ...library.titles[0].files[0],
          id: "bonus-file",
          filename: "bonus.mkv",
          path: "D:\\Library\\TV Shows\\Test Show [tt1]\\bonus.mkv",
          season: undefined,
          episode: undefined,
          processedDirectoryPath: "D:\\Library\\TV Shows\\Test Show [tt1]\\Processed"
        }]
      }]
    };
    window.subtitleTranslator.getDownloadedLibrary = vi.fn(async () => importedLibrary);
    const onPrepareWorkflow = vi.fn(async () => undefined);

    render(createElement(DownloadedPage, {
      workflowProfiles: [workflowProfile],
      onPrepareWorkflow
    }));

    expect(await screen.findByRole("button", { name: /bonus.mkv/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Entire season" }));
    await user.click(screen.getByRole("button", { name: "Prepare workflow in Media" }));
    expect(onPrepareWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ scopeLabel: "Unsorted episodes", videoPaths: ["D:\\Library\\TV Shows\\Test Show [tt1]\\bonus.mkv"] }),
      workflowProfile
    );
  });
});

const demoSettings: AppSettings = {
  targetLanguage: "Bulgarian",
  targetLanguageCode: "bg",
  providerId: "mock",
  quality: "balanced",
  contextMode: "auto",
  outputConflictMode: "versioned",
  batchUnlocked: true,
  gemini: {
    modelId: "gemini-3.1-flash-lite",
    thinkingLevel: "minimal",
    temperature: 0.2,
    maxOutputTokens: 8192,
    useStructuredJson: true,
    apiSurface: "models.generateContent",
    rateLimitMode: "auto-safe",
    manualRateLimits: {
      rpmLimit: 15,
      tpmLimit: 250_000,
      rpdLimit: 500,
      stopAfterDailyPercentage: 90,
      maxConcurrentRequests: 1
    }
  },
  vercel: {
    modelId: "google/gemini-3.1-flash-lite",
    temperature: 0.2,
    maxOutputTokens: 8192,
    apiSurface: "openai.chat.completions",
    rateLimitMode: "auto-safe",
    manualRateLimits: {
      rpmLimit: 15,
      tpmLimit: 250_000,
      rpdLimit: 500,
      stopAfterDailyPercentage: 90,
      maxConcurrentRequests: 1
    }
  }
};

const workflowProfile: WorkflowProfile = {
  id: "workflow-profile",
  name: "TV living room",
  kind: "workflow",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  config: {
    translation: {
      enabled: true,
      settings: demoSettings,
      sampleMode: "none",
      trackPreference: "english"
    },
    media: {
      enabled: true,
      audioEnabled: true,
      audioProfileId: "ac3-5-1",
      audioGainDb: 0,
      keepOnlySelectedAudioTrack: false,
      subtitlesEnabled: true,
      subtitleEncodingId: "utf-8",
      keepOnlyNewSubtitleTrack: false,
      outputConflictMode: "versioned",
      outputMode: "new-file",
      outputContainerId: "mkv"
    }
  }
};

const library: DownloadedLibrarySnapshot = {
  rootDirectory: "D:\\Library",
  moviesDirectory: "D:\\Library\\Movies",
  seriesDirectory: "D:\\Library\\TV Shows",
  scannedAt: "2026-07-20T00:00:00.000Z",
  locations: [{
    id: "tv-drive",
    label: "TV Drive",
    path: "D:\\Library",
    isExternal: true,
    isAvailable: true,
    isDefault: true,
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z"
  }, {
    id: "backup-drive",
    label: "Backup Drive",
    path: "E:\\Library",
    isExternal: true,
    isAvailable: false,
    isDefault: false,
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z"
  }],
  titles: [{
    key: "series:tt1",
    catalogId: "tt1",
    imdbId: "tt1",
    mediaType: "series",
    title: "Test Show",
    directoryPath: "D:\\Library\\TV Shows\\Test Show [tt1]",
    processedDirectoryPath: "D:\\Library\\TV Shows\\Test Show [tt1]\\Processed",
    downloadedAt: "2026-07-20T00:00:00.000Z",
    totalBytes: 2_000,
    libraryLocationId: "tv-drive",
    libraryLocationLabel: "TV Drive",
    files: [1, 2].map((episode) => ({
      id: `episode-${episode}`,
      path: `D:\\Library\\TV Shows\\Test Show [tt1]\\Season 01\\S01E0${episode}.mkv`,
      filename: `S01E0${episode}.mkv`,
      sizeBytes: 1_000,
      modifiedAt: "2026-07-20T00:00:00.000Z",
      downloadedAt: "2026-07-20T00:00:00.000Z",
      season: 1,
      episode,
      processedDirectoryPath: "D:\\Library\\TV Shows\\Test Show [tt1]\\Processed\\Season 01"
    }))
  }]
};
