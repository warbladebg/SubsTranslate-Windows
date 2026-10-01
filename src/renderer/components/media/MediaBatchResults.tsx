import { ExternalLink } from "lucide-react";
import { fileName } from "../../format";
import type { MediaBatchSessionItem } from "../../../main/mediaBatchSessionService";
import { batchStatusClass } from "./mediaFormatting";

interface MediaBatchResultsProps {
  items: MediaBatchSessionItem[];
  onOpenOutput: (path: string) => void;
}

export function MediaBatchResults({ items, onOpenOutput }: MediaBatchResultsProps) {
  const completedItems = items.filter((item) => item.status === "Complete").length;

  return (
    <section className="panel media-batch-results">
      <div className="panel-header">
        <h2>Batch files</h2>
        <span className={completedItems === items.length ? "status-pill ok" : "status-pill warn"}>
          {completedItems}/{items.length} complete
        </span>
      </div>
      <div className="media-batch-result-list">
        {items.map((item) => (
          <div className="media-batch-result" key={item.videoPath}>
            <div>
              <strong>{fileName(item.videoPath)}</strong>
              <span>{item.error || item.outputPath || item.videoPath}</span>
            </div>
            <span className={`status-pill ${batchStatusClass(item.status)}`}>{item.status}</span>
            {item.outputPath && (
              <button className="icon-button" onClick={() => onOpenOutput(item.outputPath!)} title={`Open ${fileName(item.outputPath)}`} type="button">
                <ExternalLink size={16} />
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
