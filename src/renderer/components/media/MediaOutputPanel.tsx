import { FolderOpen, HardDriveDownload } from "lucide-react";
import { mediaContainerProfiles, type MediaContainerId } from "../../../core/media/MediaContainers";
import type { MediaOutputMode } from "../../../main/mediaTransformService";
import type { AppSettings } from "../../../main/settingsService";
import { AppSelect } from "../AppSelect";
import { SlidingIndicator } from "../SlidingIndicator";

interface MediaOutputPanelProps {
  isBatchMode: boolean;
  manual: boolean;
  busy: boolean;
  locked: boolean;
  videoPath: string;
  batchVideoCount: number;
  hasSources: boolean;
  allSourcesAreMkv: boolean;
  outputMode: MediaOutputMode;
  outputContainerId: MediaContainerId;
  outputConflictMode: AppSettings["outputConflictMode"];
  outputDirectory?: string;
  onChooseOutputFolder: () => void;
  onOutputModeChange: (mode: MediaOutputMode) => void;
  onOutputContainerChange: (id: MediaContainerId) => void;
  onOutputConflictModeChange: (mode: AppSettings["outputConflictMode"]) => void;
}

export function MediaOutputPanel({
  isBatchMode,
  manual,
  busy,
  locked,
  videoPath,
  batchVideoCount,
  hasSources,
  allSourcesAreMkv,
  outputMode,
  outputContainerId,
  outputConflictMode,
  outputDirectory,
  onChooseOutputFolder,
  onOutputModeChange,
  onOutputContainerChange,
  onOutputConflictModeChange
}: MediaOutputPanelProps) {
  const selectedContainer =
    mediaContainerProfiles.find((container) => container.id === outputContainerId) ?? mediaContainerProfiles[0];
  const replaceUnavailable = hasSources && !allSourcesAreMkv;
  const replacing = outputMode === "replace-original";

  return (
    <section className="panel output-panel">
      <div className="panel-header">
        <h2><HardDriveDownload size={17} /> Output</h2>
      </div>

      {manual && (
        <div className="stack output-settings">
          <div className="mode-toggle" role="group" aria-label="Output mode">
            <SlidingIndicator />
            <button className={outputMode === "new-file" ? "active" : ""} onClick={() => onOutputModeChange("new-file")} type="button">
              New file
            </button>
            <button
              className={replacing ? "active danger" : ""}
              onClick={() => onOutputModeChange("replace-original")}
              disabled={replaceUnavailable}
              type="button"
              title={replaceUnavailable ? "Replace original requires every selected file to be MKV" : undefined}
            >
              Replace original
            </button>
          </div>
          {!replacing && (
            <div className="form-grid">
              <div className="app-select-field output-format-field">
                <span>Media format</span>
                <AppSelect
                  ariaLabel="Media format"
                  value={outputContainerId}
                  options={mediaContainerProfiles.map((container) => ({
                    value: container.id,
                    label: container.label
                  }))}
                  onChange={(value) => onOutputContainerChange(value as MediaContainerId)}
                />
              </div>
              <div className="app-select-field">
                <span>Existing file</span>
                <AppSelect
                  ariaLabel="Existing file"
                  value={outputConflictMode}
                  options={[
                    { value: "versioned", label: "Versioned filename" },
                    { value: "overwrite", label: "Overwrite" },
                    { value: "cancel", label: "Cancel" }
                  ]}
                  onChange={(value) => onOutputConflictModeChange(value as AppSettings["outputConflictMode"])}
                />
              </div>
              <small className="field-hint wide">{selectedContainer.description}</small>
            </div>
          )}
        </div>
      )}

      <div className="output-destination">
        <span className="field-label">{replacing ? "Replaces" : "Save to"}</span>
        <div className="path-field" title={replacing ? videoPath : outputDirectory}>
          <FolderOpen size={14} />
          <span className="truncate">
            {replacing
              ? isBatchMode
                ? `${batchVideoCount} original MKV file(s)`
                : videoPath || "Original MKV path"
              : outputDirectory || (isBatchMode ? "Same folder as each source video" : "Same folder as source video")}
          </span>
        </div>
        {!replacing && (
          <button className="text-button" onClick={onChooseOutputFolder} disabled={busy || locked} type="button">
            Folder
          </button>
        )}
      </div>
      {replacing && (
        <p className="inline-warning">The original MKV is replaced after the new file is built successfully.</p>
      )}
    </section>
  );
}
