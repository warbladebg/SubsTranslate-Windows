import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, BarChart3, Database, ExternalLink, FileJson, ListChecks, RefreshCcw, X } from "lucide-react";
import type { ModelExchangeAuditRecord, TranslationStatsView } from "../../main/translationHistoryStore";
import { formatError, formatInteger } from "../format";
import { INERT_PROPS, useExitPresence } from "../hooks/useExitPresence";
import { AnimatedNumber } from "./AnimatedNumber";

export function StatsPage() {
  const [stats, setStats] = useState<TranslationStatsView>();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const requestIdRef = useRef(0);
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [selectedExchangeId, setSelectedExchangeId] = useState<string>();
  const [selectedSessionId, setSelectedSessionId] = useState<string>();
  const selectedRun = stats?.selected ?? stats?.latest;
  const exchanges = stats?.selectedExchanges ?? stats?.latestExchanges ?? [];
  const successfulRequests = selectedRun ? selectedRun.requestCount - selectedRun.failedRequestCount : 0;

  const loadStats = useCallback(async (sessionId: string | undefined): Promise<void> => {
    // Only the newest request may update the page when runs are switched quickly.
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadError(undefined);
    try {
      const nextStats = await window.subtitleTranslator.getTranslationStats(sessionId);
      if (requestId !== requestIdRef.current) return;
      setStats(nextStats);
      setSelectedSessionId((current) => current || nextStats.selected?.sessionId);
    } catch (error) {
      if (requestId === requestIdRef.current) setLoadError(`Could not load statistics: ${formatError(error)}`);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStats(selectedSessionId);
  }, [loadStats, selectedSessionId]);

  async function openPath(path?: string): Promise<void> {
    if (path) {
      await window.subtitleTranslator.showItemInFolder(path);
    }
  }

  function viewRun(sessionId: string): void {
    setSelectedExchangeId(undefined);
    setSelectedSessionId(sessionId);
  }

  function inspectExchange(id?: string): void {
    setSelectedExchangeId(id ?? exchanges.at(-1)?.id);
    setRequestModalOpen(true);
  }

  const runs = stats?.runs ?? [];

  return (
    <section className="page stats-page" aria-labelledby="stats-page-title">
      <header className="page-header">
        <div className="page-title">
          <h2 id="stats-page-title">Translation Statistics</h2>
          <p>Completed runs, token usage, model requests, and saved audit files.</p>
        </div>
        <div className="page-actions">
          <button className="text-button" onClick={() => openPath(stats?.storageDirectory)} disabled={!stats?.storageDirectory} type="button">
            <Database size={16} />
            Data folder
          </button>
          <button className="text-button" onClick={() => loadStats(selectedSessionId)} disabled={loading} type="button">
            <RefreshCcw size={16} className={loading ? "spin" : undefined} />
            Refresh
          </button>
        </div>
      </header>

      {loadError && (
        <div className="notice error" role="alert">
          <AlertCircle size={16} />
          <span>{loadError}</span>
        </div>
      )}

      {selectedRun ? (
        <section className="panel stats-run" aria-label="Selected translation">
          <div className="stats-run-header">
            <label className="field stats-run-picker">
              Viewed translation
              <select value={selectedRun.sessionId} onChange={(event) => viewRun(event.target.value)}>
                {runs.map((run) => (
                  <option key={run.sessionId} value={run.sessionId}>
                    {formatDate(run.startedAt)} · {run.fileName} · {run.providerName}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="stats-run-summary">
            <div>
              <strong title={selectedRun.fileName}>{selectedRun.fileName}</strong>
              <span>{selectedRun.providerName} · {selectedRun.modelId} · {formatDate(selectedRun.startedAt)}{selectedRun.durationMs ? ` · ${formatDuration(selectedRun.durationMs)}` : ""}</span>
            </div>
            <span className={`status-pill ${statusTone(selectedRun.status)}`}>{selectedRun.status}</span>
          </div>

          {selectedRun.lastError && (
            <div className="notice error">
              <AlertCircle size={16} />
              <span>{selectedRun.lastError}</span>
            </div>
          )}

          <div className="stats-kpis">
            <Kpi label="Requests" value={<AnimatedNumber value={selectedRun.requestCount} />}
              detail={`${formatInteger(successfulRequests)} successful · ${formatInteger(selectedRun.failedRequestCount)} failed`} />
            <Kpi label="Tokens" value={<AnimatedNumber value={selectedRun.usage.totalTokens} />}
              detail={`${formatInteger(selectedRun.usage.inputTokens)} in · ${formatInteger(selectedRun.usage.outputTokens)} out`} />
            <Kpi label="Estimated cost" value={selectedRun.estimatedCostUsd === undefined
              ? formatCost(undefined)
              : <AnimatedNumber value={selectedRun.estimatedCostUsd} format={formatCost} />}
              detail={selectedRun.pricingSource ?? "Pricing source unknown"} />
            <Kpi label="Cache hits" value={<AnimatedNumber value={selectedRun.cacheHits} />}
              detail={selectedRun.cueCount !== undefined ? `${formatInteger(selectedRun.cueCount)} cues translated` : "Reused translations"} />
          </div>

          <div className="stats-audit-row">
            <span className="field-label">Audit log</span>
            <div className="path-field" title={selectedRun.auditFilePath}>
              <FileJson size={14} />
              <span className="truncate">{selectedRun.auditFilePath}</span>
            </div>
            <button className="text-button" onClick={() => openPath(selectedRun.auditFilePath)} type="button">
              <ExternalLink size={15} />
              Open audit log
            </button>
          </div>
        </section>
      ) : (
        <section className="panel">
          <div className="empty-state">
            <span className="empty-state-icon"><BarChart3 size={22} /></span>
            <strong>No translation statistics recorded yet</strong>
            <span>Run a translation and its requests, tokens and costs will appear here.</span>
          </div>
        </section>
      )}

      {selectedRun && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2><ListChecks size={17} /> Model calls</h2>
              <p>{stats?.pricingNotes.join(" ")}</p>
            </div>
            <button className="text-button button-sm" onClick={() => inspectExchange()} disabled={exchanges.length === 0} type="button">
              <ListChecks size={15} />
              Request Details
            </button>
          </div>
          {exchanges.length === 0 ? (
            <p className="muted">No model calls recorded for this run.</p>
          ) : (
            <div className="exchange-list">
              {exchanges.slice(-12).reverse().map((exchange) => (
                <button className="exchange-row" key={exchange.id} onClick={() => inspectExchange(exchange.id)} type="button">
                  <span className={`exchange-status ${exchange.status}`} aria-hidden="true" />
                  <span className="exchange-main">
                    <strong>{exchange.status === "success" ? "Model call" : "Failed call"} · chunk {exchange.chunkIndex !== undefined ? exchange.chunkIndex + 1 : "–"}</strong>
                    <small>{formatDate(exchange.startedAt)} · {formatDuration(exchange.durationMs)}</small>
                  </span>
                  <span className="exchange-usage">{formatInteger(exchange.usage.totalTokens)} tokens</span>
                  <span className="exchange-usage">{formatCost(exchange.estimatedCostUsd)}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="panel">
        <div className="panel-header">
          <h2><Database size={17} /> Previous Translations</h2>
          <span className="status-pill">{runs.length}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Started</th>
                <th>File</th>
                <th>Provider</th>
                <th className="numeric">Requests</th>
                <th className="numeric">Tokens</th>
                <th className="numeric">Cost</th>
                <th>Status</th>
                <th className="actions-cell"><span className="sr-only">Audit</span></th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty-cell">No previous translations</td>
                </tr>
              )}
              {runs.map((run) => (
                <tr
                  className={`clickable${selectedRun?.sessionId === run.sessionId ? " selected" : ""}`}
                  key={run.sessionId}
                  onClick={() => viewRun(run.sessionId)}
                >
                  <td>{formatDate(run.startedAt)}</td>
                  <td className="truncate-cell">
                    <button className="table-link" onClick={(event) => { event.stopPropagation(); viewRun(run.sessionId); }} type="button">
                      {run.fileName}
                    </button>
                  </td>
                  <td>{run.providerName}</td>
                  <td className="numeric">{formatInteger(run.requestCount)}</td>
                  <td className="numeric">{formatInteger(run.usage.totalTokens)}</td>
                  <td className="numeric">{formatCost(run.estimatedCostUsd)}</td>
                  <td><span className={`status-pill ${statusTone(run.status)}`}>{run.status}</span></td>
                  <td className="actions-cell">
                    <button
                      className="icon-button small-icon-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void openPath(run.auditFilePath);
                      }}
                      title="Open audit log"
                      aria-label={`Open audit log for ${run.fileName}`}
                      type="button"
                    >
                      <ExternalLink size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <RequestDetailsModal
        open={requestModalOpen}
        exchanges={exchanges}
        selectedExchangeId={selectedExchangeId}
        onSelect={setSelectedExchangeId}
        onClose={() => setRequestModalOpen(false)}
      />
    </section>
  );
}

function Kpi({ label, value, detail }: { label: string; value: ReactNode; detail: string }) {
  return (
    <div className="stats-kpi">
      <span>{label}</span>
      <strong>{value}</strong>
      <small title={detail}>{detail}</small>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function statusTone(status: string): string {
  return status === "completed" ? "ok" : status === "failed" ? "error" : status === "running" ? "info" : "warn";
}

function RequestDetailsModal({
  open,
  exchanges,
  selectedExchangeId,
  onSelect,
  onClose
}: {
  open: boolean;
  exchanges: ModelExchangeAuditRecord[];
  selectedExchangeId?: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const ordered = [...exchanges].reverse();
  const selected = ordered.find((exchange) => exchange.id === selectedExchangeId) ?? ordered[0];

  const { present, closing } = useExitPresence(open, 200);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  if (!present) return null;
  return (
    <div
      className={`modal-backdrop${closing ? " closing" : ""}`}
      role="presentation"
      aria-hidden={closing || undefined}
      {...(closing ? INERT_PROPS : {})}
      onClick={(event) => !closing && event.target === event.currentTarget && onClose()}
    >
      <section className="modal request-modal" role="dialog" aria-modal="true" aria-label="Model request details">
        <div className="modal-header">
          <h2><ListChecks size={18} /> Request Details</h2>
          <button className="icon-button" onClick={onClose} title="Close request details" aria-label="Close request details" type="button">
            <X size={17} />
          </button>
        </div>
        <div className="request-modal-body">
          <aside className="request-list" aria-label="Recorded model requests">
            {ordered.map((exchange, index) => (
              <button
                className={selected?.id === exchange.id ? "active" : ""}
                key={exchange.id}
                onClick={() => onSelect(exchange.id)}
                type="button"
              >
                <strong><span className={`exchange-status ${exchange.status}`} aria-hidden="true" /> Request {ordered.length - index}</strong>
                <span>{exchange.status} · chunk {exchange.chunkIndex !== undefined ? exchange.chunkIndex + 1 : "–"}</span>
                <small>{formatInteger(exchange.usage.totalTokens)} tokens · {formatCost(exchange.estimatedCostUsd)}</small>
              </button>
            ))}
          </aside>
          {selected ? (
            <div className="request-detail">
              <div className="metric-grid request-detail-metrics">
                <Metric label="Status" value={selected.status} />
                <Metric label="Input tokens" value={formatInteger(selected.usage.inputTokens)} />
                <Metric label="Output tokens" value={formatInteger(selected.usage.outputTokens)} />
                <Metric label="Cost" value={formatCost(selected.estimatedCostUsd)} />
              </div>
              <div className="request-meta-grid">
                <span>Provider: {selected.provider}</span>
                <span>Model: {selected.model}</span>
                <span>Started: {formatDate(selected.startedAt)}</span>
                <span>Duration: {formatDuration(selected.durationMs)}</span>
              </div>
              <div className="exchange-detail-grid">
                <AuditBlock title="Input prompt" value={selected.prompt} />
                <AuditBlock title="Raw output" value={selected.rawOutput ?? selected.error ?? ""} />
              </div>
            </div>
          ) : (
            <div className="empty-state">No request details recorded.</div>
          )}
        </div>
      </section>
    </div>
  );
}

function AuditBlock({ title, value }: { title: string; value: string }) {
  return (
    <div className="audit-block">
      <strong>{title}</strong>
      <pre>{value || "-"}</pre>
    </div>
  );
}

function formatCost(value?: number): string {
  if (value === undefined) {
    return "Unknown";
  }

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 0.01 ? 4 : 2,
    maximumFractionDigits: value < 0.01 ? 4 : 2
  }).format(value);
}

function formatDate(value?: string): string {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDuration(value?: number): string {
  if (value === undefined) {
    return "-";
  }

  if (value < 1000) {
    return `${value} ms`;
  }
  if (value < 60_000) {
    return `${(value / 1000).toFixed(1)} s`;
  }

  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`;
}
