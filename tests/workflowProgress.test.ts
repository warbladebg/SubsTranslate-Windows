import { describe, expect, it } from "vitest";
import {
  getWorkflowPhaseProgressRanges,
  scaleWorkflowProgress
} from "../src/core/media/WorkflowProgress";

describe("media workflow progress", () => {
  it("maps translation and media building into one continuous single-file range", () => {
    const ranges = getWorkflowPhaseProgressRanges(0, 1, true);

    expect(ranges.translation).toEqual({ start: 0, end: 55 });
    expect(ranges.media).toEqual({ start: 55, end: 100 });
    expect(scaleWorkflowProgress(50, ranges.translation!)).toBe(27.5);
    expect(scaleWorkflowProgress(50, ranges.media)).toBe(77.5);
  });

  it("gives every batch file its own progressive slice", () => {
    const first = getWorkflowPhaseProgressRanges(0, 4, false);
    const third = getWorkflowPhaseProgressRanges(2, 4, true);

    expect(first.media).toEqual({ start: 0, end: 25 });
    expect(scaleWorkflowProgress(40, first.media)).toBe(10);
    expect(third.translation).toEqual({ start: 50, end: 63.75 });
    expect(third.media).toEqual({ start: 63.75, end: 75 });
  });

  it("clamps invalid upstream percentages to the active range", () => {
    const range = { start: 25, end: 50 };

    expect(scaleWorkflowProgress(-10, range)).toBe(25);
    expect(scaleWorkflowProgress(130, range)).toBe(50);
    expect(scaleWorkflowProgress(undefined, range)).toBeUndefined();
  });
});
