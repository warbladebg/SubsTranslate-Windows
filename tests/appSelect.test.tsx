// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppSelect } from "../src/renderer/components/AppSelect";

afterEach(cleanup);

describe("AppSelect", () => {
  it("renders its option list inside the app and selects an item without a native popup", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <AppSelect
        ariaLabel="Audio track"
        value="1"
        options={[
          { value: "1", label: "#1 / AC-3" },
          { value: "4", label: "#4 / DTS" }
        ]}
        onChange={onChange}
      />
    );

    expect(container.querySelector("select")).toBeNull();
    await user.click(screen.getByRole("combobox", { name: "Audio track" }));
    expect(screen.getByRole("listbox", { name: "Audio track options" })).toBeTruthy();

    await user.click(screen.getByRole("option", { name: "#4 / DTS" }));
    expect(onChange).toHaveBeenCalledWith("4");
    expect(screen.queryByRole("listbox", { name: "Audio track options" })).toBeNull();
  });

  it("closes on Escape without changing the selected value", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <AppSelect
        ariaLabel="Episode"
        value="1"
        options={[
          { value: "1", label: "Episode 1" },
          { value: "2", label: "Episode 2" }
        ]}
        onChange={onChange}
      />
    );

    const trigger = screen.getByRole("combobox", { name: "Episode" });
    await user.click(trigger);
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox", { name: "Episode options" })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });
});
