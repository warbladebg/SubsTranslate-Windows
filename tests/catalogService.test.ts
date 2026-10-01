import { describe, expect, it, vi } from "vitest";
import type { DiscoveryInteraction } from "../src/core/discovery/DiscoveryTypes";
import { catalogItemKey } from "../src/core/discovery/DiscoveryTypes";
import { CatalogService } from "../src/main/catalogService";
import { defaultDiscoveryPreferences } from "../src/main/discoveryStore";

describe("tokenless Cinemeta catalog service", () => {
  it("loads movie and TV catalogs without credentials or authorization headers", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      expect(url).toMatch(/^https:\/\/cinemeta-catalogs\.strem\.io\/top\/catalog\/(movie|series)\/top\.json$/);
      expect(new Headers(init?.headers).has("Authorization")).toBe(false);
      return json({
        metas: url.includes("/movie/")
          ? [preview("tt0133093", "movie", "The Matrix", ["Action", "Sci-Fi"], "1999", "8.7", 90)]
          : [preview("tt0944947", "series", "Game of Thrones", ["Drama"], "2011", "9.2", 80)]
      });
    });
    const service = new CatalogService(fetchMock as typeof fetch);

    const home = await service.getHome(defaultDiscoveryPreferences, []);
    const items = home.sections.flatMap((section) => section.items);

    expect(home.sections.map((section) => section.id)).toEqual(expect.arrayContaining([
      "recommended-movies",
      "recommended-series"
    ]));
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "tt0133093", mediaType: "movie", title: "The Matrix" }),
      expect.objectContaining({ id: "tt0944947", mediaType: "series", title: "Game of Thrones" })
    ]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps IMDb identity, details, cast, crew, trailers, seasons, and genre recommendations", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.includes("/meta/series/tt0944947.json")) {
        return json({
          meta: {
            id: "tt0944947",
            imdb_id: "tt0944947",
            type: "series",
            name: "Game of Thrones",
            description: "Series overview",
            poster: "https://untrusted.example/original.jpg",
            background: "https://untrusted.example/original-background.jpg",
            released: "2011-04-17T00:00:00Z",
            genre: ["Action", "Drama"],
            imdbRating: "9.2",
            runtime: "57 min",
            cast: ["Actor One", "Actor Two"],
            director: ["Director One"],
            writer: ["Writer One"],
            trailers: [{ source: "abcdefghi01", type: "Trailer" }],
            videos: [
              { season: 0, episode: 1, released: "2010-01-01T00:00:00Z" },
              { season: 1, episode: 1, released: "2011-04-17T00:00:00Z" },
              { season: 1, episode: 2, released: "2011-04-24T00:00:00Z" },
              { season: 2, episode: 1, released: "2012-04-01T00:00:00Z" }
            ]
          }
        });
      }
      expect(url).toContain("/catalog/series/top/genre=Action.json");
      return json({
        metas: [
          preview("tt1234567", "series", "Related Series", ["Action"], "2013", "8.0", 20),
          preview("tt0944947", "series", "Game of Thrones", ["Action"], "2011", "9.2", 80)
        ]
      });
    });
    const service = new CatalogService(fetchMock as typeof fetch);

    await expect(service.getDetails("series", "tt0944947")).resolves.toMatchObject({
      id: "tt0944947",
      imdbId: "tt0944947",
      mediaType: "series",
      runtimeMinutes: 57,
      genres: [{ name: "Action" }, { name: "Drama" }],
      cast: [{ name: "Actor One" }, { name: "Actor Two" }],
      crew: [{ name: "Director One", job: "Director" }, { name: "Writer One", job: "Writer" }],
      videos: [{ key: "abcdefghi01", site: "YouTube", type: "Trailer" }],
      seasons: [
        { seasonNumber: 0, episodeCount: 1 },
        { seasonNumber: 1, episodeCount: 2 },
        { seasonNumber: 2, episodeCount: 1 }
      ],
      recommendations: [expect.objectContaining({ id: "tt1234567" })],
      posterPath: "https://images.metahub.space/poster/small/tt0944947/img",
      backdropPath: "https://images.metahub.space/background/medium/tt0944947/img"
    });
  });

  it("searches movies and series in parallel and tolerates one provider branch failing", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      expect(url).toContain("/top/search=matrix.json");
      expect(url).toMatch(/^https:\/\/v3-cinemeta\.strem\.io\//);
      if (url.includes("/series/")) {
        return new Response("temporarily unavailable", { status: 503 });
      }
      return json({ metas: [preview("tt0133093", "movie", "The Matrix", [], "1999", "8.7", 90)] });
    });
    const service = new CatalogService(fetchMock as typeof fetch);

    await expect(service.search("matrix", defaultDiscoveryPreferences)).resolves.toMatchObject([
      { id: "tt0133093", title: "The Matrix" }
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("puts the most popular exact-title match ahead of obscure and partial matches", async () => {
    const obscureOffice = preview("tt1000001", "movie", "The Office", [], "2001", "6.2", 0);
    const popularOffice = preview("tt1000002", "movie", "The Office", [], "2005", "8.9", 0);
    const partialMatch = preview("tt1000003", "movie", "The Office Games", [], "2023", "7.1", 999);
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.includes("/catalog/movie/top/search=")) {
        return json({ metas: [obscureOffice, partialMatch, popularOffice] });
      }
      if (url.includes("/meta/movie/tt1000001.json")) {
        return json({ meta: { ...obscureOffice, popularity: 0.2 } });
      }
      if (url.includes("/meta/movie/tt1000002.json")) {
        return json({ meta: { ...popularOffice, popularity: 48 } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const service = new CatalogService(fetchMock as typeof fetch);
    const preferences = { ...defaultDiscoveryPreferences, preferredMediaType: "movie" as const };

    const results = await service.search("The Office", preferences);

    expect(results.map((item) => item.id)).toEqual(["tt1000002", "tt1000001", "tt1000003"]);
    expect(results[0]).toMatchObject({ title: "The Office", popularity: 48 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("caches identical catalog requests and never needs a user token", async () => {
    const fetchMock = vi.fn(async () =>
      json({ metas: [preview("tt0133093", "movie", "The Matrix", [], "1999", "8.7", 90)] })
    );
    const service = new CatalogService(fetchMock as typeof fetch);
    const preferences = { ...defaultDiscoveryPreferences, preferredMediaType: "movie" as const };

    await service.search("matrix", preferences);
    await service.search("matrix", preferences);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("advances catalogue pages by the provider's 50-title cursor and keeps short pages pageable", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      return json({
        metas: [preview(
          url.includes("skip=50") ? "tt2000002" : "tt2000001",
          "movie",
          url.includes("skip=50") ? "Second page" : "First page",
          ["Action"],
          "2026",
          "8.0",
          50
        )]
      });
    });
    const service = new CatalogService(fetchMock as typeof fetch);
    const request = {
      streamingServices: ["netflix" as const],
      mediaType: "movie" as const,
      genreIds: [],
      minimumRating: 0,
      query: "",
      skip: 0
    };

    const first = await service.browseCatalogueCandidates(request);
    const second = await service.browseCatalogueCandidates({ ...request, skip: first.nextSkip });

    expect(first).toMatchObject({ nextSkip: 50, hasMore: true });
    expect(second).toMatchObject({ nextSkip: 100, hasMore: true });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ href: expect.stringContaining("/skip=50.json") }),
      expect.anything()
    );
  });

  it("uses favourites and watched titles as related-catalog seeds", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.includes("genre=Action")) {
        return json({ metas: [preview("tt1375666", "movie", "Action match", ["Action"], "2010", "8.8", 85)] });
      }
      if (url.includes("genre=Documentary")) {
        return json({ metas: [preview("tt7775622", "movie", "Documentary match", ["Documentary"], "2014", "8.0", 55)] });
      }
      return json({
        metas: [
          preview("tt0133093", "movie", "The Matrix", ["Action", "Sci-Fi"], "1999", "8.7", 90),
          preview("tt3268458", "movie", "The Internet's Own Boy", ["Documentary"], "2014", "8.0", 70)
        ]
      });
    });
    const service = new CatalogService(fetchMock as typeof fetch);
    const preferences = { ...defaultDiscoveryPreferences, preferredMediaType: "movie" as const };
    const initial = await service.getHome(preferences, []);
    const items = initial.sections.find((section) => section.id === "recommended-movies")!.items;
    const matrix = items.find((item) => item.id === "tt0133093")!;
    const documentary = items.find((item) => item.id === "tt3268458")!;
    const interactions: DiscoveryInteraction[] = [
      discoveryInteraction(matrix, { watchlisted: true }),
      discoveryInteraction(documentary, { watched: true })
    ];

    const personalized = await service.getHome(preferences, interactions);

    expect(personalized.sections.map((section) => section.title)).toEqual(expect.arrayContaining([
      "Recommended movies",
      "Because you favourited The Matrix",
      "Because you watched The Internet's Own Boy"
    ]));
    expect(personalized.sections[0].subtitle).toContain("favourites, watched titles");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects invalid IDs, rate limits, oversized bodies, and invalid JSON safely", async () => {
    const noRequest = vi.fn();
    await expect(new CatalogService(noRequest as typeof fetch).getDetails("movie", "603"))
      .rejects.toThrow(/invalid catalog item id/i);
    expect(noRequest).not.toHaveBeenCalled();

    const limited = new CatalogService(
      vi.fn(async () => new Response("{}", { status: 429 })) as typeof fetch
    );
    await expect(limited.getDetails("movie", "tt0133093")).rejects.toThrow(/catalog is busy/i);

    const oversized = new CatalogService(
      vi.fn(async () => new Response("{}", {
        status: 200,
        headers: { "content-length": String(6 * 1024 * 1024) }
      })) as typeof fetch
    );
    await expect(oversized.getDetails("movie", "tt0133093")).rejects.toThrow(/size limit/i);

    const malformed = new CatalogService(
      vi.fn(async () => new Response("{not-json", { status: 200 })) as typeof fetch
    );
    await expect(malformed.getDetails("movie", "tt0133093")).rejects.toThrow(/invalid JSON/i);
  });
});

function discoveryInteraction(
  item: DiscoveryInteraction["item"],
  flags: Partial<Pick<DiscoveryInteraction, "liked" | "disliked" | "watched" | "watchlisted" | "hidden">>
): DiscoveryInteraction {
  return {
    key: catalogItemKey(item),
    item,
    liked: false,
    disliked: false,
    watched: false,
    watchlisted: false,
    hidden: false,
    updatedAt: "2026-07-17T00:00:00.000Z",
    ...flags
  };
}

function preview(
  id: string,
  type: "movie" | "series",
  name: string,
  genres: string[],
  year: string,
  imdbRating: string,
  popularity: number
) {
  return {
    id,
    imdb_id: id,
    type,
    name,
    description: `${name} overview`,
    poster: `https://images.example/${id}.jpg`,
    background: `https://images.example/${id}-background.jpg`,
    genre: genres,
    year,
    imdbRating,
    popularity
  };
}

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
