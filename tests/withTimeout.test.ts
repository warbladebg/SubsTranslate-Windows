import { describe, expect, it } from "vitest";
import { withTimeout } from "../src/core/async/withTimeout";

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
}

describe("withTimeout", () => {
  it("returns the task result when it finishes in time", async () => {
    await expect(withTimeout(1_000, async () => "done", "timed out")).resolves.toBe("done");
  });

  it("aborts the task and reports the timeout message", async () => {
    const failure = withTimeout(5, waitForAbort, "The request timed out.");
    await expect(failure).rejects.toThrow("The request timed out.");
    await expect(failure).rejects.toHaveProperty("cause.name", "AbortError");
  });

  it("rethrows the raw abort when no message is given", async () => {
    await expect(withTimeout(5, waitForAbort)).rejects.toHaveProperty("name", "AbortError");
  });

  it("passes other failures through untouched", async () => {
    await expect(withTimeout(1_000, async () => {
      throw new Error("HTTP 500");
    }, "timed out")).rejects.toThrow("HTTP 500");
  });
});
