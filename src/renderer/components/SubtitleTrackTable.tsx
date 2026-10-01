import { Captions, CheckCircle2, Download, ImageOff } from "lucide-react";
import { canExportSubtitleTrack } from "../../core/video/SubtitleTrack";
import type { SubtitleTrack } from "../../core/video/SubtitleTrack";

interface Props {
  tracks: SubtitleTrack[];
  selectedTrack?: SubtitleTrack;
  onSelect: (track: SubtitleTrack) => void;
  onExportTrack?: (track: SubtitleTrack) => void;
  onExportAll?: () => void;
  exporting?: boolean;
}

export function SubtitleTrackTable({ tracks, selectedTrack, onSelect, onExportTrack, onExportAll, exporting }: Props) {
  const exportableTracks = tracks.filter(canExportSubtitleTrack);

  return (
    <section className="panel track-panel">
      <div className="panel-header">
        <h2><Captions size={17} /> Subtitle tracks <span className="status-pill">{tracks.length}</span></h2>
        <div className="button-row">
          <button
            className="text-button button-sm"
            onClick={onExportAll}
            disabled={exportableTracks.length === 0 || exporting}
            type="button"
          >
            <Download size={16} />
            Export all as SRT
          </button>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th><span className="sr-only">Selected</span></th>
              <th>#</th>
              <th>Language</th>
              <th>Codec</th>
              <th>Title</th>
              <th>Type</th>
              <th className="actions-cell"><span className="sr-only">Export</span></th>
            </tr>
          </thead>
          <tbody>
            {tracks.length === 0 && (
              <tr>
                <td colSpan={7} className="empty-cell">No subtitle tracks detected</td>
              </tr>
            )}
            {tracks.map((track) => (
              <tr
                key={track.index}
                className={[
                  selectedTrack?.index === track.index ? "selected" : "",
                  track.isSupported ? "clickable" : "unsupported"
                ].join(" ").trim()}
                onClick={() => !exporting && track.isSupported && onSelect(track)}
              >
                <td>
                  <input
                    type="radio"
                    checked={selectedTrack?.index === track.index}
                    disabled={exporting || !track.isSupported}
                    onChange={() => onSelect(track)}
                    aria-label={`Select subtitle track ${track.index}`}
                  />
                </td>
                <td className="track-index">{track.index}</td>
                <td className="track-language">{track.language || "und"}</td>
                <td>{track.codecName}</td>
                <td>{track.title || "–"}</td>
                <td>
                  {track.requiresOcr ? (
                    <span className="status-pill ocr"><CheckCircle2 size={14} />PGS</span>
                  ) : track.isTextBased ? (
                    <span className="status-pill ok"><CheckCircle2 size={14} />Text</span>
                  ) : (
                    <span className="status-pill warn"><ImageOff size={14} />Unsupported</span>
                  )}
                </td>
                <td className="actions-cell">
                  <button
                    aria-label={track.requiresOcr ? `Export track ${track.index} as SRT (OCR, no translation)` : `Export track ${track.index} as SRT`}
                    className="icon-button small-icon-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onExportTrack?.(track);
                    }}
                    disabled={!canExportSubtitleTrack(track) || exporting}
                    title={track.requiresOcr ? "Export as SRT (OCR, no translation)" : "Export as SRT"}
                    type="button"
                  >
                    <Download size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
