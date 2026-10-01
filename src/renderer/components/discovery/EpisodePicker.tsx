import { CheckCircle2, Eye, Loader2 } from "lucide-react";
import type { CatalogDetails, DiscoveryInteraction } from "../../../core/discovery/DiscoveryTypes";
import { AppSelect } from "../AppSelect";

interface EpisodePickerProps {
  details: CatalogDetails;
  interaction?: DiscoveryInteraction;
  season: number;
  episode?: number;
  selectedEpisodes?: number[];
  disabled: boolean;
  watchedBusy: boolean;
  onSeasonChange: (season: number) => void;
  onEpisodeChange: (value: string) => void;
  onToggleWatched: () => void;
}

export function EpisodePicker({
  details,
  interaction,
  season,
  episode,
  selectedEpisodes,
  disabled,
  watchedBusy,
  onSeasonChange,
  onEpisodeChange,
  onToggleWatched
}: EpisodePickerProps) {
  const isEpisodeWatched = (episodeNumber: number): boolean => Boolean(
    interaction?.watchedManually
    || interaction?.watchedEpisodes?.includes(`s${season}e${episodeNumber}`)
  );
  const selectedEpisodeWatched = episode !== undefined && isEpisodeWatched(episode);
  const regularEpisodeCount = details.seasons
    .filter((item) => item.seasonNumber > 0)
    .reduce((total, item) => total + item.episodeCount, 0);
  const watchedEpisodeCount = interaction?.watchedManually
    ? regularEpisodeCount
    : Math.min(interaction?.watchedEpisodes?.length ?? 0, regularEpisodeCount);
  const seasonEpisodeCount = details.seasons.find((item) => item.seasonNumber === season)?.episodeCount ?? 0;

  return (
    <div className="episode-picker">
      <div className="app-select-field">
        <span>Season</span>
        <AppSelect
          ariaLabel="Season"
          value={String(season)}
          options={details.seasons
            .filter((item) => item.seasonNumber > 0)
            .map((item) => ({
              value: String(item.seasonNumber),
              label: `${item.name} (${item.episodeCount})`
            }))}
          onChange={(value) => onSeasonChange(Number(value))}
        />
      </div>
      <div className="app-select-field">
        <span>Episode</span>
        <AppSelect
          ariaLabel="Episode"
          value={episode === undefined ? "season" : String(episode)}
          disabled={disabled}
          selectedValues={selectedEpisodes !== undefined ? selectedEpisodes.map(String) : [episode === undefined ? "season" : String(episode)]}
          selectionLabel={selectedEpisodes !== undefined ? selectedEpisodes.length === 0 ? "Choose episodes" : `Episodes ${selectedEpisodes.join(", ")}` : undefined}
          options={[
            { value: "season", label: "Entire season" },
            ...Array.from({ length: seasonEpisodeCount }, (_, index) => index + 1).map((episodeNumber) => ({
              value: String(episodeNumber),
              label: `Episode ${episodeNumber}${isEpisodeWatched(episodeNumber) ? " ✓" : ""}`
            }))
          ]}
          onChange={onEpisodeChange}
        />
      </div>
      {episode !== undefined && <div className="episode-watch-control">
        <span>
          {watchedEpisodeCount} of {regularEpisodeCount} regular episodes watched
        </span>
        <button
          aria-label={
            selectedEpisodeWatched
              ? `Mark season ${season} episode ${episode} as unwatched`
              : `Mark season ${season} episode ${episode} as watched`
          }
          aria-pressed={selectedEpisodeWatched}
          className={`text-button episode-watch-button${selectedEpisodeWatched ? " active" : ""}`}
          disabled={watchedBusy}
          onClick={onToggleWatched}
          type="button"
        >
          {watchedBusy
            ? <Loader2 className="spin" size={16} />
            : selectedEpisodeWatched
              ? <CheckCircle2 size={16} />
              : <Eye size={16} />}
          {selectedEpisodeWatched ? "Episode watched" : "Mark episode watched"}
        </button>
      </div>}
    </div>
  );
}
