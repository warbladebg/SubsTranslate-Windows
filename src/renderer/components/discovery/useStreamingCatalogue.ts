import { useEffect, useRef, useState } from "react";
import type { CatalogItem, StreamingServiceId } from "../../../core/discovery/DiscoveryTypes";
import { catalogItemKey } from "../../../core/discovery/DiscoveryTypes";
import { DEFAULT_DISCOVERY_FILTERS, type DiscoveryCatalogFilters } from "../../../core/discovery/DiscoveryFilters";
import { copyDiscoveryFilters } from "./discoverUtils";
import { formatError } from "../../format";

interface StreamingCatalogueFeedback {
  onError: (message: string | undefined) => void;
  onNotice: (message: string | undefined) => void;
}

/** State for the full-page catalogue of one or more streaming services. */
export function useStreamingCatalogue({ onError, onNotice }: StreamingCatalogueFeedback) {
  const [open, setOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState<DiscoveryCatalogFilters>(DEFAULT_DISCOVERY_FILTERS);
  const [filters, setFilters] = useState<DiscoveryCatalogFilters>(DEFAULT_DISCOVERY_FILTERS);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [nextSkip, setNextSkip] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [scannedItems, setScannedItems] = useState(0);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = requestIdRef;
    return () => {
      requestId.current++;
    };
  }, []);

  function resetResults(): void {
    setItems([]);
    setNextSkip(0);
    setHasMore(true);
    setScannedItems(0);
  }

  async function load(
    nextFilters: DiscoveryCatalogFilters,
    queryValue: string,
    skip: number,
    replace: boolean,
    showAll = false
  ): Promise<void> {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    onError(undefined);
    onNotice(undefined);
    try {
      const page = await window.subtitleTranslator.getDiscoveryStreamingCatalogue({
        streamingServices: nextFilters.streamingServices,
        mediaType: nextFilters.mediaType,
        genreIds: nextFilters.genreIds,
        minimumRating: nextFilters.minimumRating,
        query: queryValue,
        skip,
        showAll
      });
      if (requestId !== requestIdRef.current) {
        return;
      }
      setItems((current) => {
        const combined = replace ? page.items : [...current, ...page.items];
        return [...new Map(combined.map((item) => [catalogItemKey(item), item])).values()];
      });
      setNextSkip(page.nextSkip);
      setHasMore(page.hasMore);
      setScannedItems((current) => (replace ? 0 : current) + page.scannedItems);
      if (page.failedItems > 0) {
        onNotice(`${page.failedItems} availability checks failed while scanning this catalogue page.`);
      }
    } catch (catalogueError) {
      if (requestId === requestIdRef.current) {
        onError(formatError(catalogueError));
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }

  async function openCatalogue(streamingServices: StreamingServiceId[]): Promise<void> {
    const initialFilters: DiscoveryCatalogFilters = {
      ...DEFAULT_DISCOVERY_FILTERS,
      streamingServices: [...streamingServices]
    };
    setDraftFilters(initialFilters);
    setFilters(initialFilters);
    setQuery("");
    setAppliedQuery("");
    resetResults();
    setOpen(true);
    window.scrollTo({ top: 0, behavior: "auto" });
    await load(initialFilters, "", 0, true);
  }

  function closeCatalogue(): void {
    requestIdRef.current += 1;
    setOpen(false);
    onError(undefined);
    onNotice(undefined);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  async function applyFilters(): Promise<void> {
    if (draftFilters.streamingServices.length === 0) {
      onError("Choose at least one streaming service.");
      return;
    }
    const nextFilters = copyDiscoveryFilters(draftFilters);
    setFilters(nextFilters);
    setAppliedQuery(query);
    resetResults();
    await load(nextFilters, query, 0, true);
  }

  function clearFilters(): void {
    setDraftFilters({
      ...DEFAULT_DISCOVERY_FILTERS,
      streamingServices: [...filters.streamingServices]
    });
    setQuery("");
  }

  function loadAll(): Promise<void> {
    return load(filters, appliedQuery, nextSkip, false, true);
  }

  return {
    open,
    draftFilters,
    filters,
    query,
    items,
    hasMore,
    scannedItems,
    loading,
    setDraftFilters,
    setQuery,
    openCatalogue,
    closeCatalogue,
    applyFilters,
    clearFilters,
    loadAll
  };
}
