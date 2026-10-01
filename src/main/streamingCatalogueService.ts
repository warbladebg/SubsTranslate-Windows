import type {
  StreamingCataloguePage,
  StreamingCatalogueRequest,
  StreamingServiceId
} from "../core/discovery/DiscoveryTypes";
import { catalogItemKey } from "../core/discovery/DiscoveryTypes";
import { STREAMING_SERVICES } from "../core/discovery/DiscoveryFilters";
import type { CatalogService } from "./catalogService";
import type { StreamingAvailabilityService } from "./streamingAvailabilityService";

const MAX_SERVICE_FILTERS = 10;
const MAX_GENRE_FILTERS = 22;
const AVAILABILITY_BATCH_SIZE = 100;
const INITIAL_RESULT_LIMIT = 100;
const MAX_CATALOGUE_SKIP = 50_000;
const CATALOGUE_PAGE_SIZE = 50;
const MAX_CATALOGUE_PAGES = (MAX_CATALOGUE_SKIP / CATALOGUE_PAGE_SIZE) + 1;

export class StreamingCatalogueService {
  constructor(
    private readonly catalogService: CatalogService,
    private readonly availabilityService: StreamingAvailabilityService
  ) {}

  async browse(request: StreamingCatalogueRequest): Promise<StreamingCataloguePage> {
    const normalized = normalizeRequest(request);
    const matchingItems = new Map<string, StreamingCataloguePage["items"][number]>();
    let nextSkip = normalized.skip;
    let hasMore = true;
    let scannedItems = 0;
    let failedItems = 0;
    let scannedPages = 0;

    while (hasMore && scannedPages < MAX_CATALOGUE_PAGES) {
      const pageSkip = nextSkip;
      const candidates = await this.catalogService.browseCatalogueCandidates({
        ...normalized,
        skip: pageSkip
      });
      scannedPages += 1;
      scannedItems += candidates.items.length;

      const eligibleItems = candidates.items.filter((item) => {
        if (normalized.genreIds.length > 0 && !normalized.genreIds.some((id) => item.genreIds.includes(id))) {
          return false;
        }
        return normalized.minimumRating <= 0 || item.voteAverage >= normalized.minimumRating;
      });
      const availabilityEntries = [];

      for (let offset = 0; offset < eligibleItems.length; offset += AVAILABILITY_BATCH_SIZE) {
        const batch = eligibleItems.slice(offset, offset + AVAILABILITY_BATCH_SIZE);
        const availability = await this.availabilityService.getAvailability(
          batch.map(({ id, mediaType }) => ({ id, mediaType })),
          { useCache: false }
        );
        if (
          batch.length > 0
          && availability.entries.length === 0
          && availability.failedItems === batch.length
        ) {
          throw new Error("Streaming availability could not be checked. Try again shortly.");
        }
        availabilityEntries.push(...availability.entries);
        failedItems += availability.failedItems;
      }

      const servicesByItem = new Map(
        availabilityEntries.map((entry) => [entry.key, new Set(entry.services)])
      );
      eligibleItems.forEach((item) => {
        const key = catalogItemKey(item);
        const services = servicesByItem.get(key);
        if (services && normalized.streamingServices.some((service) => services.has(service))) {
          matchingItems.set(key, item);
        }
      });

      nextSkip = candidates.nextSkip;
      hasMore = candidates.hasMore && candidates.nextSkip > pageSkip;

      if (!normalized.showAll && matchingItems.size >= INITIAL_RESULT_LIMIT) {
        const items = [...matchingItems.values()];
        const overflowedPage = items.length > INITIAL_RESULT_LIMIT;
        return {
          items: items.slice(0, INITIAL_RESULT_LIMIT),
          nextSkip: overflowedPage ? pageSkip : nextSkip,
          hasMore: overflowedPage || hasMore,
          scannedItems,
          failedItems
        };
      }
    }

    return {
      items: [...matchingItems.values()],
      nextSkip,
      hasMore: false,
      scannedItems,
      failedItems
    };
  }
}

function normalizeRequest(value: StreamingCatalogueRequest): StreamingCatalogueRequest {
  const knownServices = new Set(STREAMING_SERVICES.map((service) => service.id));
  const streamingServices = Array.isArray(value?.streamingServices)
    ? [...new Set(value.streamingServices)]
      .filter((service): service is StreamingServiceId => knownServices.has(service))
      .slice(0, MAX_SERVICE_FILTERS)
    : [];
  if (streamingServices.length === 0) {
    throw new Error("Choose at least one streaming service.");
  }
  const mediaType = value.mediaType === "movie" || value.mediaType === "series"
    ? value.mediaType
    : "all";
  const genreIds = Array.isArray(value.genreIds)
    ? [...new Set(value.genreIds)]
      .filter((id) => Number.isSafeInteger(id) && id > 0)
      .slice(0, MAX_GENRE_FILTERS)
    : [];
  const minimumRating = Number.isFinite(value.minimumRating)
    ? Math.max(0, Math.min(value.minimumRating, 10))
    : 0;
  const query = typeof value.query === "string"
    ? value.query.replace(/\s+/g, " ").trim().slice(0, 200)
    : "";
  const skip = Number.isSafeInteger(value.skip)
    ? Math.max(0, Math.min(value.skip, MAX_CATALOGUE_SKIP))
    : 0;
  const showAll = value.showAll === true;
  return { streamingServices, mediaType, genreIds, minimumRating, query, skip, showAll };
}
