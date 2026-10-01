import { Compass, Film, Loader2, Search, SlidersHorizontal, Tv, X } from "lucide-react";
import type { StreamingServiceId } from "../../../core/discovery/DiscoveryTypes";
import { DISCOVERY_GENRE_OPTIONS, STREAMING_SERVICES, type DiscoveryCatalogFilters } from "../../../core/discovery/DiscoveryFilters";
import { SlidingIndicator } from "../SlidingIndicator";


interface DiscoveryFilterPanelProps {
  filters: DiscoveryCatalogFilters;
  loading: boolean;
  query?: string;
  title?: string;
  description?: string;
  applyLabel?: string;
  onQueryChange?: (query: string) => void;
  onChange: (filters: DiscoveryCatalogFilters) => void;
  onApply: () => void;
  onClear: () => void;
  onClose: () => void;
}

export function DiscoveryFilterPanel(props: DiscoveryFilterPanelProps) {
  function toggleGenre(genreId: number): void {
    props.onChange({
      ...props.filters,
      genreIds: props.filters.genreIds.includes(genreId)
        ? props.filters.genreIds.filter((id) => id !== genreId)
        : [...props.filters.genreIds, genreId]
    });
  }

  function toggleStreamingService(serviceId: StreamingServiceId): void {
    props.onChange({
      ...props.filters,
      streamingServices: props.filters.streamingServices.includes(serviceId)
        ? props.filters.streamingServices.filter((id) => id !== serviceId)
        : [...props.filters.streamingServices, serviceId]
    });
  }

  return (
    <section
      aria-labelledby="discovery-filters-title"
      className="discover-filter-panel"
      id="discovery-filters"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          props.onClose();
        }
      }}
    >
      <div className="discover-filter-panel-heading">
        <div>
          <span className="discover-eyebrow"><SlidersHorizontal size={14} /> Refine your picks</span>
          <h3 id="discovery-filters-title">{props.title ?? "Filters"}</h3>
          <p>{props.description ?? "Choose any combination. Multiple genres and services match if a title has at least one."}</p>
        </div>
        <button
          aria-label="Close filters"
          className="icon-button"
          disabled={props.loading}
          onClick={props.onClose}
          type="button"
        >
          <X size={17} />
        </button>
      </div>

      <div className="discover-filter-grid">
        {props.onQueryChange && (
          <fieldset className="discover-filter-group discover-query-filter" disabled={props.loading}>
            <legend>Search</legend>
            <label>
              Title
              <div className="discover-catalogue-search">
                <Search size={16} />
                <input
                  aria-label="Search this streaming catalogue"
                  onChange={(event) => props.onQueryChange?.(event.target.value)}
                  placeholder="Search this catalogue"
                  type="search"
                  value={props.query ?? ""}
                />
              </div>
            </label>
          </fieldset>
        )}
        <fieldset className="discover-filter-group" disabled={props.loading}>
          <legend>Type</legend>
          <div className="discover-filter-segments">
            <SlidingIndicator />
            {([
              ["all", "All titles"],
              ["movie", "Movies"],
              ["series", "TV shows"]
            ] as const).map(([value, label]) => (
              <button
                aria-pressed={props.filters.mediaType === value}
                className={props.filters.mediaType === value ? "active" : ""}
                key={value}
                onClick={() => props.onChange({ ...props.filters, mediaType: value })}
                type="button"
              >
                {value === "movie" ? <Film size={14} /> : value === "series" ? <Tv size={14} /> : <Compass size={14} />}
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="discover-filter-group discover-rating-filter" disabled={props.loading}>
          <legend>Minimum rating</legend>
          <label>
            IMDb score
            <select
              value={props.filters.minimumRating}
              onChange={(event) => props.onChange({
                ...props.filters,
                minimumRating: Number(event.target.value)
              })}
            >
              <option value={0}>Any rating</option>
              <option value={6}>6.0 and up</option>
              <option value={7}>7.0 and up</option>
              <option value={8}>8.0 and up</option>
              <option value={9}>9.0 and up</option>
            </select>
          </label>
        </fieldset>

        <fieldset className="discover-filter-group discover-genre-filter" disabled={props.loading}>
          <legend>Genres</legend>
          <div className="discover-filter-chips">
            {DISCOVERY_GENRE_OPTIONS.map((genre) => (
              <label className="discover-filter-chip" key={genre.id}>
                <input
                  checked={props.filters.genreIds.includes(genre.id)}
                  onChange={() => toggleGenre(genre.id)}
                  type="checkbox"
                />
                <span>{genre.name}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="discover-filter-group discover-service-filter" disabled={props.loading}>
          <legend>Streaming services</legend>
          <p>Availability is checked when you apply these filters and may vary by location.</p>
          <div className="discover-filter-chips discover-service-chips">
            {STREAMING_SERVICES.map((service) => (
              <label className="discover-filter-chip discover-service-chip" key={service.id}>
                <input
                  checked={props.filters.streamingServices.includes(service.id)}
                  onChange={() => toggleStreamingService(service.id)}
                  type="checkbox"
                />
                <span>
                  <i aria-hidden="true" style={{ backgroundColor: service.color }} />
                  {service.label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="discover-filter-actions">
        <button className="text-button" disabled={props.loading} onClick={props.onClear} type="button">
          Clear all
        </button>
        <button className="primary-button" disabled={props.loading} onClick={props.onApply} type="button">
          {props.loading ? <Loader2 className="spin" size={16} /> : <SlidersHorizontal size={16} />}
          {props.loading ? "Checking availability…" : props.applyLabel ?? "Apply filters"}
        </button>
      </div>
    </section>
  );
}
