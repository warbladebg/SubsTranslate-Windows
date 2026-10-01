import { useState } from "react";
import { Film, Loader2, Tv } from "lucide-react";
import type { CatalogItem } from "../../../core/discovery/DiscoveryTypes";

/** Shimmering stand-in for catalog rows while titles load; `label` is announced to screen readers. */
export function CatalogSkeleton({ label, sections = 2 }: { label: string; sections?: number }) {
  return (
    <div className="catalog-skeleton-list" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: sections }, (_, section) => (
        <div className="catalog-skeleton" key={section} aria-hidden="true">
          <span className="skeleton heading" />
          <span className="skeleton subheading" />
          <div className="catalog-skeleton-row">
            {Array.from({ length: 7 }, (_, card) => (
              <div className="catalog-skeleton-card" key={card}>
                <span className="skeleton poster" />
                <span className="skeleton line" />
                <span className="skeleton line short" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function InteractionButton({
  active,
  busy,
  label,
  icon,
  onClick
}: {
  active?: boolean;
  busy: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={Boolean(active)}
      className={`interaction-button${active ? " active" : ""}`}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      disabled={busy}
      title={label}
      type="button"
    >
      {busy ? <Loader2 className="spin" size={14} /> : icon}
      <span>{label}</span>
    </button>
  );
}

export function Poster({ item, size = "normal" }: { item: CatalogItem; size?: "normal" | "large" }) {
  const [failedPath, setFailedPath] = useState<string>();
  const [loadedPath, setLoadedPath] = useState<string>();
  return item.posterPath && item.posterPath !== failedPath ? (
    <img
      className={`catalog-poster ${size}`}
      data-loaded={loadedPath === item.posterPath}
      src={item.posterPath}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailedPath(item.posterPath)}
      onLoad={() => setLoadedPath(item.posterPath)}
    />
  ) : (
    <span className={`catalog-poster placeholder ${size}`} aria-hidden="true">
      {item.mediaType === "movie" ? <Film size={size === "large" ? 34 : 28} /> : <Tv size={size === "large" ? 34 : 28} />}
    </span>
  );
}
