// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeAppSettings } from "../src/main/settingsService";
import type { WorkflowProfile, WorkflowProfileDraft } from "../src/main/workflowProfileService";
import { WorkflowProfilesPanel } from "../src/renderer/components/WorkflowProfilesPanel";

afterEach(cleanup);

describe("Workflow profiles panel", () => {
  it("creates one profile with independently configurable Translation and Media parts", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async (draft: WorkflowProfileDraft) => ({
      ...draft,
      id: "saved-profile",
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z"
    } as WorkflowProfile));

    render(createElement(WorkflowProfilesPanel, {
      currentSettings: normalizeAppSettings({ providerId: "mock" }),
      profiles: [],
      onSave,
      onDelete: vi.fn(async () => undefined)
    }));

    await user.click(screen.getByRole("button", { name: /New workflow profile/i }));
    await user.type(screen.getByLabelText("Profile name"), "TV English to Bulgarian");

    expect((screen.getByLabelText("Track to translate") as HTMLSelectElement).value).toBe("english");
    expect((screen.getByLabelText("Enable translation") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Enable media output") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Process audio") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Include subtitles") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/translated result is passed directly to Media output/i)).toBeTruthy();

    await user.click(screen.getByLabelText("Process audio"));
    await user.selectOptions(screen.getByLabelText("Output"), "replace-original");
    expect(screen.queryByLabelText("If output file already exists")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Save profile" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      kind: "workflow",
      config: expect.objectContaining({
        translation: expect.objectContaining({
          enabled: true,
          trackPreference: "english"
        }),
        media: expect.objectContaining({
          enabled: true,
          audioEnabled: false,
          subtitlesEnabled: true,
          outputMode: "replace-original"
        })
      })
    }));
  });
});
