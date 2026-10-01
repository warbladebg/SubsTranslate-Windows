// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeAppSettings } from "../src/main/settingsService";
import { SettingsPanel } from "../src/renderer/components/SettingsPanel";

afterEach(cleanup);

describe("settings panel", () => {
  it("shows why a save failed instead of failing silently", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue(new Error("Error invoking remote method 'settings:save': Error: Invalid model id."));
    render(<SettingsPanel settings={normalizeAppSettings({ providerId: "gemini" })} hasGeminiKey={false} hasVercelKey={false} onSave={onSave} />);

    await user.type(screen.getByLabelText("Gemini API key"), "  secret-key  ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Invalid model id.");
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ providerId: "gemini" }), {
      geminiApiKey: "  secret-key  ",
      vercelApiKey: ""
    });
    // The typed key is kept so the user can fix the problem and retry.
    expect(screen.getByLabelText("Gemini API key")).toHaveProperty("value", "  secret-key  ");
  });

  it("edits only the active provider's settings", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const settings = normalizeAppSettings({ providerId: "vercel" });
    render(<SettingsPanel settings={settings} hasGeminiKey={false} hasVercelKey={true} onSave={onSave} />);

    expect(screen.getByText("Key saved")).toBeTruthy();
    expect(screen.queryByLabelText("Thinking")).toBeNull();
    const temperature = screen.getByLabelText("Temperature");
    await user.clear(temperature);
    await user.type(temperature, "0.4");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const saved = onSave.mock.calls[0][0];
    expect(saved.vercel.temperature).toBe(0.4);
    expect(saved.gemini).toEqual(settings.gemini);
  });
});
