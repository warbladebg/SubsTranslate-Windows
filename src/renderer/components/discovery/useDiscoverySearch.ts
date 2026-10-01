import { useCallback, useEffect, useRef, useState } from "react";
import type { CatalogItem } from "../../../core/discovery/DiscoveryTypes";
import { addRecentDiscoverySearch } from "../../../core/discovery/RecentSearches";
import { formatError } from "../../format";
import {
  isSearchableCatalogQuery,
  normalizeCatalogQuery,
  readRecentDiscoverySearches,
  writeRecentDiscoverySearches
} from "./discoverUtils";

interface DiscoverySearchOptions {
  /** Called when a search starts, so the page can reset its view and messages. */
  onSearchStart: () => void;
  onError: (message: string) => void;
}

/** Catalog search: the query box, results of the latest search, and recent searches. */
export function useDiscoverySearch({ onSearchStart, onError }: DiscoverySearchOptions) {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [results, setResults] = useState<CatalogItem[]>();
  const [recentSearches, setRecentSearches] = useState(readRecentDiscoverySearches);
  const [loading, setLoading] = useState(false);
  // Only the newest search may update results; older replies are dropped.
  const requestIdRef = useRef(0);

  useEffect(() => () => {
    requestIdRef.current += 1;
  }, []);

  async function search(normalizedQuery: string): Promise<void> {
    const requestId = ++requestIdRef.current;
    setQuery(normalizedQuery);
    setLoading(true);
    onSearchStart();
    try {
      const found = await window.subtitleTranslator.searchDiscoveryCatalog(normalizedQuery);
      if (requestId !== requestIdRef.current) return;
      setResults(found);
      setSubmittedQuery(normalizedQuery);
      setRecentSearches((current) => {
        const updated = addRecentDiscoverySearch(current, normalizedQuery);
        writeRecentDiscoverySearches(updated);
        return updated;
      });
    } catch (searchError) {
      if (requestId === requestIdRef.current) onError(formatError(searchError));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }

  function runSearch(value: string): void {
    if (!isSearchableCatalogQuery(value)) {
      onError("Enter at least two characters to search.");
      return;
    }
    void search(normalizeCatalogQuery(value));
  }

  const clearResults = useCallback((): void => {
    requestIdRef.current += 1;
    setLoading(false);
    setResults(undefined);
    setSubmittedQuery("");
  }, []);

  function clearRecentSearches(): void {
    setRecentSearches([]);
    writeRecentDiscoverySearches([]);
  }

  return {
    query,
    setQuery,
    submittedQuery,
    results,
    recentSearches,
    loading,
    runSearch,
    clearResults,
    clearRecentSearches
  };
}
