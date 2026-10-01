import type { RefObject } from "react";
import { AlertTriangle, HardDriveDownload, Loader2, Magnet, RefreshCw, ShieldCheck } from "lucide-react";
import type { CatalogDetails, SourceSearchResult, TorrentSource } from "../../../core/discovery/DiscoveryTypes";
import type { DownloadLocationState } from "../../../core/downloads/DownloadLocations";
import { SourceCard } from "./SourceCard";
import { SlidingIndicator } from "../SlidingIndicator";

export type DownloadMethod = "torrent" | "real-debrid";

interface SourcePanelProps {
  details: CatalogDetails;
  episode?: number;
  selectedEpisodes?: number[];
  downloadMethod: DownloadMethod;
  debridName: string;
  loadingSources: boolean;
  sourceResult?: SourceSearchResult;
  sources: TorrentSource[];
  busyAction: string;
  downloadLocations?: DownloadLocationState;
  selectedLocationId: string;
  externalClientAvailable: boolean;
  findSourcesRef: RefObject<HTMLButtonElement>;
  debridMethodRef: RefObject<HTMLButtonElement>;
  onFindSources: () => void;
  onSwitchMethod: (method: DownloadMethod) => void;
  onSelectLocation: (id: string) => void;
  onOpenTorrent: (source: TorrentSource) => void;
  onTorrentDownload: (source: TorrentSource) => void;
  onDebridDownload: (source: TorrentSource) => void;
}

export function SourcePanel({
  details,
  episode,
  selectedEpisodes,
  downloadMethod,
  debridName,
  loadingSources,
  sourceResult,
  sources,
  busyAction,
  downloadLocations,
  selectedLocationId,
  externalClientAvailable,
  findSourcesRef,
  debridMethodRef,
  onFindSources,
  onSwitchMethod,
  onSelectLocation,
  onOpenTorrent,
  onTorrentDownload,
  onDebridDownload
}: SourcePanelProps) {
  const entireSeason = details.mediaType === "series" && episode === undefined;
  const emptyMessage = downloadMethod === "real-debrid"
    ? "No cached sources found."
    : entireSeason
      ? selectedEpisodes !== undefined
        ? "No torrent source contains all selected episodes with known file selections."
        : "No season-pack torrent sources found."
      : "No matching torrent sources.";

  return (
    <section className="source-panel">
      <div className="source-toolbar">
        <div>
          <h3>Download sources</h3>
          <span>{details.imdbId ?? "IMDb ID unavailable"}</span>
        </div>
        <button
          className="text-button button-sm"
          ref={findSourcesRef}
          onClick={onFindSources}
          disabled={loadingSources || !details.imdbId || selectedEpisodes?.length === 0}
          type="button"
        >
          {loadingSources ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />}
          Find sources
        </button>
      </div>

      <div className="download-method-switcher" role="group" aria-label="Download method">
        <SlidingIndicator />
        <button
          aria-pressed={downloadMethod === "torrent"}
          className={downloadMethod === "torrent" ? "active" : ""}
          onClick={() => onSwitchMethod("torrent")}
          type="button"
        >
          <Magnet size={16} />
          Torrent in app
        </button>
        <button
          ref={debridMethodRef}
          aria-pressed={downloadMethod === "real-debrid"}
          className={downloadMethod === "real-debrid" ? "active" : ""}
          onClick={() => onSwitchMethod("real-debrid")}
          type="button"
        >
          <ShieldCheck size={16} />
          {debridName} cached
        </button>
      </div>

      {downloadMethod === "real-debrid" && (
        <div className="source-mode-note cached">
          <ShieldCheck size={15} />
          {debridName} checks cache availability and file details before downloading.
        </div>
      )}
      <label className="download-destination-picker">
        <span><HardDriveDownload size={15} /> Save this download to</span>
        <select
          aria-label="Download destination"
          value={selectedLocationId}
          onChange={(event) => onSelectLocation(event.target.value)}
        >
          {downloadLocations?.locations.map((location) => (
            <option key={location.id} value={location.id} disabled={!location.isAvailable}>
              {location.label}{location.isDefault ? " (default)" : ""}{location.isAvailable ? "" : " — not connected"}
            </option>
          ))}
        </select>
        {!downloadLocations?.locations.some((location) => location.isAvailable) && (
          <small>No library is available. Connect an external drive or add a location in Settings.</small>
        )}
      </label>

      {Boolean(sourceResult?.providerErrors.length) && (
        <div className="source-provider-error">
          <AlertTriangle size={14} />
          <span>Built-in torrent search is temporarily unavailable. Try again shortly.</span>
        </div>
      )}

      {loadingSources && (
        <div className="discover-center-state compact">
          <Loader2 className="spin" size={20} />
          <span>{downloadMethod === "real-debrid" ? "Checking cached sources…" : "Finding torrent options…"}</span>
        </div>
      )}
      {!loadingSources && sourceResult && sourceResult.providerErrors.length === 0 && sources.length === 0 && (
        <div className="discover-center-state compact">
          <HardDriveDownload size={21} />
          <span>{emptyMessage}</span>
        </div>
      )}

      <div className="source-list">
        {sources.map((source) => (
          <SourceCard
            key={`${source.id}:${source.realDebridTorrentId ?? ""}`}
            source={source}
            method={downloadMethod}
            selectedEpisodeCount={selectedEpisodes?.length}
            entireSeason={entireSeason}
            busy={busyAction === `${downloadMethod === "torrent" ? "torrent" : "real-debrid"}:${source.id}`}
            onOpenTorrent={onOpenTorrent}
            onTorrentDownload={onTorrentDownload}
            onDownload={onDebridDownload}
            externalClientAvailable={externalClientAvailable}
          />
        ))}
      </div>
    </section>
  );
}
