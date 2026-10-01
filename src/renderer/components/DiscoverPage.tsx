import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Bookmark, CheckCircle2, Compass, Eye, Loader2, RefreshCw, Search, Settings, SlidersHorizontal, ThumbsUp, X } from "lucide-react";
import type {
  CatalogDetails,
  CatalogItem,
  DiscoveryAction,
  DiscoveryCredentialStatus,
  DiscoveryHome,
  DiscoveryPreferences,
  DiscoveryState,
  OtherDebridProvider,
  RealDebridConnectionStatus,
  SourceSearchResult,
  StreamingServiceId,
  TorrentClientStatus,
  TorrentSource
} from "../../core/discovery/DiscoveryTypes";
import { catalogItemKey } from "../../core/discovery/DiscoveryTypes";
import { sortTorrentSources } from "../../core/discovery/TorrentSourceSorting";
import { countDiscoveryFilters, DEFAULT_DISCOVERY_FILTERS, filterCatalogItems, STREAMING_SERVICES, type DiscoveryCatalogFilters } from "../../core/discovery/DiscoveryFilters";
import { resumeEpisodeSelection } from "../../core/discovery/EpisodeProgress";
import type { UiLanguage } from "../uiLanguage";
import { discoverCopy, localizeDiscoveryCatalogText } from "./discovery/discoveryCopy";
import { debridProviderName } from "./discovery/discoveryFormatting";
import { formatError } from "../format";
import { copyDiscoveryFilters, isStaleRealDebridCacheError, realDebridSourceKey } from "./discovery/discoverUtils";
import { DiscoveryFilterPanel } from "./discovery/DiscoveryFilterPanel";
import { DiscoverySettings } from "./discovery/DiscoverySettings";
import { CatalogSection } from "./discovery/CatalogSection";
import { CatalogSkeleton } from "./discovery/CatalogPrimitives";
import { DetailsHeader } from "./discovery/DetailsHeader";
import { DiscoverSearchBar } from "./discovery/DiscoverSearchBar";
import { DiscoverViewTabs, type CatalogView } from "./discovery/DiscoverViewTabs";
import { EpisodePicker } from "./discovery/EpisodePicker";
import { SourcePanel, type DownloadMethod } from "./discovery/SourcePanel";
import { TitleDetailsDrawer } from "./discovery/TitleDetailsDrawer";
import { useDownloadLocations } from "./discovery/useDownloadLocations";
import { useExternalRatings } from "./discovery/useExternalRatings";
import { useStreamingCatalogue } from "./discovery/useStreamingCatalogue";
import { useInteractionCollections } from "./discovery/useInteractionCollections";
import { useDiscoverySearch } from "./discovery/useDiscoverySearch";
import { useStableCallback } from "../useEffectEvent";

type SettingsReturnTarget = "settings-trigger" | "find-sources" | "real-debrid-method";

interface DiscoverPageProps {
  uiLanguage?: UiLanguage;
}

export function DiscoverPage({ uiLanguage = "en" }: DiscoverPageProps) {
  const ui = discoverCopy[uiLanguage];
  const [state, setState] = useState<DiscoveryState>();
  const [credentialStatus, setCredentialStatus] = useState<DiscoveryCredentialStatus>();
  const [realDebridStatus, setRealDebridStatus] = useState<RealDebridConnectionStatus>();
  const [torrentClientStatus, setTorrentClientStatus] = useState<TorrentClientStatus>();
  const [home, setHome] = useState<DiscoveryHome>();
  const [catalogView, setCatalogView] = useState<CatalogView>("browse");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState<DiscoveryCatalogFilters>(DEFAULT_DISCOVERY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<DiscoveryCatalogFilters>(DEFAULT_DISCOVERY_FILTERS);
  const [streamingAvailability, setStreamingAvailability] = useState(
    () => new Map<string, ReadonlySet<StreamingServiceId>>()
  );
  const [loadingStreamingAvailability, setLoadingStreamingAvailability] = useState(false);
  const [selectedItem, setSelectedItem] = useState<CatalogItem>();
  const [details, setDetails] = useState<CatalogDetails>();
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState<number | undefined>(1);
  const [selectedEpisodes, setSelectedEpisodes] = useState<number[] | undefined>();
  const [sourceResult, setSourceResult] = useState<SourceSearchResult>();
  const [verifiedSources, setVerifiedSources] = useState<TorrentSource[]>([]);
  const staleRealDebridSourceKeysRef = useRef(new Set<string>());
  const [downloadMethod, setDownloadMethod] = useState<DownloadMethod>("torrent");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftPreferences, setDraftPreferences] = useState<DiscoveryPreferences>();
  const [realDebridToken, setRealDebridToken] = useState("");
  const [otherDebridTokens, setOtherDebridTokens] = useState<Record<string, string>>({});
  const [mdblistApiKey, setMdblistApiKey] = useState("");
  const [loadingHome, setLoadingHome] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [loadingSources, setLoadingSources] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const selectedDebridProvider = state?.preferences.debridProvider ?? "real-debrid";
  const selectedDebridName = debridProviderName(selectedDebridProvider);
  const hasSelectedDebridToken = selectedDebridProvider === "real-debrid"
    ? credentialStatus?.hasRealDebridToken
    : credentialStatus?.hasDebridTokens?.[selectedDebridProvider];
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const filtersTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsBackRef = useRef<HTMLButtonElement>(null);
  const findSourcesRef = useRef<HTMLButtonElement>(null);
  const realDebridMethodRef = useRef<HTMLButtonElement>(null);
  const detailsPanelRef = useRef<HTMLElement>(null);
  const detailsRequestIdRef = useRef(0);
  const sourceRequestIdRef = useRef(0);
  const homeRequestIdRef = useRef(0);
  const selectedItemTriggerRef = useRef<HTMLButtonElement | null>(null);
  const catalogScrollYRef = useRef(0);
  const settingsReturnTargetRef = useRef<SettingsReturnTarget>("settings-trigger");
  const previousSettingsOpenRef = useRef(settingsOpen);

  const locations = useDownloadLocations({ onError: setError, onNotice: setNotice });
  const search = useDiscoverySearch({
    onSearchStart: () => {
      setCatalogView("browse");
      setError(undefined);
      setNotice(undefined);
    },
    onError: setError
  });
  const searchResults = search.results;
  const loadingCatalog = loadingHome || search.loading;
  const catalogue = useStreamingCatalogue({ onError: setError, onNotice: setNotice });

  const interactionMap = useMemo(
    () => new Map((state?.interactions ?? []).map((interaction) => [interaction.key, interaction])),
    [state?.interactions]
  );
  const { all: collectionItems, filtered: filteredCollections } = useInteractionCollections(
    state?.interactions,
    appliedFilters,
    streamingAvailability
  );
  const catalogItems = useMemo(() => uniqueCatalogItems([
    ...(searchResults ?? home?.sections.flatMap((section) => section.items) ?? []),
    ...collectionItems.liked,
    ...collectionItems.favourites,
    ...collectionItems.watched,
    ...catalogue.items
  ]), [catalogue.items, collectionItems, home, searchResults]);
  const { ratings: externalRatings, ratingsError, loadRatings, resetRatings } = useExternalRatings(
    Boolean(credentialStatus?.hasMdblistApiKey),
    catalogItems
  );
  const activeFilterCount = countDiscoveryFilters(appliedFilters);
  const filteredSearchResults = useMemo(
    () => searchResults
      ? filterCatalogItems(searchResults, appliedFilters, streamingAvailability)
      : undefined,
    [appliedFilters, searchResults, streamingAvailability]
  );
  const filteredHomeSectionsWithEmpty = useMemo(
    () => home?.sections
      .map((section) => ({
        ...section,
        items: filterCatalogItems(section.items, appliedFilters, streamingAvailability)
      })) ?? [],
    [appliedFilters, home, streamingAvailability]
  );
  const filteredHomeSections = useMemo(
    () => filteredHomeSectionsWithEmpty.filter((section) => section.items.length > 0),
    [filteredHomeSectionsWithEmpty]
  );
  const streamingFilterActive = appliedFilters.streamingServices.length > 0;
  const serviceRecommendationSections = useMemo(
    () => ["recommended-movies", "recommended-series"].flatMap((id) => {
      const section = filteredHomeSectionsWithEmpty.find((candidate) => candidate.id === id);
      return section ? [section] : [];
    }),
    [filteredHomeSectionsWithEmpty]
  );
  const serviceCataloguePreviewItems = useMemo(() => {
    const sections = filteredHomeSectionsWithEmpty.filter(
      (section) => section.id !== "recommended-movies" && section.id !== "recommended-series"
    );
    const candidates = sections.length > 0
      ? sections.flatMap((section) => section.items)
      : filteredHomeSectionsWithEmpty.flatMap((section) => section.items);
    return uniqueCatalogItems(candidates).slice(0, 30);
  }, [filteredHomeSectionsWithEmpty]);
  const selectedServiceLabels = streamingServiceLabels(appliedFilters.streamingServices);
  const visibleTitleCount = catalogue.open
    ? catalogue.items.length
    : catalogView !== "browse"
      ? filteredCollections[catalogView].length
      : filteredSearchResults?.length
        ?? new Set(filteredHomeSections.flatMap((section) => section.items.map(catalogItemKey))).size;

  const loadHome = useCallback(async (): Promise<void> => {
    const requestId = ++homeRequestIdRef.current;
    setLoadingHome(true);
    setError(undefined);
    try {
      const loaded = await window.subtitleTranslator.getDiscoveryHome();
      if (requestId === homeRequestIdRef.current) setHome(loaded);
    } catch (homeError) {
      if (requestId === homeRequestIdRef.current) setError(formatError(homeError));
    } finally {
      if (requestId === homeRequestIdRef.current) setLoadingHome(false);
    }
  }, []);

  const invalidateSourceRequests = useCallback((): void => {
    sourceRequestIdRef.current++;
    setLoadingSources(false);
  }, []);

  const closeDetails = useCallback((): void => {
    detailsRequestIdRef.current += 1;
    setSelectedItem(undefined);
    setDetails(undefined);
    invalidateSourceRequests();
    setSourceResult(undefined);
    window.requestAnimationFrame(() => {
      const returnTarget = selectedItemTriggerRef.current;
      if (returnTarget?.isConnected) {
        returnTarget.focus({ preventScroll: true });
      } else {
        settingsTriggerRef.current?.focus({ preventScroll: true });
      }
    });
  }, [invalidateSourceRequests]);

  const { acceptDownloadLocations } = locations;
  useEffect(() => {
    let active = true;
    const requestIds = [homeRequestIdRef, detailsRequestIdRef, sourceRequestIdRef];
    // The main process reads the preferences itself, so the catalog need not wait for them.
    void loadHome();
    void Promise.all([
      window.subtitleTranslator.getDiscoveryState(),
      window.subtitleTranslator.getDiscoveryCredentialStatus(),
      window.subtitleTranslator.getTorrentClientStatus(),
      window.subtitleTranslator.getDownloadLocations()
    ]).then(([loadedState, credentials, torrentStatus, downloadLocations]) => {
      if (!active) {
        return;
      }
      setState(loadedState);
      setDraftPreferences(loadedState.preferences);
      setCredentialStatus(credentials);
      setTorrentClientStatus(torrentStatus);
      acceptDownloadLocations(downloadLocations);
      if (credentials.hasRealDebridToken) {
        // A network call of up to 15s that only the settings page shows, so it runs in the background.
        void window.subtitleTranslator.getRealDebridStatus().then((status) => {
          if (active) setRealDebridStatus(status);
        }, () => undefined);
      }
    }).catch((initialError) => {
      if (active) {
        setError(formatError(initialError));
      }
    });
    return () => {
      active = false;
      requestIds.forEach((requestId) => {
        requestId.current++;
      });
    };
  }, [acceptDownloadLocations, loadHome]);

  useEffect(() => {
    if (previousSettingsOpenRef.current === settingsOpen) {
      return;
    }
    previousSettingsOpenRef.current = settingsOpen;
    const frame = window.requestAnimationFrame(() => {
      if (settingsOpen) {
        window.scrollTo({ top: 0, behavior: "auto" });
        settingsBackRef.current?.focus({ preventScroll: true });
        return;
      }

      window.scrollTo({ top: catalogScrollYRef.current, behavior: "auto" });
      const returnTarget = settingsReturnTargetRef.current === "find-sources"
        ? findSourcesRef.current
        : settingsReturnTargetRef.current === "real-debrid-method"
          ? realDebridMethodRef.current
          : settingsTriggerRef.current;
      (returnTarget ?? settingsTriggerRef.current)?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [settingsOpen]);

  useEffect(() => {
    if (!selectedItem || settingsOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      closeDetails();
    };
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [closeDetails, selectedItem, settingsOpen]);

  function openFilters(): void {
    setDraftFilters(copyDiscoveryFilters(appliedFilters));
    setFiltersOpen(true);
  }

  function closeFilters(): void {
    setFiltersOpen(false);
    window.requestAnimationFrame(() => filtersTriggerRef.current?.focus({ preventScroll: true }));
  }

  async function applyFilters(): Promise<void> {
    setError(undefined);
    setNotice(undefined);
    if (draftFilters.streamingServices.length > 0 && catalogItems.length > 0) {
      setLoadingStreamingAvailability(true);
      try {
        const result = await window.subtitleTranslator.getDiscoveryStreamingAvailability(
          catalogItems.map(({ id, mediaType }) => ({ id, mediaType }))
        );
        if (result.checkedItems > 0 && result.failedItems === result.checkedItems && result.entries.length === 0) {
          setError("Streaming availability could not be checked. Try applying the filters again.");
          return;
        }
        setStreamingAvailability(new Map(
          result.entries.map((entry) => [entry.key, new Set(entry.services)])
        ));
        if (result.failedItems > 0) {
          setNotice(`Streaming availability was checked for ${result.checkedItems - result.failedItems} of ${result.checkedItems} titles.`);
        }
      } catch (availabilityError) {
        setError(formatError(availabilityError));
        return;
      } finally {
        setLoadingStreamingAvailability(false);
      }
    }

    setAppliedFilters(copyDiscoveryFilters(draftFilters));
    if (draftFilters.streamingServices.length > 0) {
      search.clearResults();
      setCatalogView("browse");
    }
    closeFilters();
  }

  function clearFilters(): void {
    setDraftFilters(DEFAULT_DISCOVERY_FILTERS);
    setAppliedFilters(DEFAULT_DISCOVERY_FILTERS);
    setFiltersOpen(false);
    setError(undefined);
    setNotice(undefined);
    window.requestAnimationFrame(() => filtersTriggerRef.current?.focus({ preventScroll: true }));
  }

  function openStreamingCatalogue(): void {
    setFiltersOpen(false);
    void catalogue.openCatalogue(appliedFilters.streamingServices);
  }

  async function selectItem(item: CatalogItem, trigger: HTMLButtonElement): Promise<void> {
    const requestId = ++detailsRequestIdRef.current;
    selectedItemTriggerRef.current = trigger;
    setSelectedItem(item);
    setDetails(undefined);
    invalidateSourceRequests();
    setSourceResult(undefined);
    setVerifiedSources([]);
    setDownloadMethod("torrent");
    setLoadingDetails(true);
    setError(undefined);
    if (credentialStatus?.hasMdblistApiKey) {
      void loadRatings([item]);
    }
    window.requestAnimationFrame(() => {
      detailsPanelRef.current?.focus({ preventScroll: true });
    });
    try {
      const loaded = await window.subtitleTranslator.getDiscoveryDetails(item.mediaType, item.id);
      if (requestId !== detailsRequestIdRef.current) {
        return;
      }
      setDetails(loaded);
      let initialSeason: number | undefined;
      let initialEpisode: number | undefined;
      if (loaded.mediaType === "series") {
        const resumeAt = resumeEpisodeSelection(loaded, interactionMap.get(catalogItemKey(loaded)));
        initialSeason = resumeAt?.season ?? 1;
        initialEpisode = resumeAt?.episode ?? 1;
        setSeason(initialSeason);
        setEpisode(initialEpisode);
        setSelectedEpisodes(undefined);
      }
      if (loaded.imdbId) {
        void findInitialTorrentSources(loaded, initialSeason, initialEpisode, requestId);
      }
    } catch (detailsError) {
      if (requestId === detailsRequestIdRef.current) {
        setError(formatError(detailsError));
      }
    } finally {
      if (requestId === detailsRequestIdRef.current) {
        setLoadingDetails(false);
      }
    }
  }

  async function findInitialTorrentSources(
    media: CatalogDetails,
    initialSeason: number | undefined,
    initialEpisode: number | undefined,
    requestId: number
  ): Promise<void> {
    const sourceRequestId = ++sourceRequestIdRef.current;
    const isCurrent = () =>
      requestId === detailsRequestIdRef.current && sourceRequestId === sourceRequestIdRef.current;
    setLoadingSources(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const found = await window.subtitleTranslator.searchTorrentSources({
        media,
        season: initialSeason,
        episode: initialEpisode
      });
      if (isCurrent()) {
        setSourceResult(found);
      }
    } catch (sourceError) {
      if (isCurrent()) {
        setError(formatError(sourceError));
      }
    } finally {
      if (isCurrent()) {
        setLoadingSources(false);
      }
    }
  }

  function replaceInteraction(saved: DiscoveryState["interactions"][number]): void {
    setState((existing) => existing
      ? {
        ...existing,
        interactions: [saved, ...existing.interactions.filter((entry) => entry.key !== saved.key)]
      }
      : existing);
  }

  async function setInteraction(item: CatalogItem, action: DiscoveryAction): Promise<void> {
    const key = catalogItemKey(item);
    const current = interactionMap.get(key);
    const active = !(current?.[action] ?? false);
    setBusyAction(`${key}:${action}`);
    setError(undefined);
    try {
      replaceInteraction(await window.subtitleTranslator.setDiscoveryInteraction(item, action, active));
      await loadHome();
      if (action === "hidden" && active) {
        closeDetails();
      }
    } catch (interactionError) {
      setError(formatError(interactionError));
    } finally {
      setBusyAction("");
    }
  }

  async function toggleSelectedEpisodeWatched(): Promise<void> {
    if (!details || details.mediaType !== "series" || episode === undefined) {
      return;
    }
    const interaction = interactionMap.get(catalogItemKey(details));
    const episodeId = `s${season}e${episode}`;
    const isWatched = interaction?.watchedManually === true
      || interaction?.watchedEpisodes?.includes(episodeId) === true;
    setBusyAction(`${catalogItemKey(details)}:${episodeId}:watched`);
    setError(undefined);
    setNotice(undefined);
    try {
      replaceInteraction(await window.subtitleTranslator.setDiscoveryEpisodeWatched(
        details,
        season,
        episode,
        !isWatched
      ));
      setNotice(
        isWatched
          ? `Season ${season}, episode ${episode} marked unwatched.`
          : `Season ${season}, episode ${episode} marked watched.`
      );
      await loadHome();
    } catch (episodeError) {
      setError(formatError(episodeError));
    } finally {
      setBusyAction("");
    }
  }

  function resetSources(): void {
    invalidateSourceRequests();
    setSourceResult(undefined);
    setVerifiedSources([]);
  }

  function changeSeason(nextSeason: number): void {
    if (!details) return;
    const nextEpisodeCount = details.seasons.find((item) => item.seasonNumber === nextSeason)?.episodeCount ?? 0;
    setSelectedEpisodes(undefined);
    setSeason(nextSeason);
    setEpisode(nextEpisodeCount > 0 ? 1 : undefined);
    resetSources();
  }

  function changeEpisodeSelection(value: string): void {
    if (value === "season") {
      setSelectedEpisodes(undefined);
      setEpisode(undefined);
    } else {
      const number = Number(value);
      const current = selectedEpisodes ?? (episode === undefined ? [] : [episode]);
      const next = (current.includes(number) ? current.filter((item) => item !== number) : [...current, number]).sort((a, b) => a - b);
      setSelectedEpisodes(next.length === 1 ? undefined : next);
      setEpisode(next.length === 1 ? next[0] : undefined);
    }
    resetSources();
  }

  async function findSources(method: DownloadMethod = downloadMethod): Promise<void> {
    if (!details || !state || selectedEpisodes?.length === 0) {
      return;
    }
    setError(undefined);
    setNotice(undefined);
    resetSources();
    const requestId = sourceRequestIdRef.current;
    setLoadingSources(true);
    try {
      const found = await window.subtitleTranslator.searchTorrentSources({
        media: details,
        season: details.mediaType === "series" ? season : undefined,
        episode: details.mediaType === "series" ? episode : undefined,
        ...(method === "torrent" && selectedEpisodes !== undefined ? { episodes: selectedEpisodes } : {})
      });
      if (requestId !== sourceRequestIdRef.current) return;
      setSourceResult(found);
      if (method === "real-debrid") {
        await verifyRealDebrid(found.sources, "find-sources", requestId);
      }
    } catch (sourceError) {
      if (requestId === sourceRequestIdRef.current) setError(formatError(sourceError));
    } finally {
      if (requestId === sourceRequestIdRef.current) setLoadingSources(false);
    }
  }

  async function verifyRealDebrid(
    sources: TorrentSource[],
    returnTarget: SettingsReturnTarget,
    requestId: number
  ): Promise<void> {
    if (!details) {
      return;
    }
    if (!hasSelectedDebridToken) {
      openSettings(returnTarget);
      setError(`Connect ${selectedDebridName} in Discovery settings first.`);
      return;
    }
    setLoadingSources(true);
    setError(undefined);
    try {
      const verified = await window.subtitleTranslator.getVerifiedRealDebridSources({
        sources,
        media: details,
        season: details.mediaType === "series" ? season : undefined,
        episode: details.mediaType === "series" ? episode : undefined
      });
      if (requestId !== sourceRequestIdRef.current) return;
      const usable = verified.filter((source) =>
        !staleRealDebridSourceKeysRef.current.has(realDebridSourceKey(source))
      );
      setVerifiedSources(usable);
      if (usable.length === 0) {
        setNotice("No cached sources were found in the selected debrid service.");
      }
    } catch (verificationError) {
      if (requestId === sourceRequestIdRef.current) setError(formatError(verificationError));
    } finally {
      if (requestId === sourceRequestIdRef.current) setLoadingSources(false);
    }
  }

  async function switchDownloadMethod(method: DownloadMethod): Promise<void> {
    invalidateSourceRequests();
    setDownloadMethod(method);
    if (selectedEpisodes !== undefined) {
      resetSources();
    }
    setNotice(undefined);
    if (method === "real-debrid") {
      if (!hasSelectedDebridToken) {
        openSettings("real-debrid-method");
        setError(`Connect ${selectedDebridName} in Discovery settings first.`);
        return;
      }
      await findSources("real-debrid");
    }
  }

  async function openTorrent(source: TorrentSource): Promise<void> {
    setBusyAction(`torrent:${source.id}`);
    setError(undefined);
    try {
      const opened = await window.subtitleTranslator.openTorrentSource(source);
      if (opened) {
        setNotice(`Opened ${torrentClientStatus?.applicationName ?? "your default torrent application"}.`);
      }
    } catch (openError) {
      setError(formatError(openError));
    } finally {
      setBusyAction("");
    }
  }

  async function refreshAfterDownload(outputPath: string): Promise<void> {
    const refreshedState = await window.subtitleTranslator.getDiscoveryState().catch(() => undefined);
    if (refreshedState) setState(refreshedState);
    await loadHome();
    setNotice(`Download completed: ${outputPath}`);
  }

  function downloadRequest(source: TorrentSource, media: CatalogDetails) {
    const destination = locations.selectedLocation;
    if (!destination) {
      throw new Error("Choose an available download destination. You can reconnect external drives from Settings.");
    }
    return {
      source,
      media,
      season: media.mediaType === "series" ? season : undefined,
      episode: media.mediaType === "series" ? episode : undefined,
      episodes: media.mediaType === "series" ? selectedEpisodes : undefined,
      destinationLocationId: destination.id
    };
  }

  async function downloadFromTorrent(source: TorrentSource): Promise<void> {
    if (!details) return;
    setBusyAction(`torrent:${source.id}`);
    setError(undefined);
    setNotice(undefined);
    try {
      const outputPath = await window.subtitleTranslator.startTorrentDownload(downloadRequest(source, details));
      await refreshAfterDownload(outputPath);
    } catch (downloadError) {
      setError(formatError(downloadError));
    } finally {
      setBusyAction("");
    }
  }

  async function downloadFromRealDebrid(source: TorrentSource): Promise<void> {
    if (!details) {
      return;
    }
    setBusyAction(`real-debrid:${source.id}`);
    setError(undefined);
    setNotice(undefined);
    try {
      const outputPath = await window.subtitleTranslator.startRealDebridDownload(downloadRequest(source, details));
      if (outputPath) {
        await refreshAfterDownload(outputPath);
      }
    } catch (downloadError) {
      const message = formatError(downloadError);
      if (isStaleRealDebridCacheError(message)) {
        staleRealDebridSourceKeysRef.current.add(realDebridSourceKey(source));
        setVerifiedSources((current) =>
          current.filter((candidate) => realDebridSourceKey(candidate) !== realDebridSourceKey(source))
        );
        setNotice(`That source is no longer cached by ${selectedDebridName}, so it was removed. Choose another cached source.`);
      } else {
        setError(message);
      }
    } finally {
      setBusyAction("");
    }
  }

  async function saveSettings(): Promise<void> {
    if (!draftPreferences) {
      return;
    }
    setSavingSettings(true);
    setError(undefined);
    setNotice(undefined);
    try {
      let nextRealDebridStatus = realDebridStatus;
      if (realDebridToken.trim()) {
        nextRealDebridStatus = await window.subtitleTranslator.setRealDebridApiToken(realDebridToken);
      }
      for (const provider of ["all-debrid", "premiumize", "torbox", "debrid-link"] as const) {
        const token = otherDebridTokens[provider]?.trim();
        if (token) await window.subtitleTranslator.setOtherDebridApiToken(provider, token);
      }
      if (mdblistApiKey.trim()) {
        await window.subtitleTranslator.setMdblistApiKey(mdblistApiKey);
        resetRatings();
      }
      const savedPreferences = await window.subtitleTranslator.saveDiscoveryPreferences(draftPreferences);
      const credentials = await window.subtitleTranslator.getDiscoveryCredentialStatus();
      setState((current) => current ? { ...current, preferences: savedPreferences } : current);
      setDraftPreferences(savedPreferences);
      setCredentialStatus(credentials);
      setRealDebridStatus(nextRealDebridStatus);
      setRealDebridToken("");
      setOtherDebridTokens({});
      setMdblistApiKey("");
      resetSources();
      staleRealDebridSourceKeysRef.current.clear();
      setNotice("Discovery settings saved.");
      await loadHome();
    } catch (settingsError) {
      setError(formatError(settingsError));
    } finally {
      setSavingSettings(false);
    }
  }

  async function disconnectRealDebrid(): Promise<void> {
    await window.subtitleTranslator.clearRealDebridApiToken();
    setCredentialStatus((current) => current ? { ...current, hasRealDebridToken: false } : current);
    setRealDebridStatus(undefined);
    setVerifiedSources([]);
    setNotice("Real-Debrid disconnected.");
  }

  async function disconnectOtherDebrid(provider: OtherDebridProvider): Promise<void> {
    await window.subtitleTranslator.clearOtherDebridApiToken(provider);
    setCredentialStatus((current) => current ? {
      ...current, hasDebridTokens: { ...current.hasDebridTokens, [provider]: false }
    } : current);
    setVerifiedSources([]);
    setNotice(`${debridProviderName(provider)} disconnected.`);
  }

  async function disconnectMdblist(): Promise<void> {
    await window.subtitleTranslator.clearMdblistApiKey();
    resetRatings();
    setCredentialStatus((current) => current ? { ...current, hasMdblistApiKey: false } : current);
    setNotice("MDBList ratings disconnected.");
  }

  async function clearTasteHistory(): Promise<void> {
    setBusyAction("clear-history");
    try {
      await window.subtitleTranslator.clearDiscoveryInteractions();
      setState((current) => current ? { ...current, interactions: [] } : current);
      setNotice("Recommendation history cleared.");
      await loadHome();
    } catch (clearError) {
      setError(formatError(clearError));
    } finally {
      setBusyAction("");
    }
  }

  function openSettings(returnTarget: SettingsReturnTarget = "settings-trigger"): void {
    catalogScrollYRef.current = window.scrollY;
    settingsReturnTargetRef.current = returnTarget;
    setError(undefined);
    setNotice(undefined);
    setSettingsOpen(true);
  }

  function closeSettings(): void {
    setError(undefined);
    setNotice(undefined);
    setSettingsOpen(false);
  }

  const availableSources = useMemo(
    () => sortTorrentSources(downloadMethod === "real-debrid" ? verifiedSources : sourceResult?.sources ?? []),
    [downloadMethod, sourceResult, verifiedSources]
  );
  const detailsInteraction = details ? interactionMap.get(catalogItemKey(details)) : undefined;
  const selectedEpisodeActionKey = details?.mediaType === "series" && episode !== undefined
    ? `${catalogItemKey(details)}:s${season}e${episode}:watched`
    : "";
  // Stable callbacks let the memoized catalog sections skip re-rendering while the user types.
  const handleSelectItem = useStableCallback(selectItem);
  const handleInteraction = useStableCallback(setInteraction);
  const handleExpandCatalogue = useStableCallback(openStreamingCatalogue);
  const sectionProps = {
    uiLanguage,
    interactions: interactionMap,
    ratings: externalRatings,
    busyAction,
    onSelect: handleSelectItem,
    onInteract: handleInteraction
  };
  const collections = {
    liked: {
      sectionId: "liked-titles",
      title: uiLanguage === "bg" ? "Харесани заглавия" : "Liked titles",
      subtitle: uiLanguage === "bg" ? "Заглавията, които харесваш, се показват тук." : "Titles you have liked appear here.",
      items: filteredCollections.liked,
      total: collectionItems.liked.length,
      EmptyIcon: ThumbsUp,
      emptyText: "Titles you like will appear here."
    },
    favourites: {
      sectionId: "favourite-titles",
      title: uiLanguage === "bg" ? "Любими заглавия" : "Favourite titles",
      subtitle: uiLanguage === "bg" ? "Запазените ти филми и сериали." : "Your saved movies and TV shows.",
      items: filteredCollections.favourites,
      total: collectionItems.favourites.length,
      EmptyIcon: Bookmark,
      emptyText: "Save a title as a favourite and it will appear here."
    },
    watched: {
      sectionId: "watched-titles",
      title: uiLanguage === "bg" ? "Гледани заглавия" : "Watched titles",
      subtitle: uiLanguage === "bg" ? "Филми и сериали, които си отбелязал като гледани." : "Movies and TV shows you have marked as watched.",
      items: filteredCollections.watched,
      total: collectionItems.watched.length,
      EmptyIcon: Eye,
      emptyText: "Titles you mark as watched will appear here."
    }
  };
  const activeCollection = catalogView === "browse" ? undefined : collections[catalogView];

  if (!state || !draftPreferences || !credentialStatus) {
    return (
      <section className="discover-page">
        <CatalogSkeleton label="Loading recommendations…" sections={3} />
      </section>
    );
  }

  if (settingsOpen) {
    return (
      <section className="discover-page discovery-settings-page">
        <DiscoverySettings
          preferences={draftPreferences}
          credentials={credentialStatus}
          realDebridStatus={realDebridStatus}
          realDebridToken={realDebridToken}
          otherDebridTokens={otherDebridTokens}
          mdblistApiKey={mdblistApiKey}
          downloadLocations={locations.downloadLocations}
          saving={savingSettings}
          clearingHistory={busyAction === "clear-history"}
          locationBusy={locations.locationBusy}
          error={error}
          notice={notice}
          backButtonRef={settingsBackRef}
          onPreferencesChange={setDraftPreferences}
          onRealDebridTokenChange={setRealDebridToken}
          onOtherDebridTokenChange={(provider, value) => setOtherDebridTokens((current) => ({ ...current, [provider]: value }))}
          onMdblistApiKeyChange={setMdblistApiKey}
          onAddDownloadLocation={locations.addDownloadLocation}
          onSetDefaultDownloadLocation={locations.setDefaultDownloadLocation}
          onSetDownloadLocationExternal={locations.setDownloadLocationExternal}
          onRemoveDownloadLocation={locations.removeDownloadLocation}
          onScanExternalDownloadLocations={locations.scanExternalDownloadLocations}
          onSave={saveSettings}
          onDisconnectRealDebrid={disconnectRealDebrid}
          onDisconnectOtherDebrid={disconnectOtherDebrid}
          onDisconnectMdblist={disconnectMdblist}
          onClearHistory={clearTasteHistory}
          onBack={closeSettings}
        />
      </section>
    );
  }

  return (
    <section className="discover-page" aria-labelledby="discover-page-title">
      <header className={`discover-hero${catalogue.open ? " service-catalogue-hero" : ""}`}>
        {catalogue.open ? (
          <div className="service-catalogue-heading">
            <button className="text-button" onClick={catalogue.closeCatalogue} type="button">
              <ArrowLeft size={16} />
              Back to Discover
            </button>
            <span className="discover-eyebrow"><Compass size={15} /> Streaming catalogue</span>
            <h2 id="discover-page-title">
              {streamingServiceLabels(catalogue.filters.streamingServices).join(" + ")} catalogue
            </h2>
            <p>Search and filter titles confirmed by the selected streaming service.</p>
          </div>
        ) : (
          <>
            <div className="discover-heading">
              <h2 id="discover-page-title">{ui.title}</h2>
            </div>
            <DiscoverSearchBar
              ui={ui}
              query={search.query}
              loading={loadingCatalog}
              hasResults={Boolean(searchResults)}
              recentSearches={search.recentSearches}
              onQueryChange={search.setQuery}
              onSearch={search.runSearch}
              onClearResults={search.clearResults}
              onClearRecentSearches={search.clearRecentSearches}
            />
            <div className="discover-header-actions">
              <button
                aria-controls="discovery-filters"
                aria-expanded={filtersOpen}
                className={`text-button discover-filter-trigger${activeFilterCount > 0 || filtersOpen ? " active" : ""}`}
                ref={filtersTriggerRef}
                onClick={filtersOpen ? closeFilters : openFilters}
                type="button"
              >
                <SlidersHorizontal size={15} />
                {ui.filters}
                {activeFilterCount > 0 && (
                  <span className="discover-filter-count" aria-label={`${activeFilterCount} active filters`}>
                    {activeFilterCount}
                  </span>
                )}
              </button>
              <button
                aria-label={ui.settings}
                className="text-button discover-settings-trigger"
                ref={settingsTriggerRef}
                onClick={() => openSettings("settings-trigger")}
                title={ui.settings}
                type="button"
              >
                <Settings size={16} />
                <span>{ui.settings}</span>
              </button>
            </div>
          </>
        )}
      </header>

      {!catalogue.open && filtersOpen && (
        <DiscoveryFilterPanel
          filters={draftFilters}
          loading={loadingStreamingAvailability}
          onChange={setDraftFilters}
          onApply={() => void applyFilters()}
          onClear={clearFilters}
          onClose={closeFilters}
        />
      )}

      {!catalogue.open && (
        <div className="discover-toolbar">
          <DiscoverViewTabs
            ui={ui}
            view={catalogView}
            counts={{
              liked: collectionItems.liked.length,
              favourites: collectionItems.favourites.length,
              watched: collectionItems.watched.length
            }}
            onChange={setCatalogView}
          />
          {!filtersOpen && activeFilterCount > 0 && (
            <div className="discover-filter-summary" role="status">
              <span>
                <SlidersHorizontal size={14} />
                {activeFilterCount} {activeFilterCount === 1 ? "filter" : "filters"} active
                <strong>{visibleTitleCount} {visibleTitleCount === 1 ? "title" : "titles"} shown</strong>
              </span>
              <button className="ghost-button button-sm" onClick={clearFilters} type="button">
                <X size={14} />
                Clear filters
              </button>
            </div>
          )}
        </div>
      )}

      {catalogue.open && (
        <DiscoveryFilterPanel
          filters={catalogue.draftFilters}
          loading={catalogue.loading}
          query={catalogue.query}
          title="Catalogue filters"
          description="Search across the selected service catalogue, then narrow by type, genre, or rating."
          applyLabel="Search catalogue"
          onQueryChange={catalogue.setQuery}
          onChange={catalogue.setDraftFilters}
          onApply={() => void catalogue.applyFilters()}
          onClear={catalogue.clearFilters}
          onClose={catalogue.closeCatalogue}
        />
      )}

      {error && (
        <div className="notice error discover-notice" role="alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="notice success discover-notice" role="status" aria-live="polite">
          <CheckCircle2 size={18} />
          <span>{notice}</span>
        </div>
      )}
      {ratingsError && (
        <div className="notice warning discover-notice discover-ratings-notice" role="status">
          <AlertTriangle size={18} />
          <span>{ratingsError}</span>
          <button className="text-button" onClick={() => openSettings("settings-trigger")} type="button">
            Rating settings
          </button>
        </div>
      )}

      <div className="discover-layout">
        <div className="discover-catalog">
          {catalogue.open && (
            <>
              <div className="service-catalogue-summary">
                <div>
                  <strong>{catalogue.items.length} matching titles</strong>
                  <span>{catalogue.scannedItems} catalogue entries scanned</span>
                </div>
                <span>Availability can vary by network location.</span>
              </div>
              {catalogue.items.length > 0 && (
                <CatalogSection
                  {...sectionProps}
                  sectionId="service-catalogue-results"
                  title="Catalogue results"
                  subtitle="Confirmed for at least one selected streaming service."
                  items={catalogue.items}
                />
              )}
              {catalogue.loading && catalogue.items.length === 0 && (
                <div className="discover-center-state">
                  <Loader2 className="spin" size={26} />
                  <span>Scanning streaming availability…</span>
                </div>
              )}
              {!catalogue.loading && catalogue.items.length === 0 && (
                <div className="discover-center-state">
                  <Search size={24} />
                  <strong>No matching titles in this catalogue page</strong>
                  <span>Adjust the filters or scan the next batch of titles.</span>
                </div>
              )}
              {catalogue.hasMore && (
                <div className="service-catalogue-load-more">
                  <button
                    className="primary-button"
                    disabled={catalogue.loading}
                    onClick={() => void catalogue.loadAll()}
                    type="button"
                  >
                    {catalogue.loading ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
                    {catalogue.loading ? "Loading all matching titles…" : "Show all"}
                  </button>
                </div>
              )}
            </>
          )}
          {!catalogue.open && loadingCatalog && !home && !searchResults && (
            <CatalogSkeleton label={ui.loadingTitles} />
          )}
          {!catalogue.open && activeCollection && (
            <>
              <CatalogSection
                {...sectionProps}
                sectionId={activeCollection.sectionId}
                title={activeCollection.title}
                subtitle={activeCollection.subtitle}
                items={activeCollection.items}
              />
              {activeCollection.total === 0 && (
                <div className="discover-center-state">
                  <activeCollection.EmptyIcon size={24} />
                  <span>{activeCollection.emptyText}</span>
                </div>
              )}
            </>
          )}
          {!catalogue.open && catalogView === "browse" && (filteredSearchResults ? (
            <CatalogSection
              {...sectionProps}
              sectionId="search-results"
              title={uiLanguage === "bg" ? `Резултати за „${search.submittedQuery}“` : `Search results for “${search.submittedQuery}”`}
              items={filteredSearchResults}
            />
          ) : (
            <>
              {(streamingFilterActive ? serviceRecommendationSections : filteredHomeSections).map((section) => (
                <CatalogSection
                  {...sectionProps}
                  key={section.id}
                  sectionId={section.id}
                  title={localizeDiscoveryCatalogText(section.title, uiLanguage)}
                  subtitle={section.subtitle && !section.subtitle.startsWith("Ranked locally from") ? localizeDiscoveryCatalogText(section.subtitle, uiLanguage) : undefined}
                  items={section.items}
                />
              ))}
              {streamingFilterActive && (
                <CatalogSection
                  {...sectionProps}
                  sectionId="streaming-catalogue-preview"
                  title={`${selectedServiceLabels.join(" + ")} catalogue`}
                  subtitle="A preview of matching titles. Open the full catalogue for deeper search and filtering."
                  items={serviceCataloguePreviewItems}
                  onExpand={handleExpandCatalogue}
                />
              )}
            </>
          ))}
          {!catalogue.open && catalogView === "browse" && searchResults?.length === 0 && (
            <div className="discover-center-state">
              <Search size={24} />
              <span>No matching movies or TV shows.</span>
            </div>
          )}
          {!catalogue.open && activeFilterCount > 0 && catalogItems.length > 0 && visibleTitleCount === 0 && (
            <div className="discover-center-state discover-filter-empty">
              <SlidersHorizontal size={24} />
              <strong>No titles match these filters</strong>
              <span>Try another genre, service, or rating, or clear the filters above.</span>
            </div>
          )}
        </div>

        <TitleDetailsDrawer open={Boolean(selectedItem)} panelRef={detailsPanelRef} onClose={closeDetails}>
          {loadingDetails && (
            <div className="discover-center-state">
              <Loader2 className="spin" size={24} />
              <span>Loading details…</span>
            </div>
          )}
          {details && (
            <>
              <DetailsHeader
                key={`${details.mediaType}:${details.id}`}
                details={details}
                interaction={detailsInteraction}
                busyAction={busyAction}
                ratings={externalRatings.get(catalogItemKey(details)) ?? []}
                onInteract={setInteraction}
              />

              {details.mediaType === "series" && (
                <EpisodePicker
                  details={details}
                  interaction={detailsInteraction}
                  season={season}
                  episode={episode}
                  selectedEpisodes={selectedEpisodes}
                  disabled={loadingSources || busyAction !== ""}
                  watchedBusy={busyAction === selectedEpisodeActionKey}
                  onSeasonChange={changeSeason}
                  onEpisodeChange={changeEpisodeSelection}
                  onToggleWatched={() => void toggleSelectedEpisodeWatched()}
                />
              )}

              <SourcePanel
                details={details}
                episode={episode}
                selectedEpisodes={selectedEpisodes}
                downloadMethod={downloadMethod}
                debridName={selectedDebridName}
                loadingSources={loadingSources}
                sourceResult={sourceResult}
                sources={availableSources}
                busyAction={busyAction}
                downloadLocations={locations.downloadLocations}
                selectedLocationId={locations.selectedLocationId}
                externalClientAvailable={Boolean(torrentClientStatus?.available)}
                findSourcesRef={findSourcesRef}
                debridMethodRef={realDebridMethodRef}
                onFindSources={() => void findSources()}
                onSwitchMethod={(method) => void switchDownloadMethod(method)}
                onSelectLocation={locations.setSelectedLocationId}
                onOpenTorrent={openTorrent}
                onTorrentDownload={downloadFromTorrent}
                onDebridDownload={downloadFromRealDebrid}
              />
            </>
          )}
        </TitleDetailsDrawer>
      </div>
    </section>
  );
}

function uniqueCatalogItems(items: CatalogItem[]): CatalogItem[] {
  return [...new Map(items.map((item) => [catalogItemKey(item), item])).values()];
}

function streamingServiceLabels(ids: StreamingServiceId[]): string[] {
  return ids
    .map((id) => STREAMING_SERVICES.find((service) => service.id === id)?.label)
    .filter((label): label is string => Boolean(label));
}
