import { AlertTriangle, CheckCircle2, ChevronDown, CloudDownload, ExternalLink, X } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { DownloadProgress } from "../../core/discovery/DiscoveryTypes";
import { formatBytes } from "../format";

interface DownloadProgressMonitorProps {
  collapsed: boolean;
  progress: DownloadProgress;
  onCollapse: () => void;
  onDismiss: () => void;
  onExpand: () => void;
  onCancel: () => void;
  onReveal: (path: string) => void;
}

export function DownloadProgressMonitor({
  collapsed,
  progress,
  onCollapse,
  onDismiss,
  onExpand,
  onCancel,
  onReveal
}: DownloadProgressMonitorProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  useEffect(() => setDetailsOpen(false), [progress.id]);
  const percent = progress.percent === undefined
    ? undefined
    : Math.max(0, Math.min(100, progress.percent));
  const statusLabel = downloadStatusLabel(progress.status);
  const showMoreInformation = progress.status === "downloading" || progress.status === "starting";
  const canDismiss = progress.status === "completed"
    || progress.status === "failed"
    || progress.status === "cancelled";
  return (
    <aside
      className={`download-monitor-shell ${collapsed ? "collapsed" : "expanded"} ${progress.status}`}
      aria-label="Download monitor"
    >
      <section
        className={`download-progress ${progress.status}`}
        aria-hidden={collapsed}
        aria-label="Download progress"
        aria-live="polite"
      >
        <div className="download-progress-header">
          <div className="download-progress-title">
            <span className="download-progress-icon">{downloadStatusIcon(progress.status)}</span>
            <div>
              <strong title={progress.filename}>{progress.filename}</strong>
              <span>
                {formatBytes(progress.receivedBytes)}
                {progress.totalBytes !== undefined ? ` of ${formatBytes(progress.totalBytes)}` : ""}
                {" · "}
                {statusLabel}
              </span>
            </div>
          </div>
          <button
            aria-label={canDismiss ? `Dismiss ${progress.status} download` : "Minimize download progress"}
            className="download-progress-close"
            onClick={canDismiss ? onDismiss : onCollapse}
            tabIndex={collapsed ? -1 : undefined}
            title={canDismiss ? "Permanently close download message" : "Minimize download progress"}
            type="button"
          >
            <X size={16} />
          </button>
        </div>
        {percent !== undefined && (
          <div
            className="download-progress-track"
            aria-label={`${percent.toFixed(0)}% downloaded`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={percent}
            role="progressbar"
          >
            <span style={{ width: `${percent}%` }} />
          </div>
        )}
        {showMoreInformation && detailsOpen && (
          <dl className="download-progress-details" id="download-progress-details">
            <div>
              <dt>Download speed</dt>
              <dd>{formatRate(progress.bytesPerSecond)}</dd>
            </div>
            <div>
              <dt>Time remaining</dt>
              <dd>{formatRemainingTime(progress.estimatedRemainingSeconds)}</dd>
            </div>
            <div>
              <dt>Elapsed time</dt>
              <dd>{formatDuration(progress.elapsedSeconds)}</dd>
            </div>
            <div>
              <dt>Transferred</dt>
              <dd>
                {formatBytes(progress.receivedBytes)}
                {progress.totalBytes !== undefined ? ` / ${formatBytes(progress.totalBytes)}` : ""}
              </dd>
            </div>
          </dl>
        )}
        <div className="download-progress-footer">
          <small>{progress.message || downloadStatusMessage(progress.status)}</small>
          {showMoreInformation ? (
            <div className="download-progress-actions">
              <button
                aria-controls="download-progress-details"
                aria-expanded={detailsOpen}
                className="text-button download-more-button"
                onClick={() => setDetailsOpen((open) => !open)}
                tabIndex={collapsed ? -1 : undefined}
                type="button"
              >
                More information
                <ChevronDown className={detailsOpen ? "expanded" : ""} size={14} />
              </button>
              <button
                className="text-button"
                onClick={onCancel}
                tabIndex={collapsed ? -1 : undefined}
                type="button"
              >
                <X size={15} /> Cancel
              </button>
            </div>
          ) : progress.status === "completed" && progress.outputPath ? (
            <button
              className="text-button"
              onClick={() => onReveal(progress.outputPath!)}
              tabIndex={collapsed ? -1 : undefined}
              type="button"
            >
              <ExternalLink size={15} /> Show file
            </button>
          ) : null}
        </div>
      </section>
      <button
        aria-hidden={!collapsed}
        aria-label={`Open download progress: ${progress.filename}, ${percent?.toFixed(0) ?? statusLabel}${percent === undefined ? "" : "%"}`}
        className="download-progress-blob"
        onClick={onExpand}
        style={{ "--download-percent": `${percent ?? 0}%` } as CSSProperties}
        tabIndex={collapsed ? undefined : -1}
        title={`${progress.filename} · ${statusLabel}`}
        type="button"
      >
        <span className="download-blob-icon">{downloadStatusIcon(progress.status)}</span>
        <strong>{percent === undefined ? statusLabel.slice(0, 1) : `${percent.toFixed(0)}%`}</strong>
      </button>
    </aside>
  );
}

function downloadStatusIcon(status: DownloadProgress["status"]): ReactNode {
  if (status === "completed") return <CheckCircle2 size={19} />;
  if (status === "failed") return <AlertTriangle size={19} />;
  if (status === "cancelled") return <X size={19} />;
  return <CloudDownload size={19} />;
}

function downloadStatusLabel(status: DownloadProgress["status"]): string {
  return status === "starting"
    ? "Starting"
    : status === "downloading"
      ? "Downloading"
      : status === "completed"
        ? "Completed"
        : status === "cancelled"
          ? "Cancelled"
          : "Failed";
}

function downloadStatusMessage(status: DownloadProgress["status"]): string {
  return status === "starting"
    ? "Preparing your download…"
    : status === "downloading"
      ? "You can keep browsing while this finishes."
      : status === "completed"
        ? "Your file is ready."
        : status === "cancelled"
          ? "The download was cancelled."
          : "The download could not be completed.";
}

function formatRate(bytesPerSecond: number | undefined): string {
  return bytesPerSecond === undefined || !Number.isFinite(bytesPerSecond)
    ? "Calculating…"
    : `${formatBytes(bytesPerSecond)}/s`;
}

function formatRemainingTime(seconds: number | undefined): string {
  return seconds === undefined || !Number.isFinite(seconds)
    ? "Calculating…"
    : formatDuration(seconds);
}

function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return "Less than a second";
  const rounded = Math.max(0, Math.round(seconds));
  if (rounded < 60) return `${rounded} sec`;
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  if (minutes < 60) return remainingSeconds > 0 ? `${minutes} min ${remainingSeconds} sec` : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours} hr ${remainingMinutes} min` : `${hours} hr`;
}
