import { describe, expect, it } from "vitest";
import {
  countDiscoveryFilters,
  DEFAULT_DISCOVERY_FILTERS,
  discoveryGenreId,
  filterCatalogItems
} from "../src/core/discovery/DiscoveryFilters";
import type { CatalogItem, StreamingServiceId } from "../src/core/discovery/DiscoveryTypes";
import { catalogItemKey } from "../src/core/discovery/DiscoveryTypes";

describe("discovery catalog filters", () => {
  const actionMovie = item("tt0133093", "movie", ["Action", "Sci-Fi"], 8.7);
  const dramaSeries = item("tt0944947", "series", ["Drama"], 9.2);
  const comedyMovie = item("tt1254207", "movie", ["Animation", "Comedy"], 7.1);

  it("combines type, genre, and rating filters while treating selected genres as alternatives", () => {
    const filtered = filterCatalogItems(
      [actionMovie, dramaSeries, comedyMovie],
      {
        mediaType: "movie",
        genreIds: [discoveryGenreId("Action"), discoveryGenreId("Comedy")],
        streamingServices: [],
        minimumRating: 8
      },
      new Map()
    );
    expect(filtered.map((candidate) => candidate.id)).toEqual(["tt0133093"]);
  });

  it("matches a title when it is available on any selected streaming service", () => {
    const availability = new Map<string, ReadonlySet<StreamingServiceId>>([
      [catalogItemKey(actionMovie), new Set(["netflix"])],
      [catalogItemKey(comedyMovie), new Set(["prime-video"])]
    ]);
    expect(filterCatalogItems(
      [actionMovie, comedyMovie],
      { ...DEFAULT_DISCOVERY_FILTERS, streamingServices: ["netflix", "max"] },
      availability
    )).toEqual([actionMovie]);
  });

  it("counts each active selection for the filter badge", () => {
    expect(countDiscoveryFilters({
      mediaType: "series",
      genreIds: [discoveryGenreId("Drama"), discoveryGenreId("Mystery")],
      streamingServices: ["netflix"],
      minimumRating: 7
    })).toBe(5);
  });
});

function item(
  id: string,
  mediaType: CatalogItem["mediaType"],
  genres: string[],
  voteAverage: number
): CatalogItem {
  return {
    id,
    mediaType,
    title: id,
    overview: "",
    genreIds: genres.map(discoveryGenreId),
    voteAverage,
    voteCount: 1_000,
    popularity: 50
  };
}
