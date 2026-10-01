// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DownloadProgress } from "../src/core/discovery/DiscoveryTypes";
import { DownloadProgressMonitor } from "../src/renderer/components/DownloadProgressMonitor";

afterEach(cleanup);

describe("DownloadProgressMonitor", () => {
  it("reveals live speed, elapsed time, remaining time, and transfer totals", async () => {
    const progress: DownloadProgress = {
      id: "active-download",
      filename: "Large.Release.mkv",
      receivedBytes: 244 * 1024 ** 2,
      totalBytes: 10.8 * 1024 ** 3,
      percent: 2.2,
      bytesPerSecond: 5.5 * 1024 ** 2,
      elapsedSeconds: 134,
      estimatedRemainingSeconds: 1860,
      status: "downloading"
    };
    const user = userEvent.setup();

    render(createElement(DownloadProgressMonitor, {
      collapsed: false,
      progress,
      onCollapse: vi.fn(),
      onDismiss: vi.fn(),
      onExpand: vi.fn(),
      onCancel: vi.fn(),
      onReveal: vi.fn()
    }));

    const moreInformation = screen.getByRole("button", { name: "More information" });
    expect(moreInformation.getAttribute("aria-expanded")).toBe("false");
    await user.click(moreInformation);

    expect(moreInformation.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("5.5 MB/s")).toBeTruthy();
    expect(screen.getByText("31 min")).toBeTruthy();
    expect(screen.getByText("2 min 14 sec")).toBeTruthy();
    expect(screen.getByText("244.0 MB / 10.8 GB")).toBeTruthy();
  });

  it("permanently dismisses a cancelled download instead of collapsing it", async () => {
    const progress: DownloadProgress = {
      id: "cancelled-download",
      filename: "Sintel.2010.1080p.mkv",
      receivedBytes: 1024,
      totalBytes: 4096,
      percent: 25,
      status: "cancelled",
      message: "Download cancelled."
    };
    const onCollapse = vi.fn();
    const onDismiss = vi.fn();
    const user = userEvent.setup();

    render(createElement(DownloadProgressMonitor, {
      collapsed: false,
      progress,
      onCollapse,
      onDismiss,
      onExpand: vi.fn(),
      onCancel: vi.fn(),
      onReveal: vi.fn()
    }));

    await user.click(screen.getByRole("button", { name: "Dismiss cancelled download" }));

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onCollapse).not.toHaveBeenCalled();
  });

  it("permanently dismisses a completed download instead of leaving a progress blob", async () => {
    const progress: DownloadProgress = {
      id: "completed-download",
      filename: "Prison.Break.S02E21.mkv",
      receivedBytes: 7.7 * 1024 ** 3,
      totalBytes: 7.7 * 1024 ** 3,
      percent: 100,
      status: "completed",
      outputPath: "D:\\Downloads\\Prison.Break.S02E21.mkv"
    };
    const onCollapse = vi.fn();
    const onDismiss = vi.fn();
    const user = userEvent.setup();

    render(createElement(DownloadProgressMonitor, {
      collapsed: false,
      progress,
      onCollapse,
      onDismiss,
      onExpand: vi.fn(),
      onCancel: vi.fn(),
      onReveal: vi.fn()
    }));

    const dismiss = screen.getByRole("button", { name: "Dismiss completed download" });
    expect(dismiss.getAttribute("title")).toBe("Permanently close download message");
    await user.click(dismiss);

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onCollapse).not.toHaveBeenCalled();
  });

  it("keeps the close button as minimize while a download is active", async () => {
    const progress: DownloadProgress = {
      id: "active-download",
      filename: "Prison.Break.S02E21.mkv",
      receivedBytes: 1024,
      totalBytes: 4096,
      percent: 25,
      status: "downloading"
    };
    const onCollapse = vi.fn();
    const onDismiss = vi.fn();
    const user = userEvent.setup();

    render(createElement(DownloadProgressMonitor, {
      collapsed: false,
      progress,
      onCollapse,
      onDismiss,
      onExpand: vi.fn(),
      onCancel: vi.fn(),
      onReveal: vi.fn()
    }));

    await user.click(screen.getByRole("button", { name: "Minimize download progress" }));

    expect(onCollapse).toHaveBeenCalledOnce();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
