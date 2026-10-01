import { Captions, CloudDownload, Loader2, Magnet, ShieldCheck } from "lucide-react";
import type { TorrentSource } from "../../../core/discovery/DiscoveryTypes";
import { formatRelativeTime } from "./discoveryFormatting";
import { formatBytes } from "../../format";
import type { DownloadMethod } from "./SourcePanel";

export function SourceCard({
  source,
  method,
  entireSeason,
  selectedEpisodeCount,
  busy,
  onOpenTorrent,
  onTorrentDownload,
  externalClientAvailable,
  onDownload
}: {
  source: TorrentSource;
  method: DownloadMethod;
  entireSeason: boolean;
  selectedEpisodeCount?: number;
  busy: boolean;
  onOpenTorrent: (source: TorrentSource) => void;
  onTorrentDownload: (source: TorrentSource) => void;
  externalClientAvailable: boolean;
  onDownload: (source: TorrentSource) => void;
}) {
  return (
    <article className="source-card">
      <div className="source-card-main">
        <div className="source-title">
          <strong>{source.name}</strong>
          {source.cacheStatus === "verified-account-cached" && (
            <span className="status-pill ok"><ShieldCheck size={13} /> Account cached</span>
          )}
          {source.cacheStatus === "provider-claimed-cached" && (
            <span className="status-pill ok"><CloudDownload size={13} /> Provider cached</span>
          )}
          {source.cacheStatus === "verified-provider-cached" && (
            <span className="status-pill ok"><CloudDownload size={13} /> Cache checked</span>
          )}
        </div>
        <span className="source-provider">{source.provider} · observed {formatRelativeTime(source.observedAt)}</span>
        <div className="source-badges">
          {source.quality && <span>{source.quality}</span>}
          {source.codec && <span>{source.codec}</span>}
          {source.hdr && <span>{source.hdr}</span>}
          {source.audio && <span>{source.audio}</span>}
          {source.audioLanguages?.[0] && (
            <span title={`Audio language${source.audioLanguages.length === 1 ? "" : "s"}: ${source.audioLanguages.join(", ")}`}>
              {source.audioLanguages.includes("English") ? "English" : source.audioLanguages[0]}
            </span>
          )}
          {source.isSeasonPack && <span>Season pack</span>}
          {source.advertisedSubtitleLanguages !== undefined && (
            <span
              className="source-subs-badge"
              title="Subtitles are advertised by provider or release metadata but are not verified until the media is downloaded."
            >
              <Captions size={13} />
              Subs advertised
              {source.advertisedSubtitleLanguages.length > 0
                ? ` · ${source.advertisedSubtitleLanguages.join(", ")}`
                : ""}
            </span>
          )}
          {source.sizeBytes !== undefined && <span>{formatBytes(source.sizeBytes)}</span>}
          {source.seeders !== undefined && <span>{source.seeders} seeders</span>}
        </div>
        {source.cacheStatus === "provider-claimed-cached" && (
          <small>Availability is confirmed with Real-Debrid when the download starts.</small>
        )}
        {method === "real-debrid" && source.cacheStatus === "unknown" && (
          <small>Cache availability is checked when the download starts.</small>
        )}
      </div>
      <div className="source-card-actions">
        <button
          className="primary-button"
          onClick={() => method === "torrent" ? onTorrentDownload(source) : onDownload(source)}
          disabled={busy || selectedEpisodeCount === 0}
          type="button"
        >
          {busy
            ? <Loader2 className="spin" size={16} />
            : method === "torrent"
              ? <Magnet size={16} />
              : <CloudDownload size={16} />}
          {selectedEpisodeCount !== undefined ? `Download ${selectedEpisodeCount} episode${selectedEpisodeCount === 1 ? "" : "s"}` : entireSeason
            ? "Download season"
            : "Download"}
        </button>
        {method === "torrent" && externalClientAvailable && (
          <button className="text-button" disabled={busy} onClick={() => onOpenTorrent(source)} type="button">
            Open in external client
          </button>
        )}
      </div>
    </article>
  );
}
