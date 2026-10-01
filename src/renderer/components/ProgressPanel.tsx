import { Loader2 } from "lucide-react";

interface ProgressEntry {
  stage: string;
  message: string;
  progressPercent?: number;
  completedChunks?: number;
  totalChunks?: number;
}
interface Props {
  messages: ProgressEntry[];
  busy: boolean;
  /** Render without its own card, for use inside another panel. */
  embedded?: boolean;
}

/** Percentage from the newest message that reports one, either directly or as chunk counts. */
function latestPercent(messages: ProgressEntry[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (Number.isFinite(message.progressPercent)) return message.progressPercent!;
    if (message.completedChunks !== undefined && message.totalChunks) {
      return (message.completedChunks / message.totalChunks) * 100;
    }
  }
  return 0;
}

export function ProgressPanel({ messages, busy, embedded = false }: Props) {
  const percent = Math.max(0, Math.min(100, latestPercent(messages)));
  const latest = messages.at(-1);

  const content = (
    <>
      <div className="progress-heading">
        <strong>{latest?.stage ?? "Ready"}</strong>
        <span className="progress-percent">{busy && <Loader2 className="spin" size={13} />}{percent.toFixed(1)}%</span>
      </div>
      <div className="progress-bar" role="progressbar" aria-label="Work completed"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="progress-message" role="status" title={latest?.message}>
        {latest?.message ?? "Progress will appear here when work starts."}
      </p>
    </>
  );

  return embedded
    ? <div className={`progress-panel embedded${busy ? " busy" : ""}`}>{content}</div>
    : <section className={`panel progress-panel${busy ? " busy" : ""}`} aria-label="Progress">{content}</section>;
}
