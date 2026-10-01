import { useMemo } from "react";
import { filterCatalogItems, type DiscoveryCatalogFilters } from "../../../core/discovery/DiscoveryFilters";
import type { CatalogItem, DiscoveryInteraction, StreamingServiceId } from "../../../core/discovery/DiscoveryTypes";

export type InteractionCollection = "liked" | "favourites" | "watched";

const COLLECTION_FLAGS: Record<InteractionCollection, (interaction: DiscoveryInteraction) => boolean | undefined> = {
  liked: (interaction) => interaction.liked,
  favourites: (interaction) => interaction.watchlisted,
  watched: (interaction) => interaction.watched
};

const COLLECTIONS = Object.keys(COLLECTION_FLAGS) as InteractionCollection[];

type CollectionItems = Record<InteractionCollection, CatalogItem[]>;

function mapCollections(build: (collection: InteractionCollection) => CatalogItem[]): CollectionItems {
  return Object.fromEntries(COLLECTIONS.map((collection) => [collection, build(collection)])) as CollectionItems;
}

/** The user's liked, favourite and watched titles (hidden titles excluded), unfiltered and filtered. */
export function useInteractionCollections(
  interactions: DiscoveryInteraction[] | undefined,
  filters: DiscoveryCatalogFilters,
  streamingAvailability: ReadonlyMap<string, ReadonlySet<StreamingServiceId>>
): { all: CollectionItems; filtered: CollectionItems } {
  const all = useMemo(() => mapCollections((collection) => (interactions ?? [])
    .filter((interaction) => COLLECTION_FLAGS[collection](interaction) && !interaction.hidden)
    .map((interaction) => interaction.item)), [interactions]);
  const filtered = useMemo(
    () => mapCollections((collection) => filterCatalogItems(all[collection], filters, streamingAvailability)),
    [all, filters, streamingAvailability]
  );
  return { all, filtered };
}
