import { Play, Square } from "lucide-react";
import type { MediaTransformProgress } from "../../../main/mediaTransformService";
import { ProgressPanel } from "../ProgressPanel";

interface MediaRunCardProps {
  busy: boolean;
  isBatchMode: boolean;
  batchVideoCount: number;
  resumable: boolean;
  canRun: boolean;
  canContinue: boolean;
  hint?: string;
  progress: MediaTransformProgress[];
  onRun: () => void;
  onContinue: () => void;
  onCancel: () => void;
}

export function MediaRunCard({
  busy,
  isBatchMode,
  batchVideoCount,
  resumable,
  canRun,
  canContinue,
  hint,
  progress,
  onRun,
  onContinue,
  onCancel
}: MediaRunCardProps) {
  return (
    <section className="panel run-panel" aria-label="Run">
      <div className="run-panel-header">
        <strong>Run</strong>
        {isBatchMode && <span className="status-pill">{batchVideoCount} file(s)</span>}
      </div>
      <ProgressPanel messages={progress} busy={busy} embedded />
      <div className="run-actions media-actions">
        {busy ? (
          <button className="text-button danger-button run-main-action workflow-cancel" onClick={onCancel} type="button">
            <Square size={15} /> Cancel workflow
          </button>
        ) : resumable ? (
          <button className="primary-button run-main-action" onClick={onContinue} disabled={!canContinue} type="button">
            <Play size={16} />
            Continue batch
          </button>
        ) : (
          <button className="primary-button run-main-action" onClick={onRun} disabled={!canRun} type="button">
            <Play size={16} />
            Run workflow{isBatchMode ? ` · ${batchVideoCount} files` : ""}
          </button>
        )}
      </div>
      {!busy && hint && <p className="run-hint">{hint}</p>}
    </section>
  );
}
