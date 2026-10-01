import { describe, expect, it, vi } from "vitest";
import { discoveryGenreId } from "../src/core/discovery/DiscoveryFilters";
import type { CatalogItem } from "../src/core/discovery/DiscoveryTypes";
import { StreamingCatalogueService } from "../src/main/streamingCatalogueService";

describe("streaming catalogue service", () => {
  it("filters paginated Cinemeta candidates by WatchHub service, genre, and rating", async () => {
    const matrix = item("tt0133093", "The Matrix", ["Action"], 8.7);
    const comedy = item("tt1254207", "Big Buck Bunny", ["Comedy"], 7.1);
    const lowRatedAction = item("tt1000001", "Low Rated Action", ["Action"], 5.2);
    const catalogService = {
      browseCatalogueCandidates: vi.fn().mockResolvedValue({
        items: [matrix, comedy, lowRatedAction],
        nextSkip: 50,
        hasMore: false
      })
    };
    const availabilityService = {
      getAvailability: vi.fn().mockResolvedValue({
        entries: [
          { key: `movie:${matrix.id}`, services: ["netflix"] },
          { key: `movie:${comedy.id}`, services: ["prime-video"] },
          { key: `movie:${lowRatedAction.id}`, services: ["netflix"] }
        ],
        checkedItems: 3,
        failedItems: 0
      })
    };
    const service = new StreamingCatalogueService(
      catalogService as never,
      availabilityService as never
    );

    const page = await service.browse({
      streamingServices: ["netflix"],
      mediaType: "movie",
      genreIds: [discoveryGenreId("Action")],
      minimumRating: 7,
      query: "",
      skip: 0
    });

    expect(page).toEqual({
      items: [matrix],
      nextSkip: 50,
      hasMore: false,
      scannedItems: 3,
      failedItems: 0
    });
    expect(catalogService.browseCatalogueCandidates).toHaveBeenCalledWith(expect.objectContaining({
      streamingServices: ["netflix"],
      mediaType: "movie",
      genreIds: [discoveryGenreId("Action")]
    }));
    expect(availabilityService.getAvailability).toHaveBeenCalledWith(
      expect.any(Array),
      { useCache: false }
    );
  });

  it("scans enough provider pages to return 100 initial service matches without losing overflow", async () => {
    const firstPage = Array.from({ length: 60 }, (_, index) =>
      item(`tt${String(1_000_000 + index)}`, `First ${index}`, ["Action"], 8)
    );
    const secondPage = Array.from({ length: 60 }, (_, index) =>
      item(`tt${String(2_000_000 + index)}`, `Second ${index}`, ["Action"], 8)
    );
    const catalogService = {
      browseCatalogueCandidates: vi.fn()
        .mockResolvedValueOnce({ items: firstPage, nextSkip: 50, hasMore: true })
        .mockResolvedValueOnce({ items: secondPage, nextSkip: 100, hasMore: true })
    };
    const availabilityService = {
      getAvailability: vi.fn(async (items: Array<{ id: string; mediaType: string }>) => ({
        entries: items.map((candidate) => ({
          key: `${candidate.mediaType}:${candidate.id}`,
          services: ["netflix"]
        })),
        checkedItems: items.length,
        failedItems: 0
      }))
    };
    const service = new StreamingCatalogueService(
      catalogService as never,
      availabilityService as never
    );

    const page = await service.browse({
      streamingServices: ["netflix"],
      mediaType: "movie",
      genreIds: [],
      minimumRating: 0,
      query: "",
      skip: 0
    });

    expect(page.items).toHaveLength(100);
    expect(page).toMatchObject({
      nextSkip: 50,
      hasMore: true,
      scannedItems: 120,
      failedItems: 0
    });
    expect(new Set(page.items.map((candidate) => candidate.id))).toHaveLength(100);
    expect(catalogService.browseCatalogueCandidates).toHaveBeenNthCalledWith(1, expect.objectContaining({ skip: 0 }));
    expect(catalogService.browseCatalogueCandidates).toHaveBeenNthCalledWith(2, expect.objectContaining({ skip: 50 }));
  });

  it("scans every remaining page for Show all while retaining all active filters", async () => {
    const netflixAction = item("tt3000001", "Netflix Action", ["Action"], 8.2);
    const primeAction = item("tt3000002", "Prime Action", ["Action"], 8.1);
    const netflixComedy = item("tt3000003", "Netflix Comedy", ["Comedy"], 8.4);
    const lowRatedAction = item("tt3000004", "Low Action", ["Action"], 5.5);
    const catalogService = {
      browseCatalogueCandidates: vi.fn()
        .mockResolvedValueOnce({
          items: [netflixAction, primeAction],
          nextSkip: 100,
          hasMore: true
        })
        .mockResolvedValueOnce({
          items: [netflixComedy, lowRatedAction],
          nextSkip: 150,
          hasMore: false
        })
    };
    const availabilityService = {
      getAvailability: vi.fn(async (items: Array<{ id: string; mediaType: string }>) => ({
        entries: items.map((candidate) => ({
          key: `${candidate.mediaType}:${candidate.id}`,
          services: candidate.id === primeAction.id ? ["prime-video"] : ["netflix"]
        })),
        checkedItems: items.length,
        failedItems: 0
      }))
    };
    const service = new StreamingCatalogueService(
      catalogService as never,
      availabilityService as never
    );

    const page = await service.browse({
      streamingServices: ["netflix"],
      mediaType: "movie",
      genreIds: [discoveryGenreId("Action")],
      minimumRating: 7,
      query: "",
      skip: 50,
      showAll: true
    });

    expect(page).toEqual({
      items: [netflixAction],
      nextSkip: 150,
      hasMore: false,
      scannedItems: 4,
      failedItems: 0
    });
    expect(catalogService.browseCatalogueCandidates).toHaveBeenNthCalledWith(1, expect.objectContaining({
      skip: 50,
      showAll: true
    }));
    expect(catalogService.browseCatalogueCandidates).toHaveBeenNthCalledWith(2, expect.objectContaining({
      skip: 100,
      showAll: true
    }));
    expect(availabilityService.getAvailability).toHaveBeenCalledTimes(1);
  });

  it("requires a known streaming service", async () => {
    const service = new StreamingCatalogueService(
      { browseCatalogueCandidates: vi.fn() } as never,
      { getAvailability: vi.fn() } as never
    );
    await expect(service.browse({
      streamingServices: [],
      mediaType: "all",
      genreIds: [],
      minimumRating: 0,
      query: "",
      skip: 0
    })).rejects.toThrow(/streaming service/i);
  });
});

function item(id: string, title: string, genres: string[], voteAverage: number): CatalogItem {
  return {
    id,
    mediaType: "movie",
    title,
    overview: "",
    genreIds: genres.map(discoveryGenreId),
    voteAverage,
    voteCount: 1_000,
    popularity: 50
  };
}
