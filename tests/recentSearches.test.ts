import { describe, expect, it } from "vitest";
import {
  addRecentDiscoverySearch,
  MAX_RECENT_DISCOVERY_SEARCHES,
  normalizeRecentDiscoverySearches
} from "../src/core/discovery/RecentSearches";

describe("recent discovery searches", () => {
  it("normalizes, deduplicates, and limits stored searches", () => {
    expect(normalizeRecentDiscoverySearches([
      "  Big   Buck Bunny  ",
      "Sintel",
      "big buck bunny",
      "",
      42,
      "Tears of Steel",
      "Elephants Dream",
      "Cosmos Laundromat",
      "Sprite Fright"
    ])).toEqual([
      "Big Buck Bunny",
      "Sintel",
      "Tears of Steel",
      "Elephants Dream",
      "Cosmos Laundromat"
    ]);
    expect(MAX_RECENT_DISCOVERY_SEARCHES).toBe(5);
  });

  it("moves a repeated search to the front and keeps the newest entries", () => {
    expect(addRecentDiscoverySearch(
      ["Sintel", "Big Buck Bunny", "Tears of Steel"],
      "  big buck bunny "
    )).toEqual(["big buck bunny", "Sintel", "Tears of Steel"]);
  });

  it("ignores malformed persisted values", () => {
    expect(normalizeRecentDiscoverySearches({ query: "Sintel" })).toEqual([]);
    expect(normalizeRecentDiscoverySearches(["x", null, "\n\0"])).toEqual([]);
  });
});
