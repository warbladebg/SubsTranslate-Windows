// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MediaToolsPage } from "../src/renderer/components/MediaToolsPage";
import { installDevSubtitleTranslatorMock } from "../src/renderer/devSubtitleTranslatorMock";
import { normalizeAppSettings } from "../src/main/settingsService";
import type { ProbeResult } from "../src/core/video/ProbeResult";
import type { SubtitleTrack } from "../src/core/video/SubtitleTrack";
import type { WorkflowProfile } from "../src/main/workflowProfileService";
const settings = normalizeAppSettings({ providerId: "mock" });
const subtitle = (index: number, language: string): SubtitleTrack => ({ index, language, codecName: "subrip", codecType: "subtitle", title: "", isSupported: true, isTextBased: true, isImageBased: false, requiresOcr: false, supportedFormat: "srt" });
const probe: ProbeResult = { filePath: "D:/episode.mkv", formatName: "matroska", videoTracks: [], otherStreams: [], audioTracks: [{ index: 1, codecName: "ac3", codecType: "audio", language: "rus", title: "First" }, { index: 4, codecName: "eac3", codecType: "audio", language: "eng", title: "Chosen" }], subtitleTracks: [subtitle(6, "rus"), subtitle(7, "rus"), subtitle(9, "eng")] };
const profile: WorkflowProfile = { id: "english", name: "English preset", kind: "workflow", createdAt: "", updatedAt: "", config: { translation: { enabled: true, settings, sampleMode: "none", trackPreference: "english" }, media: { enabled: true, audioEnabled: true, audioProfileId: "ac3-5-1", audioGainDb: 0, keepOnlySelectedAudioTrack: true, subtitlesEnabled: true, subtitleEncodingId: "utf-8", keepOnlyNewSubtitleTrack: false, outputConflictMode: "versioned", outputMode: "new-file", outputContainerId: "mkv" } } };
function Harness() {
  const [track, setTrack] = useState<SubtitleTrack | undefined>(probe.subtitleTracks[1]);
  return createElement(MediaToolsPage, { settings, workflowProfiles: [profile], hasGeminiKey: false, hasVercelKey: false, videoPath: probe.filePath, probe, selectedTrack: track, onSubtitleTrackSelected: setTrack, onVideoLoaded: vi.fn() });
}
beforeEach(() => {
  Object.defineProperty(window, "subtitleTranslator", { configurable: true, writable: true, value: undefined });
  installDevSubtitleTranslatorMock();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("runs the manually selected tracks after applying an English preset without resetting them", async () => {
  const user = userEvent.setup();
  const prepare = vi.spyOn(window.subtitleTranslator, "prepareMediaForTranslation").mockRejectedValue(new Error("Test stops before media writing"));
  render(createElement(Harness));
  await user.click(screen.getByRole("button", { name: /English preset/ }));
  await user.click(screen.getByRole("combobox", { name: "Subtitle track" }));
  await user.click(screen.getByRole("option", { name: "7 / rus / subrip" }));
  await user.click(screen.getByRole("combobox", { name: "Audio track" }));
  await user.click(screen.getByRole("option", { name: /#4.*Chosen/ }));
  await user.click(screen.getByRole("button", { name: "Run workflow" }));
  expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ audioTrackIndex: 4, subtitleTrack: expect.objectContaining({ index: 7 }) }));
  expect(screen.getByRole("combobox", { name: "Subtitle track" }).textContent).toContain("7 / rus");
});
it("keeps track choices when clicking the current batch reference again", async () => {
  const user = userEvent.setup();
  const readProbe = vi.spyOn(window.subtitleTranslator, "probeVideo");
  render(createElement(Harness));
  await user.click(screen.getByRole("button", { name: "Batch files" }));
  await user.click(screen.getByRole("combobox", { name: "Reference audio track" }));
  await user.click(screen.getByRole("option", { name: /#4.*Chosen/ }));
  await user.click(screen.getByRole("button", { name: /episode.mkv.*Settings reference/ }));
  expect(readProbe).not.toHaveBeenCalled();
  expect(screen.getByRole("combobox", { name: "Reference audio track" }).textContent).toContain("#4");
});


it("shows only required inputs for a selected workflow and restores manual controls on demand", async () => {
  const user = userEvent.setup();
  render(createElement(Harness));
  await user.click(screen.getByRole("button", { name: /English preset/ }));
  expect(screen.queryByRole("button", { name: "Apply profile" })).toBeNull();
  expect(screen.queryByRole("combobox", { name: "Subtitle action" })).toBeNull();
  expect(screen.queryByRole("slider", { name: "Volume adjustment" })).toBeNull();
  expect(screen.queryByRole("combobox", { name: "Encoding" })).toBeNull();
  expect(screen.getAllByRole("button", { name: "Run workflow" })).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: /Custom setup/ }));
  expect(screen.getByRole("combobox", { name: "Subtitle action" })).toBeTruthy();
  expect(screen.getByRole("slider", { name: "Volume adjustment" })).toBeTruthy();
});
it("hides audio and subtitle inputs for a workflow that copies existing streams", async () => {
  const user = userEvent.setup();
  const copyProfile: WorkflowProfile = { ...profile, config: { ...profile.config, media: { ...profile.config.media, audioEnabled: false, subtitlesEnabled: false, keepOnlySelectedAudioTrack: false } } };
  render(createElement(MediaToolsPage, { settings, workflowProfiles: [copyProfile], hasGeminiKey: false, hasVercelKey: false, videoPath: probe.filePath, probe, onVideoLoaded: vi.fn(), onSubtitleTrackSelected: vi.fn() }));
  await user.click(screen.getByRole("button", { name: /English preset/ }));
  expect(screen.queryByRole("combobox", { name: "Audio track" })).toBeNull();
  expect(screen.queryByRole("combobox", { name: "Subtitle track" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Subtitle file" })).toBeNull();
  expect(screen.getByRole("button", { name: "Run workflow" }).hasAttribute("disabled")).toBe(false);
});
