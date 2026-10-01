import { describe, expect, it, vi } from "vitest";
import { MultiSourceRatingsService } from "../src/main/multiSourceRatingsService";

describe("multi-source ratings service", () => {
  it("loads, normalizes, and caches MDBList ratings by IMDb ID", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://api.mdblist.com");
      expect(url.pathname).toBe("/imdb/movie/tt0133093/");
      expect(url.searchParams.get("apikey")).toBe("test-key");
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).has("Authorization")).toBe(false);
      return json({
        ratings: [
          { source: "imdb", value: 8.7, votes: 2_100_000 },
          { source: "tomatoes", value: 83, votes: 211 },
          { source: "popcorn", value: 85, votes: 250_000 },
          { source: "metacritic", value: 73, votes: 35 },
          { source: "letterboxd", value: 4.2, votes: 1_200_000 },
          { source: "unknown", value: 100 }
        ]
      });
    });
    const service = new MultiSourceRatingsService(async () => "test-key", fetchMock as typeof fetch);
    const items = [{ id: "tt0133093", mediaType: "movie" as const }];

    await expect(service.getRatings(items)).resolves.toEqual({
      entries: [{
        key: "movie:tt0133093",
        ratings: [
          { source: "imdb", value: 8.7, votes: 2_100_000 },
          { source: "tomatoes", value: 83, votes: 211 },
          { source: "popcorn", value: 85, votes: 250_000 },
          { source: "metacritic", value: 73, votes: 35 },
          { source: "letterboxd", value: 4.2, votes: 1_200_000 }
        ]
      }],
      checkedItems: 1,
      failedItems: 0
    });
    await service.getRatings(items);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("supports object-shaped ratings and maps series to the MDBList show route", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/imdb/show/tt0944947/");
      return json({
        ratings: {
          trakt: 91,
          tmdb: 88,
          metacritic_user: 8.4,
          rogerebert: 3.5
        }
      });
    });
    const service = new MultiSourceRatingsService(async () => "test-key", fetchMock as typeof fetch);
    await expect(service.getRatings([{ id: "tt0944947", mediaType: "series" }])).resolves.toMatchObject({
      entries: [{
        key: "series:tt0944947",
        ratings: [
          { source: "trakt", value: 91 },
          { source: "tmdb", value: 88 },
          { source: "metacritic-user", value: 8.4 },
          { source: "rogerebert", value: 3.5 }
        ]
      }]
    });
  });

  it("rejects missing or invalid credentials without issuing unsafe requests", async () => {
    const noRequest = vi.fn();
    const missingKey = new MultiSourceRatingsService(async () => undefined, noRequest as typeof fetch);
    await expect(missingKey.getRatings([{ id: "tt0133093", mediaType: "movie" }]))
      .rejects.toThrow(/MDBList API key/i);
    await expect(new MultiSourceRatingsService(async () => "key", noRequest as typeof fetch).getRatings([
      { id: "../unsafe", mediaType: "movie" }
    ])).resolves.toEqual({ entries: [], checkedItems: 0, failedItems: 0 });
    expect(noRequest).not.toHaveBeenCalled();
  });

  it("validates a new key before it is saved", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 401 }));
    const service = new MultiSourceRatingsService(async () => undefined, fetchMock as typeof fetch);
    await expect(service.validateApiKey("rejected-key")).rejects.toThrow(/rejected/i);
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
