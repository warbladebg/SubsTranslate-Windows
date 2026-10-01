// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ProgressPanel } from "../src/renderer/components/ProgressPanel";
afterEach(cleanup);
it("shows only the latest update while preserving measured progress", () => {
  const messages = Array.from({ length: 100 }, (_, index) => ({ stage: "Remuxing", message: `Update ${index}`, progressPercent: index / 2 }));
  const { rerender } = render(createElement(ProgressPanel, { messages, busy: true }));
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("49.5");
  expect(screen.getByRole("status").textContent).toContain("Update 99");
  expect(screen.queryByRole("region", { name: "Progress history" })).toBeNull();
  expect(screen.queryByText("Update 98")).toBeNull();
  rerender(createElement(ProgressPanel, { messages: [...messages, { stage: "Preparing", message: "Waiting for output" }], busy: true }));
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("49.5");
  expect(screen.getByRole("status").textContent).toContain("Waiting for output");
  expect(screen.queryByText("Update 99")).toBeNull();
});
