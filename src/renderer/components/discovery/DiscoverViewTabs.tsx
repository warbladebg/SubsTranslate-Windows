import { Bookmark, Compass, Eye, ThumbsUp, type LucideIcon } from "lucide-react";
import type { DiscoverCopy } from "./discoveryCopy";
import { SlidingIndicator } from "../SlidingIndicator";

export type CatalogView = "browse" | "liked" | "favourites" | "watched";

interface DiscoverViewTabsProps {
  ui: DiscoverCopy;
  view: CatalogView;
  counts: Record<Exclude<CatalogView, "browse">, number>;
  onChange: (view: CatalogView) => void;
}

export function DiscoverViewTabs({ ui, view, counts, onChange }: DiscoverViewTabsProps) {
  const tabs: Array<{ id: CatalogView; label: string; Icon: LucideIcon; count?: number }> = [
    { id: "browse", label: ui.browse, Icon: Compass },
    { id: "liked", label: ui.likes, Icon: ThumbsUp, count: counts.liked },
    { id: "favourites", label: ui.favourites, Icon: Bookmark, count: counts.favourites },
    { id: "watched", label: ui.watched, Icon: Eye, count: counts.watched }
  ];

  return (
    <nav className="discover-view-tabs" aria-label={ui.collections}>
      <SlidingIndicator variant="underline" />
      {tabs.map(({ id, label, Icon, count }) => (
        <button
          aria-label={count === undefined ? undefined : `${label} (${count})`}
          aria-current={view === id ? "page" : undefined}
          className={view === id ? "active" : ""}
          key={id}
          onClick={() => onChange(id)}
          type="button"
        >
          <Icon size={16} />
          {label}
          {count !== undefined && <span>{count}</span>}
        </button>
      ))}
    </nav>
  );
}
