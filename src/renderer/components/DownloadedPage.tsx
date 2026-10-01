import {
  AlertCircle,
  CheckCircle2,
  Clapperboard,
  ExternalLink,
  FileVideo2,
  Film,
  FolderOpen,
  HardDrive,
  HardDriveDownload,
  Languages,
  Library,
  Loader2,
  Music2,
  Play,
  Radio,
  RefreshCw,
  Trash2,
  Tv,
  Zap
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildDownloadedWorkflowTarget,
  downloadedEpisodeLabel as episodeLabel,
  type DownloadedLibrarySnapshot,
  type DownloadedLibraryTitle,
  type DownloadedSeriesScope,
  type DownloadedWorkflowTarget
} from "../../core/downloads/DownloadedLibrary";
import type {
  WorkflowProfile
} from "../../main/workflowProfileService";
import { formatBytes, formatError, formatShortDate } from "../format";
import { AppSelect } from "./AppSelect";
import { SlidingIndicator } from "./SlidingIndicator";

interface DownloadedPageProps {
  workflowProfiles: WorkflowProfile[];
  onPrepareWorkflow: (target: DownloadedWorkflowTarget, profile: WorkflowProfile) => Promise<void>;
}

type SeedStatus = "unavailable" | "stopped" | "seeding";

export function DownloadedPage({
  workflowProfiles,
  onPrepareWorkflow
}: DownloadedPageProps) {
  const [library, setLibrary] = useState<DownloadedLibrarySnapshot>();
  const [selectedKey, setSelectedKey] = useState("");
  const [seriesScope, setSeriesScope] = useState<DownloadedSeriesScope>("episode");
  const [selectedSeason, setSelectedSeason] = useState<number | undefined>();
  const [selectedFileId, setSelectedFileId] = useState("");
  const [workflowProfileId, setWorkflowProfileId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState<string>();

  const selectedWorkflowProfile = workflowProfiles.find((profile) => profile.id === workflowProfileId);
  const selectedTitle = library?.titles.find((title) => titleSelectionKey(title) === selectedKey);
  const seasons = useMemo(
    () => selectedTitle?.mediaType === "series"
      ? [...new Set(selectedTitle.files.map((file) => file.season ?? -1))]
        .sort((left, right) => left - right)
      : [],
    [selectedTitle]
  );
  const seasonFiles = useMemo(
    () => selectedTitle?.files.filter((file) => (file.season ?? -1) === selectedSeason) ?? [],
    [selectedSeason, selectedTitle]
  );
  const selectedPlayableFile = selectedTitle?.mediaType === "movie"
    ? selectedTitle.files.find((file) => file.id === selectedFileId) ?? selectedTitle.files[0]
    : seriesScope === "episode"
      ? seasonFiles.find((file) => file.id === selectedFileId)
      : undefined;

  const [seedStatus, setSeedStatus] = useSeedStatus(selectedTitle?.libraryLocationId, selectedPlayableFile?.path);

  const loadLibrary = useCallback(async (rescan: boolean): Promise<void> => {
    setLoading(true);
    setError(undefined);
    try {
      const snapshot = rescan
        ? await window.subtitleTranslator.rescanDownloadedLibrary()
        : await window.subtitleTranslator.getDownloadedLibrary();
      setLibrary(snapshot);
      setSelectedKey((current) =>
        snapshot.titles.some((title) => titleSelectionKey(title) === current)
          ? current
          : snapshot.titles[0] ? titleSelectionKey(snapshot.titles[0]) : ""
      );
    } catch (loadError) {
      setError(formatError(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLibrary(false);
  }, [loadLibrary]);

  useEffect(() => {
    if (!selectedTitle && library?.titles[0]) {
      setSelectedKey(titleSelectionKey(library.titles[0]));
    }
  }, [library, selectedTitle]);

  useEffect(() => {
    if (selectedTitle?.mediaType !== "series") {
      setSelectedSeason(undefined);
      setSelectedFileId(selectedTitle?.files[0]?.id ?? "");
      return;
    }
    const nextSeason = selectedSeason !== undefined && seasons.includes(selectedSeason) ? selectedSeason : seasons[0];
    setSelectedSeason(nextSeason);
    const files = selectedTitle.files.filter((file) => (file.season ?? -1) === nextSeason);
    if (!files.some((file) => file.id === selectedFileId)) {
      setSelectedFileId(files[0]?.id ?? "");
    }
  }, [seasons, selectedFileId, selectedSeason, selectedTitle]);

  useEffect(() => {
    if (!workflowProfiles.some((profile) => profile.id === workflowProfileId)) {
      setWorkflowProfileId(workflowProfiles[0]?.id ?? "");
    }
  }, [workflowProfileId, workflowProfiles]);

  async function findExternalDrives(): Promise<void> {
    setBusyAction("find-drives");
    setError(undefined);
    try {
      await window.subtitleTranslator.scanExternalDownloadLocations();
      await loadLibrary(false);
    } catch (scanError) {
      setError(formatError(scanError));
    } finally {
      setBusyAction("");
    }
  }

  async function prepareWorkflow(): Promise<void> {
    const target = selectedTitle && buildDownloadedWorkflowTarget(selectedTitle, {
      scope: seriesScope,
      season: selectedSeason,
      fileId: selectedFileId
    });
    const profile = selectedWorkflowProfile;
    if (!target || !profile) return;
    if (
      profile.config.media.enabled
      && profile.config.media.outputMode === "replace-original"
      && !window.confirm(`${profile.name} is configured to replace original files. Continue?`)
    ) {
      return;
    }
    setBusyAction("workflow");
    setError(undefined);
    try {
      await onPrepareWorkflow(target, profile);
    } catch (prepareError) {
      setError(formatError(prepareError));
    } finally {
      setBusyAction("");
    }
  }

  async function playSelectedFile(): Promise<void> {
    if (!selectedPlayableFile) {
      return;
    }
    setBusyAction("play");
    setError(undefined);
    try {
      await window.subtitleTranslator.openPath(selectedPlayableFile.path);
    } catch (playError) {
      setError(`Could not open the default media player: ${formatError(playError)}`);
    } finally {
      setBusyAction("");
    }
  }

  async function toggleSeeding(): Promise<void> {
    if (!selectedPlayableFile || !selectedTitle?.libraryLocationId) return;
    setBusyAction("seed");
    setError(undefined);
    try {
      if (seedStatus === "seeding") {
        await window.subtitleTranslator.stopTorrentSeeding();
        setSeedStatus("stopped");
      } else {
        await window.subtitleTranslator.startTorrentSeeding(selectedTitle.libraryLocationId, selectedPlayableFile.path);
        setSeedStatus("seeding");
      }
    } catch (seedError) {
      setError(formatError(seedError));
    } finally {
      setBusyAction("");
    }
  }

  async function deleteSelectedFile(): Promise<void> {
    if (!selectedTitle || !selectedPlayableFile || !selectedTitle.libraryLocationId) {
      return;
    }
    if (!window.confirm(`Move ${selectedPlayableFile.filename} to the Recycle Bin?`)) {
      return;
    }
    setBusyAction("delete");
    setError(undefined);
    try {
      const snapshot = await window.subtitleTranslator.deleteDownloadedFile({
        libraryLocationId: selectedTitle.libraryLocationId,
        titleKey: selectedTitle.key,
        fileId: selectedPlayableFile.id
      });
      setLibrary(snapshot);
      setSelectedFileId("");
      if (!snapshot.titles.some((title) => titleSelectionKey(title) === selectedKey)) {
        setSelectedKey(snapshot.titles[0] ? titleSelectionKey(snapshot.titles[0]) : "");
      }
    } catch (deleteError) {
      setError(`Could not delete the downloaded file: ${formatError(deleteError)}`);
    } finally {
      setBusyAction("");
    }
  }

  if (loading && !library) {
    return (
      <section className="downloaded-page downloaded-loading" aria-label="Downloaded">
        <Loader2 className="spin" size={24} />
        <span>Indexing downloaded media…</span>
      </section>
    );
  }

  const libraryRoot = library?.locations?.find((location) => location.isDefault && location.isAvailable)?.path
    ?? library?.rootDirectory;
  const titleCount = library?.titles.length ?? 0;

  return (
    <section className="page downloaded-page" aria-label="Downloaded">
      <header className="page-header">
        <div className="page-title">
          <h2>Downloaded</h2>
          <p>
            {titleCount > 0
              ? `${titleCount} title${titleCount === 1 ? "" : "s"} in your library. Play them or prepare a workflow.`
              : "Movies and episodes you download appear here."}
          </p>
        </div>
        <div className="page-actions">
          <button
            className="text-button"
            onClick={() => libraryRoot && window.subtitleTranslator.showItemInFolder(libraryRoot)}
            disabled={!libraryRoot}
            type="button"
          >
            <FolderOpen size={16} /> Open library
          </button>
          <button
            className="text-button"
            onClick={findExternalDrives}
            disabled={busyAction === "find-drives"}
            type="button"
          >
            {busyAction === "find-drives" ? <Loader2 className="spin" size={16} /> : <HardDriveDownload size={16} />}
            Find drives
          </button>
          <button className="text-button" onClick={() => loadLibrary(true)} disabled={loading} type="button">
            {loading ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
            Rescan
          </button>
        </div>
      </header>

      {error && (
        <div className="notice error" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {Boolean(library?.locations?.length) && (
        <div className="chip-row downloaded-location-strip" aria-label="Download library locations">
          {library!.locations!.map((location) => (
            <span className={`chip${location.isAvailable ? "" : " muted-chip"}`} key={location.id}>
              <HardDrive size={13} />
              <span>
                {location.label}
                {location.isDefault ? " · default" : ""}
                {location.isAvailable ? "" : " · not connected"}
              </span>
            </span>
          ))}
        </div>
      )}

      {!library?.titles.length ? (
        <section className="panel downloaded-empty">
          <div className="empty-state">
            <span className="empty-state-icon"><Library size={22} /></span>
            <h3>No downloaded titles yet</h3>
            <p>Download a movie or episode from Discover, or place existing files in the managed Movies and TV Shows folders and press Rescan.</p>
            {library?.rootDirectory && <code className="path-chip">{library.rootDirectory}</code>}
          </div>
        </section>
      ) : (
        <div className="downloaded-layout">
          <section className="downloaded-collection" aria-label="Library">
            <div className="downloaded-title-grid">
              {library.titles.map((title) => {
                const selected = titleSelectionKey(title) === selectedKey;
                return (
                  <button
                    aria-pressed={selected}
                    className={`downloaded-title-card${selected ? " active" : ""}`}
                    key={titleSelectionKey(title)}
                    onClick={() => setSelectedKey(titleSelectionKey(title))}
                    type="button"
                  >
                    <span className="downloaded-poster-frame"><Poster title={title} /></span>
                    <span className="downloaded-title-info">
                      <strong>{title.title}</strong>
                      <small>
                        {title.mediaType === "movie" ? <Film size={12} /> : <Tv size={12} />}
                        {title.mediaType === "movie" ? "Movie" : "TV show"} · {title.files.length} file{title.files.length === 1 ? "" : "s"}
                      </small>
                      {title.libraryLocationLabel && <small><HardDrive size={12} /> {title.libraryLocationLabel}</small>}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {selectedTitle && (
            <aside className="panel downloaded-detail">
              <div className="downloaded-detail-heading">
                <Poster title={selectedTitle} />
                <div>
                  <span className="eyebrow">
                    {selectedTitle.mediaType === "movie" ? <Film size={13} /> : <Tv size={13} />}
                    {selectedTitle.mediaType === "movie" ? "Movie" : "TV show"}
                  </span>
                  <h3>{selectedTitle.title}</h3>
                  <p>{selectedTitle.overview || `${selectedTitle.files.length} managed download(s)`}</p>
                  <small>
                    {formatBytes(selectedTitle.totalBytes)} · downloaded {formatShortDate(selectedTitle.downloadedAt)}
                    {selectedTitle.libraryLocationLabel ? ` · ${selectedTitle.libraryLocationLabel}` : ""}
                  </small>
                  <button className="link-button downloaded-folder-link" onClick={() => window.subtitleTranslator.showItemInFolder(selectedTitle.directoryPath)} type="button">
                    <ExternalLink size={13} /> Show title folder
                  </button>
                </div>
              </div>

              {selectedTitle.mediaType === "series" && (
                <div className="downloaded-scope">
                  <div className="segmented-control" role="group" aria-label="Processing scope">
                    <SlidingIndicator />
                    <button className={seriesScope === "episode" ? "active" : ""} onClick={() => setSeriesScope("episode")} type="button">
                      Episode
                    </button>
                    <button className={seriesScope === "season" ? "active" : ""} onClick={() => setSeriesScope("season")} type="button">
                      Entire season
                    </button>
                  </div>
                  <AppSelect
                    ariaLabel="Season"
                    value={selectedSeason === undefined ? "" : String(selectedSeason)}
                    options={seasons.map((season) => ({
                      value: String(season),
                      label: season === -1 ? "Unsorted" : `Season ${season}`
                    }))}
                    onChange={(value) => setSelectedSeason(Number(value))}
                  />
                </div>
              )}

              <div className="downloaded-files" aria-label="Downloaded files">
                {(selectedTitle.mediaType === "series" ? seasonFiles : selectedTitle.files).map((file) => {
                  const inSeason = selectedTitle.mediaType === "series" && seriesScope === "season";
                  const selected = inSeason || file.id === selectedFileId;
                  return (
                    <button
                      aria-pressed={file.id === selectedFileId}
                      className={selected ? "active" : ""}
                      key={file.id}
                      onClick={() => setSelectedFileId(file.id)}
                      disabled={inSeason}
                      type="button"
                    >
                      <FileVideo2 size={16} />
                      <span>
                        <strong>{selectedTitle.mediaType === "series" ? episodeLabel(file) : file.filename}</strong>
                        <small>{formatBytes(file.sizeBytes)}</small>
                      </span>
                      {selected && <CheckCircle2 size={16} />}
                    </button>
                  );
                })}
              </div>

              <div className="downloaded-play-actions">
                <button
                  className="primary-button"
                  onClick={playSelectedFile}
                  disabled={!selectedPlayableFile || Boolean(busyAction)}
                  title={selectedPlayableFile ? `Open ${selectedPlayableFile.filename} with the default media player` : "Select one episode to play"}
                  type="button"
                >
                  {busyAction === "play" ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
                  Play selected
                </button>
                {seedStatus !== "unavailable" && (
                  <button className={`text-button${seedStatus === "seeding" ? " seeding" : ""}`} onClick={toggleSeeding} disabled={Boolean(busyAction)}
                    title={seedStatus === "seeding" ? "Stop sharing this torrent" : "Verify the downloaded files, then share this torrent with peers"}
                    type="button">
                    {busyAction === "seed" ? <Loader2 className="spin" size={16} /> : <Radio size={16} />}
                    {seedStatus === "seeding" ? "Stop seeding" : "Seed torrent"}
                  </button>
                )}
                <button
                  aria-label="Delete selected"
                  className="icon-button danger-button downloaded-delete-button"
                  onClick={deleteSelectedFile}
                  disabled={!selectedPlayableFile || !selectedTitle.libraryLocationId || Boolean(busyAction)}
                  title={selectedPlayableFile ? `Move ${selectedPlayableFile.filename} to the Recycle Bin` : "Select one episode to delete"}
                  type="button"
                >
                  {busyAction === "delete" ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
                </button>
              </div>

              <section className="downloaded-unified-profile">
                <div className="downloaded-profile-heading">
                  <Zap size={16} />
                  <div>
                    <strong>Run a workflow</strong>
                    <p>
                      Applies one saved workflow to the selected {seriesScope === "season" && selectedTitle.mediaType === "series" ? "season" : "file"}.
                      Only the enabled parts run.
                    </p>
                  </div>
                </div>
                <AppSelect
                  ariaLabel="Profile"
                  value={workflowProfileId}
                  options={workflowProfiles.map((profile) => ({
                    value: profile.id,
                    label: profile.name
                  }))}
                  onChange={setWorkflowProfileId}
                  disabled={workflowProfiles.length === 0}
                  placeholder="No saved workflow profiles"
                />
                {selectedWorkflowProfile && (
                  <div className="chip-row downloaded-workflow-parts" aria-label="Enabled workflow parts">
                    <span className={`chip${selectedWorkflowProfile.config.translation.enabled ? " success" : " muted-chip"}`}>
                      <Languages size={13} /> Translation
                    </span>
                    <span className={`chip${selectedWorkflowProfile.config.media.enabled && selectedWorkflowProfile.config.media.audioEnabled ? " success" : " muted-chip"}`}>
                      <Music2 size={13} /> Audio
                    </span>
                    <span className={`chip${selectedWorkflowProfile.config.media.enabled ? " success" : " muted-chip"}`}>
                      <Clapperboard size={13} /> Media output
                    </span>
                  </div>
                )}
                <button
                  className="text-button"
                  onClick={prepareWorkflow}
                  disabled={!workflowProfileId || Boolean(busyAction)}
                  type="button"
                >
                  {busyAction === "workflow"
                    ? <Loader2 className="spin" size={16} />
                    : selectedWorkflowProfile?.config.media.enabled
                      ? <Clapperboard size={16} />
                      : <Languages size={16} />}
                  {selectedWorkflowProfile?.config.media.enabled ? "Prepare workflow in Media" : "Prepare translation"}
                </button>
              </section>
            </aside>
          )}
        </div>
      )}
    </section>
  );
}

function titleSelectionKey(title: DownloadedLibraryTitle): string {
  return `${title.libraryLocationId ?? "default"}:${title.key}`;
}

function Poster({ title }: { title: DownloadedLibraryTitle }) {
  const [loadedPath, setLoadedPath] = useState<string>();
  return title.posterPath
    ? (
      <img
        className="downloaded-poster"
        data-loaded={loadedPath === title.posterPath}
        src={title.posterPath}
        alt=""
        onLoad={() => setLoadedPath(title.posterPath)}
      />
    )
    : <span className="downloaded-poster downloaded-poster-fallback">{title.mediaType === "movie" ? <Film /> : <Tv />}</span>;
}

/** Seeding state of the selected file; polled while seeding so the button reflects reality. */
function useSeedStatus(locationId: string | undefined, filePath: string | undefined) {
  const [status, setStatus] = useState<SeedStatus>("unavailable");
  const seeding = status === "seeding";

  useEffect(() => {
    if (!locationId || !filePath) {
      setStatus("unavailable");
      return;
    }
    return watchSeedStatus(locationId, filePath, setStatus);
  }, [filePath, locationId]);

  useEffect(() => {
    if (!seeding || !locationId || !filePath) return;
    return watchSeedStatus(locationId, filePath, setStatus, 3000);
  }, [filePath, locationId, seeding]);

  return [status, setStatus] as const;
}

/** Fetches the seed status once, or every `intervalMs`; the returned cleanup drops late replies. */
function watchSeedStatus(
  locationId: string,
  filePath: string,
  onStatus: (status: SeedStatus) => void,
  intervalMs?: number
): () => void {
  let cancelled = false;
  const refresh = () => window.subtitleTranslator.getTorrentSeedStatus(locationId, filePath).then(
    (next) => { if (!cancelled) onStatus(next); },
    () => { if (!cancelled) onStatus("unavailable"); }
  );
  if (!intervalMs) void refresh();
  const timer = intervalMs ? window.setInterval(() => void refresh(), intervalMs) : undefined;
  return () => {
    cancelled = true;
    window.clearInterval(timer);
  };
}
