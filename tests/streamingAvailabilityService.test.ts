import { describe, expect, it, vi } from "vitest";
import { StreamingAvailabilityService } from "../src/main/streamingAvailabilityService";

describe("streaming availability service", () => {
  it("uses the fixed WatchHub endpoint, normalizes known services, and caches title checks", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(String(input)).toBe("https://watchhub.strem.io/stream/movie/tt0133093.json");
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).has("Authorization")).toBe(false);
      return json({
        streams: [
          { name: "Netflix" },
          { name: "Amazon Prime Video" },
          { name: "HBO Max" },
          { name: "Unknown provider" }
        ]
      });
    });
    const service = new StreamingAvailabilityService(fetchMock as typeof fetch);
    const items = [{ id: "tt0133093", mediaType: "movie" as const }];

    await expect(service.getAvailability(items)).resolves.toEqual({
      entries: [{ key: "movie:tt0133093", services: ["netflix", "prime-video", "max"] }],
      checkedItems: 1,
      failedItems: 0
    });
    await service.getAvailability(items);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("deduplicates safe IMDb requests, drops invalid input, and reports partial failures", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      if (String(input).includes("tt0944947")) {
        return new Response("temporarily unavailable", { status: 503 });
      }
      return json({ streams: [{ name: "Disney Plus" }] });
    });
    const service = new StreamingAvailabilityService(fetchMock as typeof fetch);

    const result = await service.getAvailability([
      { id: "tt0133093", mediaType: "movie" },
      { id: "tt0133093", mediaType: "movie" },
      { id: "tt0944947", mediaType: "series" },
      { id: "../unsafe", mediaType: "movie" }
    ]);

    expect(result).toEqual({
      entries: [{ key: "movie:tt0133093", services: ["disney-plus"] }],
      checkedItems: 2,
      failedItems: 1
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("can bypass the availability cache for live catalogue searches", async () => {
    const fetchMock = vi.fn(async () => json({ streams: [{ name: "Netflix" }] }));
    const service = new StreamingAvailabilityService(fetchMock as typeof fetch);
    const items = [{ id: "tt0133093", mediaType: "movie" as const }];

    await service.getAvailability(items, { useCache: false });
    await service.getAvailability(items, { useCache: false });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function json(value: unknown): Response {
  const body = JSON.stringify(value);
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "content-length": String(new TextEncoder().encode(body).byteLength)
    }
  });
}
