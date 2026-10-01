// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioProfileEditor } from "../src/renderer/components/AudioProfileEditor";
import { DEFAULT_AUDIO_PROFILE_SLOTS, normalizeAudioProfileSlots } from "../src/renderer/audioProfileSlots";

afterEach(cleanup);

describe("audio profile editor", () => {
  it("chooses a format and bitrate for one of four slots", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(createElement(AudioProfileEditor, {
      slots: DEFAULT_AUDIO_PROFILE_SLOTS,
      onSave,
      onCancel: vi.fn()
    }));

    expect(screen.getAllByText(/^Slot [1-4]$/)).toHaveLength(4);
    await user.click(screen.getByRole("combobox", { name: "Slot 2 audio format" }));
    await user.click(screen.getByRole("option", { name: "Opus Stereo" }));
    await user.click(screen.getByRole("combobox", { name: "Slot 2 audio bitrate" }));
    await user.click(screen.getByRole("option", { name: "192 kbps" }));
    await user.click(screen.getByRole("button", { name: "Save audio profiles" }));

    expect(onSave).toHaveBeenCalledWith(["ac3-5-1", "custom-opus-2-192", "aac-stereo", "custom-mp3-2-256"]);
  });

  it("rejects invalid saved slot lists", () => {
    expect(normalizeAudioProfileSlots(["copy", "ac3-5-1", "eac3-5-1", "aac-stereo"]))
      .toEqual(DEFAULT_AUDIO_PROFILE_SLOTS);
    expect(normalizeAudioProfileSlots(["ac3-5-1", "unknown", "eac3-5-1", "aac-stereo"]))
      .toEqual(DEFAULT_AUDIO_PROFILE_SLOTS);
  });
});
