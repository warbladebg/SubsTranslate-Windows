// @vitest-environment jsdom

import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/renderer/App";
import { installDevSubtitleTranslatorMock } from "../src/renderer/devSubtitleTranslatorMock";
import type { DownloadProgress } from "../src/core/discovery/DiscoveryTypes";

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-ui-language");
  document.documentElement.lang = "";
  Object.defineProperty(window, "subtitleTranslator", {
    configurable: true,
    writable: true,
    value: undefined
  });
  Object.defineProperty(window, "scrollTo", {
    configurable: true,
    value: vi.fn()
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    value: vi.fn((callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0))
  });
  Object.defineProperty(window, "cancelAnimationFrame", {
    configurable: true,
    value: vi.fn()
  });
  window.localStorage.clear();
  installDevSubtitleTranslatorMock();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("application navigation", () => {
  it("keeps audio copy fixed beside four saved conversion slots", async () => {
    const user = userEvent.setup();
    render(createElement(App));
    await screen.findByRole("region", { name: "Discover" });
    await user.click(screen.getByRole("button", { name: "Media" }));

    const panel = (await screen.findByRole("button", { name: /Keep Original Audio/ }))
      .closest(".media-audio-panel") as HTMLElement;
    expect(panel.querySelectorAll(".profile-option")).toHaveLength(5);
    await user.click(within(panel).getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("combobox", { name: "Slot 1 audio format" }));
    await user.click(screen.getByRole("option", { name: "FLAC Stereo" }));
    await user.click(screen.getByRole("button", { name: "Save audio profiles" }));

    expect(panel.querySelectorAll(".profile-option")).toHaveLength(5);
    expect(within(panel).getByRole("button", { name: /Keep Original Audio/ })).toBeTruthy();
    expect(within(panel).getByRole("button", { name: /FLAC Stereo/ })).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem("substranslate:audio-profile-slots") ?? "null"))
      .toEqual(["custom-flac-2-lossless", "eac3-5-1", "aac-stereo", "custom-mp3-2-256"]);
  });

  it("turns on a persistent Bulgarian interface mode from the sidebar", async () => {
    const user = userEvent.setup();
    render(createElement(App));

    await screen.findByRole("region", { name: "Discover" });
    const languageSwitch = screen.getByRole("switch", { name: "Bulgarian mode" });

    expect(languageSwitch.getAttribute("aria-checked")).toBe("false");
    expect(document.documentElement.lang).toBe("en");

    await user.click(languageSwitch);

    expect(screen.getByRole("switch", { name: "Режим на български" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("button", { name: "Открий" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByText("Локално приложение")).toBeNull();
    expect(document.documentElement.lang).toBe("bg");
    expect(document.documentElement.dataset.uiLanguage).toBe("bg");
    expect(window.localStorage.getItem("substranslate:ui-language")).toBe("bg");

    cleanup();
    render(createElement(App));

    expect((await screen.findByRole("switch", { name: "Режим на български" })).getAttribute("aria-checked"))
      .toBe("true");
  });

  it("uses dark mode by default and persists theme changes", async () => {
    const user = userEvent.setup();
    render(createElement(App));

    await screen.findByRole("region", { name: "Discover" });
    const themeSwitch = screen.getByRole("switch", { name: "Dark theme" });
    expect(themeSwitch.getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText("Local desktop")).toBeNull();

    await user.click(themeSwitch);

    expect(themeSwitch.getAttribute("aria-checked")).toBe("false");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.querySelector("main")?.classList.contains("theme-dark")).toBe(false);
    expect(window.localStorage.getItem("substranslate:theme")).toBe("light");

    cleanup();
    render(createElement(App));

    expect((await screen.findByRole("switch", { name: "Dark theme" })).getAttribute("aria-checked"))
      .toBe("false");
  });

  it("keeps every primary workflow available through the redesigned shell", async () => {
    const user = userEvent.setup();
    render(createElement(App));

    expect(await screen.findByRole("region", { name: "Discover" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Search movies and TV shows" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Discovery settings" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Discover" }).getAttribute("aria-current")).toBe("page");
    expect(within(screen.getByRole("navigation", { name: "Main pages" }))
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label")))
      .toEqual(["Discover", "Downloaded", "Translate", "Media", "Statistics"]);

    await user.click(screen.getByRole("button", { name: "Downloaded" }));
    expect(await screen.findByRole("region", { name: "Downloaded" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Downloaded" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Translate" }));
    expect(await screen.findByRole("heading", { name: "Video" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose video" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Media" }));
    expect(await screen.findByRole("group", { name: "Media input mode" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Output mode" })).toBeTruthy();
    expect(screen.queryByText("Finish the file without rebuilding the video")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Downloaded" }));
    expect(await screen.findByRole("region", { name: "Downloaded" })).toBeTruthy();
    expect(document.querySelector(".app-page-mount")?.hasAttribute("hidden")).toBe(true);

    await user.click(screen.getByRole("button", { name: "Statistics" }));
    expect(await screen.findByRole("heading", { name: "Translation Statistics" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Previous Translations" })).toBeTruthy();

    expect(window.scrollTo).toHaveBeenCalledTimes(6);
  });

  it("keeps the animated download monitor available across every app page", async () => {
    let emitProgress: ((progress: DownloadProgress) => void) | undefined;
    window.subtitleTranslator.onDiscoveryDownloadProgress = vi.fn((listener) => {
      emitProgress = listener;
      return () => undefined;
    });
    window.subtitleTranslator.cancelRealDebridDownload = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(createElement(App));
    await screen.findByRole("region", { name: "Discover" });

    act(() => emitProgress?.({
      id: "download-1",
      filename: "Sintel.1080p.mkv",
      receivedBytes: 512 * 1024 ** 2,
      totalBytes: 2 * 1024 ** 3,
      percent: 25,
      status: "downloading"
    }));

    expect(screen.getByRole("region", { name: "Download progress" })).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "25% downloaded" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Minimize download progress" }));

    await user.click(screen.getByRole("button", { name: "Translate" }));
    expect(await screen.findByRole("heading", { name: "Video" })).toBeTruthy();
    const blob = screen.getByRole("button", {
      name: "Open download progress: Sintel.1080p.mkv, 25%"
    });
    expect(blob).toBeTruthy();

    await user.click(blob);
    const progressRegion = screen.getByRole("region", { name: "Download progress" });
    expect(within(progressRegion).getByRole("progressbar", { name: "25% downloaded" })).toBeTruthy();
    await user.click(within(progressRegion).getByRole("button", { name: "Cancel" }));
    expect(window.subtitleTranslator.cancelRealDebridDownload).toHaveBeenCalled();
  });
});
