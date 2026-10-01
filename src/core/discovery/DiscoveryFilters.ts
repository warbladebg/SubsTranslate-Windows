import type { CatalogItem, MediaType, StreamingServiceId } from "./DiscoveryTypes";
import { catalogItemKey } from "./DiscoveryTypes";
import { stableNumericId } from "../util/text";

export const DISCOVERY_GENRES = [
  "Action",
  "Adventure",
  "Animation",
  "Biography",
  "Comedy",
  "Crime",
  "Documentary",
  "Drama",
  "Family",
  "Fantasy",
  "History",
  "Horror",
  "Mystery",
  "Romance",
  "Sci-Fi",
  "Sport",
  "Thriller",
  "War",
  "Western",
  "Reality-TV",
  "Talk-Show",
  "Game-Show"
] as const;

export const STREAMING_SERVICES: ReadonlyArray<{
  id: StreamingServiceId;
  label: string;
  color: string;
}> = [
  { id: "netflix", label: "Netflix", color: "#e50914" },
  { id: "prime-video", label: "Prime Video", color: "#1399ff" },
  { id: "disney-plus", label: "Disney+", color: "#335cdd" },
  { id: "max", label: "Max", color: "#6b3df5" },
  { id: "apple-tv-plus", label: "Apple TV+", color: "#1f2937" },
  { id: "hulu", label: "Hulu", color: "#1ce783" },
  { id: "paramount-plus", label: "Paramount+", color: "#0064ff" },
  { id: "peacock", label: "Peacock", color: "#f4b400" },
  { id: "crunchyroll", label: "Crunchyroll", color: "#f47521" },
  { id: "mubi", label: "MUBI", color: "#0b70ff" }
];

export interface DiscoveryCatalogFilters {
  mediaType: "all" | MediaType;
  genreIds: number[];
  streamingServices: StreamingServiceId[];
  minimumRating: number;
}

export const DEFAULT_DISCOVERY_FILTERS: DiscoveryCatalogFilters = {
  mediaType: "all",
  genreIds: [],
  streamingServices: [],
  minimumRating: 0
};

export const DISCOVERY_GENRE_OPTIONS = DISCOVERY_GENRES.map((name) => ({
  id: discoveryGenreId(name),
  name
}));

export function discoveryGenreId(name: string): number {
  return stableNumericId(`genre:${name.toLowerCase()}`);
}

export function countDiscoveryFilters(filters: DiscoveryCatalogFilters): number {
  return (filters.mediaType === "all" ? 0 : 1)
    + filters.genreIds.length
    + filters.streamingServices.length
    + (filters.minimumRating > 0 ? 1 : 0);
}

export function filterCatalogItems(
  items: CatalogItem[],
  filters: DiscoveryCatalogFilters,
  streamingAvailability: ReadonlyMap<string, ReadonlySet<StreamingServiceId>>
): CatalogItem[] {
  return items.filter((item) => {
    if (filters.mediaType !== "all" && item.mediaType !== filters.mediaType) {
      return false;
    }
    if (
      filters.genreIds.length > 0
      && !filters.genreIds.some((genreId) => item.genreIds.includes(genreId))
    ) {
      return false;
    }
    if (filters.minimumRating > 0 && item.voteAverage < filters.minimumRating) {
      return false;
    }
    if (filters.streamingServices.length > 0) {
      const services = streamingAvailability.get(catalogItemKey(item));
      if (!services || !filters.streamingServices.some((service) => services.has(service))) {
        return false;
      }
    }
    return true;
  });
}
