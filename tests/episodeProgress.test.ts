import { describe, expect, it } from "vitest";
import type { CatalogDetails, DiscoveryInteraction } from "../src/core/discovery/DiscoveryTypes";
import { catalogItemKey } from "../src/core/discovery/DiscoveryTypes";
import { resumeEpisodeSelection } from "../src/core/discovery/EpisodeProgress";

describe("TV episode resume selection", () => {
  it("starts a new show at its first regular episode", () => {
    expect(resumeEpisodeSelection(details)).toEqual({ season: 1, episode: 1 });
  });

  it("advances to the next season after the last episode of a season", () => {
    expect(resumeEpisodeSelection(details, interaction({
      watchedEpisodes: ["s1e1", "s1e2"]
    }))).toEqual({ season: 2, episode: 1 });
  });

  it("continues after the latest downloaded episode even when earlier history has gaps", () => {
    expect(resumeEpisodeSelection(details, interaction({
      watchedEpisodes: ["s1e1", "s2e1"]
    }))).toEqual({ season: 2, episode: 2 });
  });

  it("selects the final episode when the whole show is watched", () => {
    expect(resumeEpisodeSelection(details, interaction({ watched: true })))
      .toEqual({ season: 2, episode: 2 });
  });
});

const details: CatalogDetails = {
  id: "tt0000100",
  mediaType: "series",
  title: "Resume test series",
  overview: "",
  genreIds: [18],
  voteAverage: 8,
  voteCount: 100,
  popularity: 20,
  genres: [{ id: 18, name: "Drama" }],
  cast: [],
  crew: [],
  videos: [],
  seasons: [
    { seasonNumber: 0, name: "Specials", episodeCount: 3 },
    { seasonNumber: 2, name: "Season 2", episodeCount: 2 },
    { seasonNumber: 1, name: "Season 1", episodeCount: 2 }
  ],
  recommendations: []
};

function interaction(flags: Partial<DiscoveryInteraction>): DiscoveryInteraction {
  return {
    key: catalogItemKey(details),
    item: details,
    liked: false,
    disliked: false,
    watched: false,
    watchlisted: false,
    hidden: false,
    updatedAt: "2026-07-17T00:00:00.000Z",
    ...flags
  };
}
