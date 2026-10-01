import { useRef, useState } from "react";
import { Clock3, Loader2, Search, X } from "lucide-react";
import type { DiscoverCopy } from "./discoveryCopy";
import { isSearchableCatalogQuery } from "./discoverUtils";

interface DiscoverSearchBarProps {
  ui: DiscoverCopy;
  query: string;
  loading: boolean;
  hasResults: boolean;
  recentSearches: string[];
  onQueryChange: (value: string) => void;
  onSearch: (value: string) => void;
  onClearResults: () => void;
  onClearRecentSearches: () => void;
}

export function DiscoverSearchBar({
  ui,
  query,
  loading,
  hasResults,
  recentSearches,
  onQueryChange,
  onSearch,
  onClearResults,
  onClearRecentSearches
}: DiscoverSearchBarProps) {
  const [recentSearchesOpen, setRecentSearchesOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const recentSearchButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const hasRecentSearches = recentSearches.length > 0;

  function runSearch(value: string): void {
    if (isSearchableCatalogQuery(value)) {
      setRecentSearchesOpen(false);
    }
    onSearch(value);
  }

  function focusRecentSearch(index: number): void {
    setRecentSearchesOpen(true);
    window.requestAnimationFrame(() => {
      recentSearchButtonRefs.current[index]?.focus({ preventScroll: true });
    });
  }

  function handleRecentSearchKeyDown(event: React.KeyboardEvent, index: number): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusRecentSearch((index + 1) % recentSearches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusRecentSearch((index - 1 + recentSearches.length) % recentSearches.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusRecentSearch(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusRecentSearch(recentSearches.length - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      searchInputRef.current?.focus({ preventScroll: true });
      setRecentSearchesOpen(false);
    }
  }

  return (
    <div
      className="discover-search-shell"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setRecentSearchesOpen(false);
        }
      }}
    >
      <form
        className="discover-search"
        onSubmit={(event) => {
          event.preventDefault();
          runSearch(query);
        }}
      >
        <input
          aria-controls={hasRecentSearches ? "discover-recent-searches" : undefined}
          aria-expanded={hasRecentSearches ? recentSearchesOpen : undefined}
          aria-label={ui.searchPlaceholder}
          ref={searchInputRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onClick={() => setRecentSearchesOpen(hasRecentSearches)}
          onFocus={() => setRecentSearchesOpen(hasRecentSearches)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && hasRecentSearches) {
              event.preventDefault();
              focusRecentSearch(0);
            } else if (event.key === "ArrowUp" && hasRecentSearches) {
              event.preventDefault();
              focusRecentSearch(recentSearches.length - 1);
            } else if (event.key === "Escape") {
              setRecentSearchesOpen(false);
            }
          }}
          placeholder={ui.searchPlaceholder}
        />
        {hasResults && (
          <button
            aria-label={ui.clearSearch}
            className="icon-button discover-search-clear"
            onClick={onClearResults}
            type="button"
          >
            <X size={16} />
          </button>
        )}
        <button
          aria-label={ui.search}
          className="icon-button discover-search-submit"
          disabled={loading}
          type="submit"
        >
          {loading ? <Loader2 className="spin" size={17} /> : <Search size={19} />}
        </button>
      </form>
      {recentSearchesOpen && hasRecentSearches && (
        <div
          aria-label={ui.recentSearches}
          className="discover-recent-searches"
          id="discover-recent-searches"
          role="region"
        >
          <div className="discover-recent-searches-heading">
            <span>{ui.recentSearches}</span>
            <button
              onClick={() => {
                setRecentSearchesOpen(false);
                onClearRecentSearches();
              }}
              type="button"
            >
              {ui.clear}
            </button>
          </div>
          <ul className="discover-recent-searches-list">
            {recentSearches.map((recentSearch, index) => (
              <li key={recentSearch.toLocaleLowerCase()}>
                <button
                  onKeyDown={(event) => handleRecentSearchKeyDown(event, index)}
                  onClick={() => runSearch(recentSearch)}
                  ref={(element) => {
                    recentSearchButtonRefs.current[index] = element;
                  }}
                  type="button"
                >
                  <Clock3 aria-hidden="true" size={15} />
                  <span>{recentSearch}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
