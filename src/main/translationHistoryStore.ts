import { KeyedTaskQueue } from "../core/async/KeyedTaskQueue";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { addTokenUsage, emptyTokenUsage, estimateCostUsd, getModelPricing, TokenUsage } from "../core/usage/TokenUsage";
import type { ModelExchangeAudit } from "../core/translation/TranslationProvider";
import type { SubtitleTrack } from "../core/video/SubtitleTrack";
import type { AppSettings, TranslationProviderId } from "./settingsService";
import type { SampleMode } from "./translationManager";

const MAX_HISTORY_RUNS = 50;
const MAX_EXCHANGES_IN_VIEW = 200;

export interface TranslationRunInput {
  sessionId: string;
  videoPath: string;
  track: SubtitleTrack;
  settings: AppSettings;
  sampleMode: SampleMode;
}

export interface ModelExchangeAuditRecord extends ModelExchangeAudit {
  id: string;
  sessionId: string;
  providerId: TranslationProviderId;
  estimatedCostUsd?: number;
  pricingSource?: string;
}

export interface TranslationRunSummary {
  sessionId: string;
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  videoPath: string;
  fileName: string;
  outputPath?: string;
  track: Pick<SubtitleTrack, "index" | "codecName" | "language" | "title">;
  providerId: TranslationProviderId;
  providerName: string;
  modelId: string;
  sampleMode: SampleMode;
  requestCount: number;
  failedRequestCount: number;
  usage: TokenUsage;
  estimatedCostUsd?: number;
  pricingSource?: string;
  cueCount?: number;
  chunkCount?: number;
  cacheHits: number;
  warningCount: number;
  auditFilePath: string;
  lastError?: string;
}

export interface TranslationStatsView {
  latest?: TranslationRunSummary;
  selected?: TranslationRunSummary;
  runs: TranslationRunSummary[];
  selectedExchanges: ModelExchangeAuditRecord[];
  latestExchanges: ModelExchangeAuditRecord[];
  storageDirectory: string;
  pricingNotes: string[];
}

interface TranslationHistoryFile {
  latestSessionId?: string;
  runs: Record<string, TranslationRunSummary>;
}

export class TranslationHistoryStore {
  private readonly operations = new KeyedTaskQueue();
  constructor(
    private readonly historyFilePath: string,
    private readonly auditDirectory: string
  ) {}

  async startRun(input: TranslationRunInput): Promise<TranslationRunSummary> {
    return this.operations.run("store", async () => {
      const history = await this.readHistory();
      const now = new Date().toISOString();
      const existing = history.runs[input.sessionId];
      const run: TranslationRunSummary = {
        sessionId: input.sessionId,
        status: "running",
        startedAt: existing?.startedAt ?? now,
        videoPath: input.videoPath,
        fileName: basename(input.videoPath),
        track: {
          index: input.track.index,
          codecName: input.track.codecName,
          language: input.track.language,
          title: input.track.title
        },
        providerId: input.settings.providerId,
        providerName: providerNameForSettings(input.settings),
        modelId: modelIdForSettings(input.settings),
        sampleMode: input.sampleMode,
        requestCount: existing?.requestCount ?? 0,
        failedRequestCount: existing?.failedRequestCount ?? 0,
        usage: existing?.usage ?? emptyTokenUsage(),
        estimatedCostUsd: existing?.estimatedCostUsd,
        pricingSource: existing?.pricingSource ?? getModelPricing(input.settings.providerId, modelIdForSettings(input.settings))?.source,
        cacheHits: existing?.cacheHits ?? 0,
        warningCount: existing?.warningCount ?? 0,
        auditFilePath: this.auditFilePath(input.sessionId)
      };

      history.runs[run.sessionId] = run;
      history.latestSessionId = run.sessionId;
      await this.writeHistory(trimHistory(history));
      await mkdir(this.auditDirectory, { recursive: true });
      return run;
    });
  }

  async recordExchange(
    sessionId: string,
    providerId: TranslationProviderId,
    exchange: ModelExchangeAudit
  ): Promise<void> {
    return this.operations.run("store", async () => {
      const history = await this.readHistory();
      const run = history.runs[sessionId];
      if (!run) {
        return;
      }

      const pricing = getModelPricing(providerId, exchange.model);
      const record: ModelExchangeAuditRecord = {
        ...exchange,
        id: `${Date.parse(exchange.startedAt)}-${run.requestCount + 1}`,
        sessionId,
        providerId,
        estimatedCostUsd: estimateCostUsd(providerId, exchange.model, exchange.usage),
        pricingSource: pricing?.source
      };

      await mkdir(this.auditDirectory, { recursive: true });
      await appendFile(run.auditFilePath, `${JSON.stringify(record)}\n`, "utf8");

      run.status = "running";
      run.requestCount += 1;
      run.failedRequestCount += record.status === "failed" ? 1 : 0;
      run.usage = addTokenUsage(run.usage, record.usage);
      run.estimatedCostUsd = addOptionalCost(run.estimatedCostUsd, record.estimatedCostUsd);
      run.pricingSource = run.pricingSource ?? record.pricingSource;
      history.latestSessionId = sessionId;
      await this.writeHistory(trimHistory(history));
    });
  }

  async completeRun(
    sessionId: string,
    details: {
      outputPath: string;
      cueCount: number;
      chunkCount: number;
      cacheHits: number;
      warningCount: number;
    }
  ): Promise<void> {
    await this.updateRun(sessionId, (run) => {
      run.status = "completed";
      run.outputPath = details.outputPath;
      run.cueCount = details.cueCount;
      run.chunkCount = details.chunkCount;
      run.cacheHits = details.cacheHits;
      run.warningCount = details.warningCount;
      run.completedAt = new Date().toISOString();
      run.durationMs = Date.parse(run.completedAt) - Date.parse(run.startedAt);
      delete run.lastError;
    });
  }

  async failRun(sessionId: string, error: string): Promise<void> {
    await this.updateRun(sessionId, (run) => {
      run.status = "failed";
      run.completedAt = new Date().toISOString();
      run.durationMs = Date.parse(run.completedAt) - Date.parse(run.startedAt);
      run.lastError = error;
    });
  }

  async cancelRun(sessionId: string, error: string): Promise<void> {
    await this.updateRun(sessionId, (run) => {
      run.status = "cancelled";
      run.completedAt = new Date().toISOString();
      run.durationMs = Date.parse(run.completedAt) - Date.parse(run.startedAt);
      run.lastError = error;
    });
  }

  async getStats(selectedSessionId?: string): Promise<TranslationStatsView> {
    return this.operations.run("store", async () => {
      const history = await this.readHistory();
      const repricedRuns = Object.fromEntries(
        Object.entries(history.runs).map(([sessionId, run]) => [sessionId, repriceRun(run)])
      );
      const runs = Object.values(repricedRuns).sort((left, right) => right.startedAt.localeCompare(left.startedAt));
      const latest = history.latestSessionId ? repricedRuns[history.latestSessionId] : runs[0];
      const selected = selectedSessionId && repricedRuns[selectedSessionId] ? repricedRuns[selectedSessionId] : latest;
      const selectedExchanges = selected ? await this.readAudit(selected.auditFilePath) : [];
      const latestExchanges = latest?.sessionId === selected?.sessionId
        ? selectedExchanges
        : latest ? await this.readAudit(latest.auditFilePath) : [];
      return {
        latest,
        selected,
        runs,
        selectedExchanges,
        latestExchanges,
        storageDirectory: dirname(this.historyFilePath),
        pricingNotes: [
          "Cost is an estimate from captured token usage and provider list prices.",
          "When reported separately, thinking tokens are billed at the model output-token rate.",
          "Free credits, provider billing tiers, taxes, and account-specific discounts are not included."
        ]
      };
    });
  }

  private async updateRun(sessionId: string, update: (run: TranslationRunSummary) => void): Promise<void> {
    return this.operations.run("store", async () => {
      const history = await this.readHistory();
      const run = history.runs[sessionId];
      if (!run) {
        return;
      }

      update(run);
      history.latestSessionId = sessionId;
      await this.writeHistory(trimHistory(history));
    });
  }

  private async readHistory(): Promise<TranslationHistoryFile> {
    try {
      const parsed = JSON.parse(await readFile(this.historyFilePath, "utf8")) as Partial<TranslationHistoryFile>;
      return { latestSessionId: parsed.latestSessionId, runs: parsed.runs ?? {} };
    } catch {
      return { runs: {} };
    }
  }

  private async readAudit(auditFilePath: string): Promise<ModelExchangeAuditRecord[]> {
    try {
      const lines = (await readFile(auditFilePath, "utf8")).split(/\r?\n/).filter(Boolean);
      return lines
        .slice(-MAX_EXCHANGES_IN_VIEW)
        .map((line) => repriceExchange(JSON.parse(line) as ModelExchangeAuditRecord));
    } catch {
      return [];
    }
  }

  private async writeHistory(history: TranslationHistoryFile): Promise<void> {
    await mkdir(dirname(this.historyFilePath), { recursive: true });
    const tempPath = `${this.historyFilePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tempPath, JSON.stringify(history, null, 2), "utf8");
    await rename(tempPath, this.historyFilePath);
  }

  private auditFilePath(sessionId: string): string {
    return join(this.auditDirectory, `${sessionId}.jsonl`);
  }
}

function providerNameForSettings(settings: AppSettings): string {
  if (settings.providerId === "gemini") {
    return "Gemini";
  }

  if (settings.providerId === "vercel") {
    return "Vercel AI Gateway";
  }

  return "Mock Provider";
}

function modelIdForSettings(settings: AppSettings): string {
  if (settings.providerId === "gemini") {
    return settings.gemini.modelId;
  }

  if (settings.providerId === "vercel") {
    return settings.vercel.modelId;
  }

  return "mock";
}

function addOptionalCost(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined && right === undefined) {
    return undefined;
  }

  return (left ?? 0) + (right ?? 0);
}

function repriceRun(run: TranslationRunSummary): TranslationRunSummary {
  const currentCost = estimateCostUsd(run.providerId, run.modelId, run.usage);
  const currentPricing = getModelPricing(run.providerId, run.modelId);
  return {
    ...run,
    estimatedCostUsd: currentCost ?? run.estimatedCostUsd,
    pricingSource: currentPricing?.source ?? run.pricingSource
  };
}

function repriceExchange(exchange: ModelExchangeAuditRecord): ModelExchangeAuditRecord {
  const currentCost = estimateCostUsd(exchange.providerId, exchange.model, exchange.usage);
  const currentPricing = getModelPricing(exchange.providerId, exchange.model);
  return {
    ...exchange,
    estimatedCostUsd: currentCost ?? exchange.estimatedCostUsd,
    pricingSource: currentPricing?.source ?? exchange.pricingSource
  };
}

function trimHistory(history: TranslationHistoryFile): TranslationHistoryFile {
  const newest = Object.values(history.runs).sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  const keep = new Set(newest.slice(0, MAX_HISTORY_RUNS).map((run) => run.sessionId));
  const runs = Object.fromEntries(Object.entries(history.runs).filter(([sessionId]) => keep.has(sessionId)));

  return {
    latestSessionId: history.latestSessionId && runs[history.latestSessionId] ? history.latestSessionId : newest[0]?.sessionId,
    runs
  };
}
