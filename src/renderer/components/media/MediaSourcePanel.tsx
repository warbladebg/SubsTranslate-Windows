import { FileVideo, Files, FolderOpen, Plus, Star, Trash2 } from "lucide-react";
import { fileName } from "../../format";
import type { ProbeResult } from "../../../core/video/ProbeResult";
import { SlidingIndicator } from "../SlidingIndicator";

export type MediaInputMode = "single" | "batch";

interface MediaSourcePanelProps {
  inputMode: MediaInputMode;
  videoPath: string;
  batchVideoPaths: string[];
  probe?: ProbeResult;
  busy: boolean;
  locked: boolean;
  onChoose: () => void;
  onModeChange: (mode: MediaInputMode) => void;
  onSelectReference: (path: string) => void;
  onRemove: (path: string) => void;
  onClear: () => void;
}

export function MediaSourcePanel({
  inputMode,
  videoPath,
  batchVideoPaths,
  probe,
  busy,
  locked,
  onChoose,
  onModeChange,
  onSelectReference,
  onRemove,
  onClear
}: MediaSourcePanelProps) {
  const isBatchMode = inputMode === "batch";
  const controlsDisabled = busy || locked;
  const hasSource = isBatchMode ? batchVideoPaths.length > 0 : Boolean(videoPath);

  return (
    <section className="panel file-panel">
      <div className="panel-header">
        <h2>
          {isBatchMode ? <Files size={17} /> : <FileVideo size={17} />}
          {isBatchMode ? "Video batch" : "Video"}
        </h2>
        <div className="mode-toggle media-input-toggle" role="group" aria-label="Media input mode">
          <SlidingIndicator />
          <button className={inputMode === "single" ? "active" : ""} onClick={() => onModeChange("single")} disabled={controlsDisabled} type="button">
            Single file
          </button>
          <button className={inputMode === "batch" ? "active" : ""} onClick={() => onModeChange("batch")} disabled={busy} type="button">
            Batch files
          </button>
        </div>
      </div>

      {!hasSource ? (
        <div className="empty-state compact dropzone">
          <span className="empty-state-icon">{isBatchMode ? <Files size={22} /> : <FileVideo size={22} />}</span>
          <strong>{isBatchMode ? "No batch files selected" : "No video selected"}</strong>
          <span>
            {isBatchMode
              ? "Add several videos. One of them is used as the reference for track choices."
              : "Choose the video to remux, convert or add subtitles to."}
          </span>
          <button className="primary-button" onClick={onChoose} disabled={controlsDisabled} type="button">
            {isBatchMode ? <Plus size={16} /> : <FolderOpen size={16} />}
            {isBatchMode ? "Add files" : "Choose"}
          </button>
        </div>
      ) : isBatchMode ? (
        <>
          <div className="media-batch-toolbar">
            <span>{batchVideoPaths.length} video file(s) selected</span>
            <div className="button-row">
              <button className="text-button button-sm" onClick={onChoose} disabled={controlsDisabled} type="button">
                <Plus size={14} /> Add files
              </button>
              <button className="ghost-button button-sm media-batch-clear" onClick={onClear} disabled={controlsDisabled} type="button">
                Clear batch
              </button>
            </div>
          </div>
          <div className="media-batch-file-list">
            {batchVideoPaths.map((path) => {
              const isReference = path === videoPath;
              return (
                <div className={`media-batch-file${isReference ? " active" : ""}`} key={path}>
                  <button className="media-batch-file-select" onClick={() => onSelectReference(path)} disabled={controlsDisabled} type="button">
                    <span className="media-batch-file-name">{fileName(path)}</span>
                    <small>{isReference ? <><Star size={11} /> Settings reference</> : "Use as settings reference"}</small>
                  </button>
                  <button className="icon-button button-sm" onClick={() => onRemove(path)} disabled={controlsDisabled} title={`Remove ${fileName(path)}`} aria-label={`Remove ${fileName(path)}`} type="button">
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="file-summary">
          <span className="file-summary-icon" aria-hidden="true"><FileVideo size={20} /></span>
          <div>
            <strong title={videoPath}>{fileName(videoPath)}</strong>
            <span title={videoPath}>{videoPath}</span>
          </div>
          <button className="text-button button-sm" onClick={onChoose} disabled={controlsDisabled} type="button">
            <FolderOpen size={14} /> Choose
          </button>
        </div>
      )}

      {probe && hasSource && (
        <div className="chip-row media-probe-chips">
          <span className="chip">{probe.formatName.split(",")[0]}</span>
          <span className="chip">{probe.durationSeconds ? `${Math.round(probe.durationSeconds / 60)} min` : "duration unknown"}</span>
          <span className="chip">{probe.audioTracks.length} audio track(s){isBatchMode ? " in reference" : ""}</span>
        </div>
      )}
    </section>
  );
}
