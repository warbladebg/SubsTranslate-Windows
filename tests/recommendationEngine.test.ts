import { describe, expect, it } from "vitest";
import type { CatalogItem, DiscoveryInteraction } from "../src/core/discovery/DiscoveryTypes";
import { catalogItemKey } from "../src/core/discovery/DiscoveryTypes";
import { rankRecommendations } from "../src/core/discovery/RecommendationEngine";

describe("recommendation engine", () => {
  it("uses likes and dislikes while excluding hidden titles", () => {
    const liked = item(1, "Liked sci-fi", [878]);
    const disliked = item(2, "Disliked romance", [10749]);
    const sciFi = item(3, "Space mystery", [878, 9648]);
    const romance = item(4, "Romantic drama", [10749, 18]);
    const hidden = item(5, "Hidden sci-fi", [878]);
    const interactions: DiscoveryInteraction[] = [
      interaction(liked, { liked: true }),
      interaction(disliked, { disliked: true }),
      interaction(hidden, { hidden: true })
    ];

    const ranked = rankRecommendations([romance, hidden, sciFi], interactions, 10, new Date("2026-07-17"));

    expect(ranked.map(({ id }) => id)).toEqual(["tt0000003", "tt0000004"]);
    expect(ranked).not.toContainEqual(expect.objectContaining({ id: "tt0000005" }));
  });

  it("penalizes watched items and returns each candidate only once", () => {
    const fresh = item(10, "Fresh", [12]);
    const watched = item(11, "Watched", [12]);
    const ranked = rankRecommendations(
      [watched, fresh, fresh],
      [interaction(watched, { watched: true })],
      10,
      new Date("2026-07-17")
    );

    expect(ranked.map(({ id }) => id)).toEqual(["tt0000010", "tt0000011"]);
  });

  it("diversifies a recommendation row instead of returning only one genre cluster", () => {
    const candidates = [
      item(20, "Science one", [878]),
      item(21, "Science two", [878]),
      item(22, "Documentary", [99])
    ];
    const ranked = rankRecommendations(candidates, [], 2, new Date("2026-07-17"));

    expect(ranked).toHaveLength(2);
    expect(ranked.some((candidate) => candidate.id === "tt0000022")).toBe(true);
  });

  it("uses ratings when a tokenless provider does not supply vote counts", () => {
    const highlyRated = { ...item(30, "Highly rated", [18]), voteAverage: 9, voteCount: 0 };
    const lowerRated = { ...item(31, "Lower rated", [18]), voteAverage: 5, voteCount: 0 };

    expect(rankRecommendations([lowerRated, highlyRated], [], 2).map(({ id }) => id))
      .toEqual(["tt0000030", "tt0000031"]);
  });

  it("learns from favourites and watched titles while giving favourites the stronger signal", () => {
    const favourite = item(40, "Favourite science", [878]);
    const watched = item(41, "Watched documentary", [99]);
    const science = item(42, "New science", [878]);
    const documentary = item(43, "New documentary", [99]);
    const unrelated = item(44, "Unrelated western", [37]);
    const ranked = rankRecommendations(
      [unrelated, documentary, science],
      [
        interaction(favourite, { watchlisted: true }),
        interaction(watched, { watched: true })
      ],
      10,
      new Date("2026-07-17")
    );

    expect(ranked.map(({ id }) => id)).toEqual([
      "tt0000042",
      "tt0000043",
      "tt0000044"
    ]);
  });

  it("uses partial TV episode progress as a taste signal without treating the show as fully watched", () => {
    const startedSeries = {
      ...item(50, "Started mystery", [9648]),
      mediaType: "series" as const
    };
    const relatedSeries = {
      ...item(51, "Related mystery", [9648]),
      mediaType: "series" as const
    };
    const unrelatedMovie = item(52, "Unrelated movie", [35]);
    const ranked = rankRecommendations(
      [unrelatedMovie, relatedSeries],
      [interaction(startedSeries, {
        watchedEpisodes: ["s1e1", "s1e2", "s1e3"],
        knownEpisodeCount: 10
      })],
      10,
      new Date("2026-07-17")
    );

    expect(ranked.map(({ id }) => id)).toEqual(["tt0000051", "tt0000052"]);
  });

  it("weights recent preference signals more heavily without forgetting older favourites", () => {
    const recentFavourite = item(60, "Recent favourite", [80]);
    const oldFavourite = item(61, "Old favourite", [36]);
    const recentMatch = item(62, "Recent taste match", [80]);
    const oldMatch = item(63, "Old taste match", [36]);
    const ranked = rankRecommendations(
      [oldMatch, recentMatch],
      [
        interaction(recentFavourite, { watchlisted: true, updatedAt: "2026-07-16T00:00:00.000Z" }),
        interaction(oldFavourite, { watchlisted: true, updatedAt: "2018-01-01T00:00:00.000Z" })
      ],
      10,
      new Date("2026-07-17")
    );

    expect(ranked.map(({ id }) => id)).toEqual(["tt0000062", "tt0000063"]);
  });
});

function item(id: number, title: string, genreIds: number[]): CatalogItem {
  return {
    id: `tt${String(id).padStart(7, "0")}`,
    mediaType: "movie",
    title,
    overview: "",
    genreIds,
    voteAverage: 8,
    voteCount: 5_000,
    popularity: 100,
    releaseDate: "2025-01-01"
  };
}

function interaction(
  catalogItem: CatalogItem,
  flags: Partial<Pick<
    DiscoveryInteraction,
    | "liked"
    | "disliked"
    | "watched"
    | "watchedEpisodes"
    | "knownEpisodeCount"
    | "watchlisted"
    | "hidden"
    | "updatedAt"
  >>
): DiscoveryInteraction {
  return {
    key: catalogItemKey(catalogItem),
    item: catalogItem,
    liked: false,
    disliked: false,
    watched: false,
    watchlisted: false,
    hidden: false,
    updatedAt: "2026-07-17T00:00:00.000Z",
    ...flags
  };
}
