import { FolderOpen, Subtitles } from "lucide-react";
import { fileName } from "../../format";
import { subtitleEncodingProfiles, type SubtitleEncodingId } from "../../../core/media/SubtitleEncodings";
import type { SubtitleTrack } from "../../../core/video/SubtitleTrack";
import type { MediaWorkflowConfig } from "../../../main/workflowProfileService";
import { AppSelect } from "../AppSelect";

export type SubtitleWorkflow = MediaWorkflowConfig["subtitleWorkflow"];

interface MediaSubtitlePanelProps {
  isBatchMode: boolean;
  manual: boolean;
  busy: boolean;
  locked: boolean;
  subtitleWorkflow: SubtitleWorkflow;
  supportedSubtitleTracks: SubtitleTrack[];
  selectedTrack?: SubtitleTrack;
  subtitlePath: string;
  subtitleEncodingId: SubtitleEncodingId;
  keepOnlyNewSubtitleTrack: boolean;
  latestTranslatedSubtitleReady: boolean;
  batchVideoCount: number;
  batchSubtitleCount: number;
  batchMatchedCount: number;
  batchMissingVideoPaths: string[];
  onSubtitleWorkflowChange: (workflow: SubtitleWorkflow) => void;
  onSubtitleTrackChange: (track: SubtitleTrack | undefined) => void;
  onSubtitleEncodingChange: (id: SubtitleEncodingId) => void;
  onChooseSubtitleFile: () => void;
  onKeepOnlyNewSubtitleTrackChange: (value: boolean) => void;
}

export function MediaSubtitlePanel({
  isBatchMode,
  manual,
  busy,
  locked,
  subtitleWorkflow,
  supportedSubtitleTracks,
  selectedTrack,
  subtitlePath,
  subtitleEncodingId,
  keepOnlyNewSubtitleTrack,
  latestTranslatedSubtitleReady,
  batchVideoCount,
  batchSubtitleCount,
  batchMatchedCount,
  batchMissingVideoPaths,
  onSubtitleWorkflowChange,
  onSubtitleTrackChange,
  onSubtitleEncodingChange,
  onChooseSubtitleFile,
  onKeepOnlyNewSubtitleTrackChange
}: MediaSubtitlePanelProps) {
  const trackLabel = isBatchMode ? "Reference subtitle track" : "Subtitle track";

  return (
    <section className="panel media-subtitle-panel">
      <div className="panel-header">
        <h2>
          <Subtitles size={17} />
          Subtitles
        </h2>
        {!isBatchMode && latestTranslatedSubtitleReady && <span className="status-pill ok">Latest ready</span>}
      </div>

      <div className="control-grid">
        {manual && <div className="app-select-field">
          <span>Subtitle action</span>
          <AppSelect
            ariaLabel="Subtitle action"
            value={subtitleWorkflow}
            options={[
              { value: "existing", label: "Add translated subtitle file" },
              { value: "translate", label: "Translate selected track first" },
              { value: "none", label: "Do not add subtitles" }
            ]}
            onChange={(value) => onSubtitleWorkflowChange(value as SubtitleWorkflow)}
          />
        </div>}

        {subtitleWorkflow === "translate" && <div className="app-select-field">
          <span>{trackLabel}</span>
          <AppSelect
            ariaLabel={trackLabel}
            value={selectedTrack === undefined ? "" : String(selectedTrack.index)}
            disabled={supportedSubtitleTracks.length === 0 || locked}
            options={supportedSubtitleTracks.map((track) => ({
              value: String(track.index),
              label: `${track.index} / ${track.language || "und"} / ${track.codecName}`
            }))}
            onChange={(value) => {
              const trackIndex = Number(value);
              onSubtitleTrackChange(supportedSubtitleTracks.find((track) => track.index === trackIndex));
            }}
            placeholder="No supported subtitle tracks"
          />
        </div>}

        {manual && subtitleWorkflow === "existing" && <div className="app-select-field">
          <span>Encoding</span>
          <AppSelect
            ariaLabel="Encoding"
            value={subtitleEncodingId}
            options={subtitleEncodingProfiles.map((encoding) => ({
              value: encoding.id,
              label: encoding.label
            }))}
            onChange={(value) => onSubtitleEncodingChange(value as SubtitleEncodingId)}
          />
        </div>}
      </div>

      {subtitleWorkflow === "existing" && (
        <>
          <div className="subtitle-file-row">
            <div className="path-field" title={isBatchMode ? undefined : subtitlePath}>
              <Subtitles size={14} />
              <span className="truncate">
                {isBatchMode
                  ? batchSubtitleCount > 0
                    ? `${batchSubtitleCount} subtitle file(s) selected · ${batchMatchedCount}/${batchVideoCount} matched`
                    : "No subtitle files selected"
                  : subtitlePath || "No subtitle file selected"}
              </span>
            </div>
            <button className="text-button" onClick={onChooseSubtitleFile} disabled={busy || locked} type="button">
              <FolderOpen size={15} />
              {isBatchMode ? "Subtitle files" : "Subtitle file"}
            </button>
          </div>
          {isBatchMode && batchMissingVideoPaths.length > 0 && batchSubtitleCount > 0 && (
            <div className="batch-match-warning">
              Missing or ambiguous: {batchMissingVideoPaths.map(fileName).join(", ")}
            </div>
          )}
        </>
      )}
      {manual && subtitleWorkflow !== "none" && <div className="workflow-subpart-toggle settings-field-wide">
        <label>
          <input
            type="checkbox"
            checked={keepOnlyNewSubtitleTrack}
            onChange={(event) => onKeepOnlyNewSubtitleTrackChange(event.target.checked)}
          />
          <Subtitles size={15} /> Keep only added subtitle track
        </label>
        <small>Removes embedded subtitle tracks and keeps only the Bulgarian subtitle added above.</small>
      </div>}
    </section>
  );
}
