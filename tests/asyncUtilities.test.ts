import { afterEach, describe, expect, it, vi } from "vitest";
import { getEventListeners } from "node:events";
import { abortableDelay } from "../src/core/async/abortableDelay";
import { mapWithConcurrency } from "../src/core/async/mapWithConcurrency";
import { AsyncTtlCache } from "../src/core/cache/AsyncTtlCache";

afterEach(() => vi.useRealTimers());

describe("abortable delays", () => {
  it("rejects an already cancelled wait without installing a timer", async () => {
    vi.useFakeTimers();
    await expect(abortableDelay(1_000, AbortSignal.abort(), "cancelled"))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("removes abort listeners when repeated waits finish", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    for (let index = 0; index < 20; index++) {
      const wait = abortableDelay(10, controller.signal, "cancelled");
      await vi.advanceTimersByTimeAsync(10);
      await wait;
    }
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("clears the timer and listener when cancelled", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const wait = expect(abortableDelay(1_000, controller.signal, "cancelled"))
      .rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await wait;
    expect(vi.getTimerCount()).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });
});

describe("concurrent mapping", () => {
  it("starts queued work before a slow first item finishes and preserves result order", async () => {
    const releases = new Map<number, (value: number) => void>();
    const operation = vi.fn((value: number) => new Promise<number>((resolve) => releases.set(value, resolve)));
    const result = mapWithConcurrency([0, 1, 2, 3], 2, operation);
    expect(operation.mock.calls.map(([value]) => value)).toEqual([0, 1]);
    releases.get(1)!(10);
    await Promise.resolve();
    expect(operation.mock.calls.map(([value]) => value)).toEqual([0, 1, 2]);
    releases.get(2)!(20);
    await Promise.resolve();
    releases.get(3)!(30);
    releases.get(0)!(0);
    await expect(result).resolves.toEqual([0, 10, 20, 30]);
  });

  it("does not schedule remaining work after failure", async () => {
    const operation = vi.fn(async (value: number) => {
      if (value === 0) throw new Error("failed");
      return value;
    });
    await expect(mapWithConcurrency([0, 1, 2, 3], 2, operation)).rejects.toThrow("failed");
    expect(operation).toHaveBeenCalledTimes(2);
    await expect(mapWithConcurrency([], 0, operation)).rejects.toThrow(RangeError);
  });
});

describe("async TTL cache", () => {
  it("shares concurrent loads, expires entries and evicts the least recently used", async () => {
    vi.useFakeTimers();
    const cache = new AsyncTtlCache<number>(2);
    const loader = vi.fn(async () => 1);
    await expect(Promise.all([cache.getOrLoad("a", 100, loader), cache.getOrLoad("a", 100, loader)]))
      .resolves.toEqual([1, 1]);
    expect(loader).toHaveBeenCalledTimes(1);
    await cache.getOrLoad("b", 100, loader);
    await cache.getOrLoad("a", 100, loader);
    await cache.getOrLoad("c", 100, loader);
    await cache.getOrLoad("b", 100, loader);
    expect(loader).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(100);
    await cache.getOrLoad("b", 100, loader);
    expect(loader).toHaveBeenCalledTimes(5);
  });

  it("does not let cleared in-flight work replace a new entry", async () => {
    const cache = new AsyncTtlCache<number>(2);
    let release!: (value: number) => void;
    const stale = cache.getOrLoad("key", 100, () => new Promise<number>((resolve) => { release = resolve; }));
    await Promise.resolve();
    cache.clear();
    await cache.getOrLoad("key", 100, async () => 2);
    release(1);
    await expect(stale).resolves.toBe(1);
    await expect(cache.getOrLoad("key", 100, async () => 3)).resolves.toBe(2);
  });

  it("retries failures and bypasses cached values when TTL is zero", async () => {
    const cache = new AsyncTtlCache<number>(2);
    await expect(cache.getOrLoad("key", 100, async () => { throw new Error("offline"); }))
      .rejects.toThrow("offline");
    await expect(cache.getOrLoad("key", 100, async () => 2)).resolves.toBe(2);
    await expect(cache.getOrLoad("key", 0, async () => 3)).resolves.toBe(3);
    await expect(cache.getOrLoad("key", 100, async () => 4)).resolves.toBe(2);
  });
});
