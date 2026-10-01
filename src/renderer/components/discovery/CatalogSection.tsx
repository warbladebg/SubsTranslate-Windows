import { memo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Bookmark, Check, ChevronDown, ChevronUp, Star, ThumbsUp } from "lucide-react";
import type { CatalogItem, DiscoveryAction, DiscoveryInteraction, ExternalRating } from "../../../core/discovery/DiscoveryTypes";
import { catalogItemKey } from "../../../core/discovery/DiscoveryTypes";
import type { UiLanguage } from "../../uiLanguage";
import { discoverCopy } from "./discoveryCopy";
import { MultiSourceRatingBadges } from "./MultiSourceRatingBadges";
import { InteractionButton, Poster } from "./CatalogPrimitives";

interface CatalogSectionProps {
  uiLanguage?: UiLanguage;
  sectionId: string;
  title: string;
  subtitle?: string;
  items: CatalogItem[];
  interactions: Map<string, DiscoveryInteraction>;
  ratings: Map<string, ExternalRating[]>;
  busyAction: string;
  onExpand?: () => void;
  onSelect: (item: CatalogItem, trigger: HTMLButtonElement) => void;
  onInteract: (item: CatalogItem, action: DiscoveryAction) => void;
}

/** Memoized: Discover re-renders on every search keystroke, while sections rarely change. */
export const CatalogSection = memo(function CatalogSection(props: CatalogSectionProps) {
  const ui = discoverCopy[props.uiLanguage ?? "en"];
  const isSearchResults = props.sectionId === "search-results"
    || props.sectionId === "service-catalogue-results";
  const [expanded, setExpanded] = useState(false);
  const isGrid = isSearchResults || expanded;
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startScrollLeft: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (
      isGrid
      || (event.pointerType === "mouse" && event.button !== 0)
      || (event.target as HTMLElement).closest(".interaction-button")
    ) {
      return;
    }

    suppressClickRef.current = false;
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: event.currentTarget.scrollLeft,
      moved: false
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - dragState.startX;
    if (!dragState.moved && Math.abs(deltaX) >= 6) {
      dragState.moved = true;
      setIsDragging(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }

    if (dragState.moved) {
      event.preventDefault();
      event.currentTarget.scrollLeft = dragState.startScrollLeft - deltaX;
    }
  };

  const finishPointerDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
    cancelled = false
  ): void => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    suppressClickRef.current = !cancelled && dragState.moved;
    dragStateRef.current = null;
    setIsDragging(false);

    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleClickCapture = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (!suppressClickRef.current) {
      return;
    }

    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <section
      className={`catalog-section${isGrid ? " catalog-search-results" : ""}`}
      aria-labelledby={`catalog-${props.sectionId}`}
    >
      <div className="catalog-section-heading">
        <div>
          <h3 id={`catalog-${props.sectionId}`}>{props.title}</h3>
          {props.subtitle && <p>{props.subtitle}</p>}
        </div>
        <div className="catalog-section-heading-actions">
          {!isSearchResults && (
            <button className="text-button" type="button"
              aria-expanded={props.onExpand ? undefined : expanded}
              aria-controls={props.onExpand ? undefined : `catalog-items-${props.sectionId}`}
              onClick={props.onExpand ?? (() => setExpanded((current) => !current))}>
              {expanded ? ui.showLess : ui.showMore}
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
        </div>
      </div>
      <div
        id={`catalog-items-${props.sectionId}`}
        className={`catalog-grid${isGrid ? "" : " drag-scroll"}${isDragging ? " dragging" : ""}`}
        aria-label={`${props.title} titles`}
        onClickCapture={handleClickCapture}
        onDragStart={(event) => event.preventDefault()}
        onPointerCancel={(event) => finishPointerDrag(event, true)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => finishPointerDrag(event)}
      >
        {props.items.map((item) => {
          const itemKey = catalogItemKey(item);
          const interaction = props.interactions.get(itemKey);
          const ratings = props.ratings.get(itemKey) ?? [];
          const imdbRating = ratings.find((rating) => rating.source === "imdb")?.value ?? item.voteAverage;
          return (
            <article className="catalog-card" key={itemKey}>
              <button
                className="catalog-card-main"
                onClick={(event) => props.onSelect(item, event.currentTarget)}
                type="button"
              >
                <span className="catalog-poster-frame">
                  <Poster item={item} />
                  {interaction?.watched && (
                    <span
                      aria-label={item.mediaType === "series" ? ui.allEpisodesWatched : ui.watched}
                      className="catalog-watched-badge"
                      role="img"
                      title={item.mediaType === "series" ? ui.allEpisodesWatched : ui.watched}
                    >
                      <Check aria-hidden="true" size={17} strokeWidth={3} />
                    </span>
                  )}
                </span>
                <span className="catalog-card-info">
                  <strong title={item.title}>{item.title}</strong>
                  <span className="catalog-card-primary-meta">
                    <span title={ui.imdbRating}><Star size={13} /> {imdbRating ? imdbRating.toFixed(1) : "—"}</span>
                    <span>{item.releaseDate?.slice(0, 4) || "—"}</span>
                    {item.runtimeMinutes && <span>{item.runtimeMinutes} min</span>}
                  </span>
                  <MultiSourceRatingBadges ratings={ratings} compact />
                </span>
              </button>
              <div className="catalog-card-actions">
                <InteractionButton
                  active={interaction?.liked}
                  busy={props.busyAction === `${catalogItemKey(item)}:liked`}
                  label={ui.like}
                  icon={<ThumbsUp size={14} />}
                  onClick={() => props.onInteract(item, "liked")}
                />
                <InteractionButton
                  active={interaction?.watchlisted}
                  busy={props.busyAction === `${catalogItemKey(item)}:watchlisted`}
                  label={ui.favourite}
                  icon={<Bookmark size={14} />}
                  onClick={() => props.onInteract(item, "watchlisted")}
                />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
});
