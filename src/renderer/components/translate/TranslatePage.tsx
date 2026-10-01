import { AlertCircle, CheckCircle2, ExternalLink, FileVideo, FolderOpen, FolderSearch, Gauge, Loader2, Play, Square, Zap } from "lucide-react";
import type { AppSettings } from "../../../main/settingsService";
import type { BatchItemProgress, SampleMode } from "../../../main/translationManager";
import { fileName } from "../../format";
import { AnimatedNumber } from "../AnimatedNumber";
import type { ApiKeyInput } from "../../hooks/useAppData";
import { hasProviderKey, type ProviderKeyStatus } from "../../providerKeys";
import { appCopy, type UiLanguage } from "../../uiLanguage";
import { ProgressPanel } from "../ProgressPanel";
import { SettingsPanel } from "../SettingsPanel";
import { SubtitleTrackTable } from "../SubtitleTrackTable";
import type { useTranslationWorkspace } from "./useTranslationWorkspace";
import { SlidingIndicator } from "../SlidingIndicator";

export type { TranslateMode } from "./useTranslationWorkspace";

type Workspace = ReturnType<typeof useTranslationWorkspace>;
type Copy = (typeof appCopy)[UiLanguage];

interface TranslatePageProps {
  uiLanguage: UiLanguage;
  settings: AppSettings;
  keys: ProviderKeyStatus;
  workspace: Workspace;
  onSettingsChange: (settings: AppSettings) => void;
  onSaveSettings: (settings: AppSettings, apiKeys?: ApiKeyInput) => Promise<void>;
}

interface SectionProps {
  copy: Copy;
  uiLanguage: UiLanguage;
  workspace: Workspace;
}

export function TranslatePage({ uiLanguage, settings, keys, workspace: w, onSettingsChange, onSaveSettings }: TranslatePageProps) {
  const copy = appCopy[uiLanguage];
  const t = copy.translate;
  const isBatch = w.mode === "batch";
  const sectionProps = { copy, uiLanguage, workspace: w };

  return (
    <section className="page translate-page" aria-labelledby="translate-page-title">
      <header className="page-header">
        <div className="page-title">
          <h2 id="translate-page-title">{copy.navigation.translate[0]}</h2>
          <p>{copy.pageDetails.translate[2]}</p>
        </div>
        <div className="segmented" role="group" aria-label={t.mode}>
          <SlidingIndicator />
          <button aria-pressed={!isBatch} className={!isBatch ? "active" : ""} disabled={w.busy} onClick={() => w.setMode("single")} type="button">
            <FileVideo size={15} /> {t.singleMode}
          </button>
          <button aria-pressed={isBatch} className={isBatch ? "active" : ""} disabled={w.busy} onClick={() => w.setMode("batch")} type="button">
            <FolderSearch size={15} /> {t.batchMode}
          </button>
        </div>
      </header>

      <div className="two-column">
        <div className="column">
          {isBatch ? <BatchPanel {...sectionProps} /> : <VideoPanel {...sectionProps} />}
          <OptionsPanel {...sectionProps} settings={settings} onSettingsChange={onSettingsChange} />
        </div>

        <aside className="column sticky-column">
          <RunPanel {...sectionProps} settings={settings} keys={keys} />
          {!isBatch && <DryRunPanel {...sectionProps} />}
          {w.error && (
            <section className="notice error" role="alert">
              <AlertCircle size={18} />
              <span>{w.error}</span>
            </section>
          )}
          <ResultNotices {...sectionProps} />
          <SettingsPanel
            settings={settings}
            hasGeminiKey={keys.hasGeminiKey}
            hasVercelKey={keys.hasVercelKey}
            onSave={onSaveSettings}
          />
        </aside>
      </div>
    </section>
  );
}

function VideoPanel({ copy, workspace: w }: SectionProps) {
  const t = copy.translate;
  return (
    <>
      <section className="panel file-panel">
        <div className="panel-header">
          <h2><FileVideo size={17} /> {t.video}</h2>
          {w.videoPath && (
            <button className="text-button button-sm" onClick={w.chooseVideo} disabled={w.busy} aria-label={copy.actions.chooseVideo} type="button">
              <FolderOpen size={15} />
              {copy.actions.change}
            </button>
          )}
        </div>
        {w.videoPath ? (
          <div className="file-summary">
            <span className="file-summary-icon" aria-hidden="true"><FileVideo size={20} /></span>
            <div>
              <strong title={w.videoPath}>{fileName(w.videoPath)}</strong>
              <span title={w.videoPath}>{w.videoPath}</span>
              {w.probe && (
                <div className="chip-row">
                  <span className="chip">{w.probe.formatName.split(",")[0]}</span>
                  <span className="chip">{w.probe.durationSeconds ? `${Math.round(w.probe.durationSeconds / 60)} min` : t.durationUnknown}</span>
                  <span className="chip">{w.supportedTracks.length} {t.supportedTracks}</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="empty-state compact dropzone">
            <span className="empty-state-icon"><FileVideo size={22} /></span>
            <strong>{t.chooseVideoTitle}</strong>
            <span>{t.chooseVideoText}</span>
            <button className="primary-button" onClick={w.chooseVideo} disabled={w.busy} type="button">
              <FolderOpen size={16} />
              {copy.actions.chooseVideo}
            </button>
          </div>
        )}
      </section>

      {w.videoPath && (
        <SubtitleTrackTable
          tracks={w.probe?.subtitleTracks ?? []}
          selectedTrack={w.selectedTrack}
          onSelect={w.setSelectedTrack}
          onExportTrack={(track) => void w.exportTrack(track)}
          onExportAll={() => void w.exportAllTracks()}
          exporting={w.busy}
        />
      )}
    </>
  );
}

function OptionsPanel({ copy, workspace: w, settings, onSettingsChange }: SectionProps & {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
}) {
  const t = copy.translate;
  const isBatch = w.mode === "batch";
  return (
    <section className="panel options-panel">
      <div className="panel-header">
        <h2>{t.translation}</h2>
        <span className="chip">{t.target}: {t.targetValue}</span>
      </div>

      <div className="profile-runner">
        <label className="field">
          {t.workflowPreset}
          <select
            value={w.selectedProfileId}
            onChange={(event) => w.setSelectedProfileId(event.target.value)}
            disabled={w.translationProfiles.length === 0 || w.busy}
          >
            {w.translationProfiles.length === 0 && <option value="">{t.noTranslationProfiles}</option>}
            {w.translationProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.name}</option>
            ))}
          </select>
        </label>
        <button
          className="text-button"
          onClick={() => void w.applyTranslationProfile()}
          disabled={!w.selectedProfileId || w.busy}
          title={copy.actions.applyProfileTitle}
          type="button"
        >
          <Zap size={15} />
          {copy.actions.applyProfile}
        </button>
      </div>

      <div className="form-grid">
        <label>
          {t.context}
          <select value={settings.contextMode} onChange={(event) => onSettingsChange({ ...settings, contextMode: event.target.value as AppSettings["contextMode"] })}>
            <option value="auto">{t.autoContext}</option>
            <option value="minimal">{t.minimalContext}</option>
            <option value="larger">{t.largerContext}</option>
          </select>
        </label>
        {!isBatch && (
          <label>
            {t.sample}
            <select value={w.sampleMode} onChange={(event) => w.setSampleMode(event.target.value as SampleMode)}>
              <option value="none">{t.fullFile}</option>
              <option value="first20">{t.first20}</option>
              <option value="firstScene">{t.firstScene}</option>
              <option value="first3Minutes">{t.first3Minutes}</option>
            </select>
          </label>
        )}
        <label>
          {t.existingFile}
          <select value={settings.outputConflictMode} onChange={(event) => onSettingsChange({ ...settings, outputConflictMode: event.target.value as AppSettings["outputConflictMode"] })}>
            <option value="versioned">{t.versionedFilename}</option>
            <option value="overwrite">{t.overwrite}</option>
            <option value="cancel">{t.cancel}</option>
          </select>
        </label>
      </div>

      <div className="save-to-row">
        <span className="field-label">{t.saveTo}</span>
        <div className="path-field" title={w.outputDirectory}>
          <FolderOpen size={14} />
          <span className="truncate">{w.outputDirectory || (isBatch ? t.sameFolderBatch : t.sameFolder)}</span>
        </div>
        <button className="text-button" onClick={w.chooseOutputFolder} aria-label={copy.actions.outputFolder} type="button">
          {copy.actions.change}
        </button>
      </div>
    </section>
  );
}

function RunPanel({ copy, workspace: w, settings, keys }: SectionProps & { settings: AppSettings; keys: ProviderKeyStatus }) {
  const t = copy.translate;
  const isBatch = w.mode === "batch";
  const keySaved = hasProviderKey(settings.providerId, keys);
  const canStartBatch = Boolean(w.batchFolder) && !w.busy && w.batchEnabled;
  const hint = w.busy
    ? undefined
    : isBatch
      ? !w.batchEnabled ? t.batchLocked : w.batchCanContinue ? t.batchResume : !w.batchFolder ? t.runHintBatch : undefined
      : !w.canTranslate ? t.runHintSingle : undefined;

  return (
    <section className="panel run-panel" aria-label={t.run}>
      <div className="run-panel-header">
        <strong>{t.run}</strong>
        {settings.providerId !== "mock" && (
          <span className={keySaved ? "status-pill ok" : "status-pill warn"}>
            {settings.providerId === "gemini"
              ? keySaved ? t.geminiKeySaved : t.geminiKeyMissing
              : keySaved ? t.vercelKeySaved : t.vercelKeyMissing}
          </span>
        )}
      </div>
      <ProgressPanel messages={w.progress} busy={w.busy} embedded />
      <div className="run-actions">
        {w.busy ? (
          <button className="text-button danger-button run-main-action" onClick={w.cancel} type="button">
            <Square size={15} />
            {copy.actions.cancel}
          </button>
        ) : isBatch ? (
          <button className="primary-button run-main-action" onClick={() => void w.startBatch(w.batchCanContinue)} disabled={!canStartBatch} type="button">
            <Play size={16} />
            {w.batchCanContinue ? copy.actions.continueBatch : copy.actions.startBatch}
          </button>
        ) : (
          <>
            <button className="primary-button run-main-action" onClick={w.translate} disabled={!w.canTranslate} type="button">
              <Play size={16} />
              {w.error ? copy.actions.retry : copy.actions.translate}
            </button>
            <button className="text-button" onClick={w.runDryRun} disabled={!w.selectedTrack || w.busy} title={copy.actions.dryRun} type="button">
              <Gauge size={15} />
              {copy.actions.estimate}
            </button>
          </>
        )}
      </div>
      {hint && <p className="run-hint">{hint}</p>}
    </section>
  );
}

function DryRunPanel({ copy, uiLanguage, workspace: w }: SectionProps) {
  const t = copy.translate;
  const estimate = w.dryRun;
  if (!estimate) return null;
  return (
    <section className="panel dry-run-panel" aria-label={t.estimateTitle}>
      <div className="panel-header">
        <h2><Gauge size={16} /> {t.estimateTitle}</h2>
        <span className={estimate.canLikelyFinishToday ? "status-pill ok" : "status-pill warn"}>
          {estimate.canLikelyFinishToday ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
          {estimate.estimatedRequests} {t.requests}
        </span>
      </div>
      <div className="metric-grid">
        <div><strong><AnimatedNumber value={estimate.cueCount} /></strong><span>{t.cues}</span></div>
        <div><strong><AnimatedNumber value={estimate.chunkCount} /></strong><span>{t.chunks.toLocaleLowerCase(uiLanguage)}</span></div>
        <div><strong><AnimatedNumber value={estimate.estimatedInputTokens} /></strong><span>{t.inputTokens}</span></div>
        <div><strong><AnimatedNumber value={estimate.dailyRequestLimit} /></strong><span>{t.dailyLimit}</span></div>
      </div>
      <p className="panel-description">{estimate.canLikelyFinishToday ? t.fitsToday : t.mayExceedToday}</p>
    </section>
  );
}

function ResultNotices({ copy, uiLanguage, workspace: w }: SectionProps) {
  const t = copy.translate;
  return (
    <>
      {w.result && (
        <section className="notice success">
          <CheckCircle2 size={18} />
          <div>
            <strong title={w.result.outputPath}>{fileName(w.result.outputPath)}</strong>
            <span>{w.result.cueCount} {t.cues}, {w.result.chunkCount} {t.chunks.toLocaleLowerCase(uiLanguage)}, {w.result.cacheHits} {t.cacheHits}</span>
          </div>
          <button className="icon-button button-sm" onClick={w.openOutput} title={copy.actions.openOutput} aria-label={copy.actions.openOutput} type="button">
            <ExternalLink size={16} />
          </button>
        </section>
      )}

      {w.exportResult && (
        <section className="notice success">
          <CheckCircle2 size={18} />
          <div>
            <strong>{w.exportResult.length === 1 ? fileName(w.exportResult[0].outputPath) : `${w.exportResult.length} ${t.tracksExported}`}</strong>
            <span>{w.exportResult.map((item) => `${t.exportedTrack} ${item.trackIndex}: ${fileName(item.outputPath)}`).join(", ")}</span>
          </div>
          <button className="icon-button button-sm" onClick={w.openExportedSubtitle} title={copy.actions.openExportedSubtitle} aria-label={copy.actions.openExportedSubtitle} type="button">
            <ExternalLink size={16} />
          </button>
        </section>
      )}
    </>
  );
}

function BatchPanel({ copy, uiLanguage, workspace: w }: SectionProps) {
  const t = copy.translate;
  const doneCount = w.batchItems.filter((item) => item.status === "Done").length;

  return (
    <section className="panel batch-panel">
      <div className="panel-header">
        <div>
          <h2><FolderSearch size={17} /> {t.batch}</h2>
          <p>{t.batchDescription}</p>
        </div>
        {w.batchFolder && (
          <button className="text-button button-sm" onClick={w.chooseBatchFolder} disabled={w.busy} type="button">
            <FolderOpen size={15} />
            {copy.actions.change}
          </button>
        )}
      </div>
      {w.batchFolder ? (
        <div className="path-field" title={w.batchFolder}>
          <FolderOpen size={14} />
          <span className="truncate">{w.batchFolder}</span>
        </div>
      ) : (
        <div className="empty-state compact dropzone">
          <span className="empty-state-icon"><FolderSearch size={22} /></span>
          <strong>{t.noFolder}</strong>
          <span>{t.batchDescription}</span>
          <button className="primary-button" onClick={w.chooseBatchFolder} disabled={w.busy} type="button">
            <FolderOpen size={16} />
            {copy.actions.chooseFolder}
          </button>
        </div>
      )}
      {w.batchItems.length > 0 && (
        <>
          <div className="batch-summary">
            <span>{doneCount}/{w.batchItems.length} {t.done.toLocaleLowerCase(uiLanguage)}</span>
            {w.busy && <Loader2 className="spin" size={14} />}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t.file}</th>
                  <th>{t.track}</th>
                  <th className="numeric">{t.chunks}</th>
                  <th>{t.status}</th>
                </tr>
              </thead>
              <tbody>
                {w.batchItems.map((item) => (
                  <tr key={item.file}>
                    <td className="truncate-cell" title={item.file}>{fileName(item.file)}</td>
                    <td>{item.subtitleTrack || "–"}</td>
                    <td className="numeric">{item.completedChunks}/{item.chunks}</td>
                    <td>
                      <span className={`status-pill ${batchStatusTone(item.status)}`} title={item.lastError}>{item.status}</span>
                      {item.lastError && <small className="batch-error">{item.lastError}</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function batchStatusTone(status: BatchItemProgress["status"]): string {
  if (status === "Done") return "ok";
  if (status === "Failed") return "error";
  if (status === "Waiting") return "";
  return "warn";
}
