import { useCallback, useEffect, useRef, useState } from "react";
import type { CatalogItem, ExternalRating } from "../../../core/discovery/DiscoveryTypes";
import { catalogItemKey } from "../../../core/discovery/DiscoveryTypes";
import { formatError } from "../../format";

const RATINGS_BATCH_SIZE = 50;

/** Loads MDBList ratings for visible titles, requesting each title at most once until reset. */
export function useExternalRatings(enabled: boolean, items: CatalogItem[]) {
  const [ratings, setRatings] = useState(() => new Map<string, ExternalRating[]>());
  const [ratingsError, setRatingsError] = useState<string>();
  const attemptedKeysRef = useRef(new Set<string>());

  const loadRatings = useCallback(async (candidates: CatalogItem[]): Promise<void> => {
    const attemptedKeys = attemptedKeysRef.current;
    const pending = candidates
      .filter((item) => !attemptedKeys.has(catalogItemKey(item)))
      .slice(0, RATINGS_BATCH_SIZE);
    if (pending.length === 0) {
      return;
    }
    pending.forEach((item) => attemptedKeys.add(catalogItemKey(item)));
    try {
      const result = await window.subtitleTranslator.getDiscoveryRatings(
        pending.map(({ id, mediaType }) => ({ id, mediaType }))
      );
      const returnedKeys = new Set(result.entries.map((entry) => entry.key));
      pending.forEach((item) => {
        const key = catalogItemKey(item);
        if (!returnedKeys.has(key)) {
          attemptedKeys.delete(key);
        }
      });
      setRatings((current) => {
        const next = new Map(current);
        result.entries.forEach((entry) => next.set(entry.key, entry.ratings));
        return next;
      });
      setRatingsError(result.failedItems > 0
        ? `Some external ratings could not be loaded (${result.failedItems} of ${result.checkedItems}).`
        : undefined);
    } catch (ratingsLoadError) {
      pending.forEach((item) => attemptedKeys.delete(catalogItemKey(item)));
      setRatingsError(formatError(ratingsLoadError));
    }
  }, []);

  const resetRatings = useCallback((): void => {
    attemptedKeysRef.current.clear();
    setRatings(new Map());
    setRatingsError(undefined);
  }, []);

  useEffect(() => {
    if (enabled) {
      void loadRatings(items);
    }
  }, [enabled, items, loadRatings]);

  return { ratings, ratingsError, loadRatings, resetRatings };
}
