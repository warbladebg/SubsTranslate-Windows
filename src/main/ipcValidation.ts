import type {
  CatalogDetails,
  CatalogItem,
  DiscoveryAction,
  DiscoveryPreferences,
  MediaType,
  OtherDebridProvider,
  RealDebridDownloadRequest,
  SourceSearchRequest,
  StreamingAvailabilityItem,
  StreamingCatalogueRequest,
  TorrentSource,
  VerifyCachedSourcesRequest
} from "../core/discovery/DiscoveryTypes";
import type { DeleteDownloadedFileRequest } from "../core/downloads/DownloadedLibrary";
import type { SubtitleTrack } from "../core/video/SubtitleTrack";
import type { MediaBatchSessionCheckpoint } from "./mediaBatchSessionService";
import type { MediaTransformRequest, MediaTranslationPreparationRequest } from "./mediaTransformService";
import type { AppSettings } from "./settingsService";
import type { SubtitleExportManyRequest, SubtitleExportRequest } from "./subtitleExportService";
import type { BatchJobRequest, DryRunRequest, TranslationJobRequest } from "./translationManager";
import type { WorkflowProfileDraft } from "./workflowProfileService";

/**
 * Shape checks for values arriving over IPC. The renderer is trusted code, but
 * these checks keep a compromised or buggy renderer from handing malformed
 * values to services that touch the file system, network, or credentials.
 * Services still own their domain-level normalization.
 */
export class IpcInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IpcInputError";
  }
}

const MAX_TEXT_LENGTH = 10_000;
const MAX_PATH_LENGTH = 32_767;
const MAX_ID_LENGTH = 200;
const MAX_LIST_LENGTH = 1_000;

export const OTHER_DEBRID_PROVIDERS = ["all-debrid", "premiumize", "torbox", "debrid-link"] as const satisfies readonly OtherDebridProvider[];
export type OtherDebridProviderId = OtherDebridProvider;

const MEDIA_TYPES = ["movie", "series"] as const satisfies readonly MediaType[];
const DISCOVERY_ACTIONS = ["liked", "disliked", "watched", "watchlisted", "hidden"] as const satisfies readonly DiscoveryAction[];
const SAMPLE_MODES = ["none", "first20", "firstScene", "first3Minutes"] as const;
const OUTPUT_CONFLICT_MODES = ["overwrite", "versioned", "cancel"] as const;
const OUTPUT_MODES = ["new-file", "replace-original"] as const;
const CONTAINER_IDS = ["mkv", "mp4", "mov"] as const;
const SUBTITLE_ENCODING_IDS = ["ansi", "utf-16-le", "utf-16-be", "utf-8", "utf-8-bom"] as const;

function fail(label: string, expectation: string): never {
  throw new IpcInputError(`Invalid ${label}: expected ${expectation}.`);
}

export function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(label, "an object");
  }
  return value as Record<string, unknown>;
}

export function expectString(
  value: unknown,
  label: string,
  { maxLength = MAX_TEXT_LENGTH, allowEmpty = false }: { maxLength?: number; allowEmpty?: boolean } = {}
): string {
  if (typeof value !== "string" || value.length > maxLength || (!allowEmpty && !value.trim())) {
    fail(label, allowEmpty ? `text up to ${maxLength} characters` : `non-empty text up to ${maxLength} characters`);
  }
  return value;
}

export function expectOptionalString(value: unknown, label: string, maxLength = MAX_TEXT_LENGTH): string | undefined {
  return value === undefined ? undefined : expectString(value, label, { maxLength, allowEmpty: true });
}

export function expectPath(value: unknown, label: string): string {
  const path = expectString(value, label, { maxLength: MAX_PATH_LENGTH });
  if (path.includes("\0")) {
    fail(label, "a file path without NUL characters");
  }
  return path;
}

export function expectOptionalPath(value: unknown, label: string): string | undefined {
  return value === undefined || value === "" ? undefined : expectPath(value, label);
}

export function expectId(value: unknown, label: string): string {
  return expectString(value, label, { maxLength: MAX_ID_LENGTH });
}

export function expectOptionalId(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : expectId(value, label);
}

export function expectBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    fail(label, "true or false");
  }
  return value;
}

export function expectOptionalBoolean(value: unknown, label: string): boolean | undefined {
  return value === undefined ? undefined : expectBoolean(value, label);
}

export function expectInteger(
  value: unknown,
  label: string,
  { min = 0, max = Number.MAX_SAFE_INTEGER }: { min?: number; max?: number } = {}
): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    fail(label, `a whole number from ${min} to ${max}`);
  }
  return value;
}

export function expectOptionalInteger(
  value: unknown,
  label: string,
  range?: { min?: number; max?: number }
): number | undefined {
  return value === undefined ? undefined : expectInteger(value, label, range);
}

export function expectOptionalFiniteNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(label, "a finite number");
  }
  return value;
}

export function expectOneOf<const Allowed extends readonly string[]>(
  value: unknown,
  allowed: Allowed,
  label: string
): Allowed[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    fail(label, `one of ${allowed.join(", ")}`);
  }
  return value as Allowed[number];
}

export function expectOptionalOneOf<const Allowed extends readonly string[]>(
  value: unknown,
  allowed: Allowed,
  label: string
): Allowed[number] | undefined {
  return value === undefined ? undefined : expectOneOf(value, allowed, label);
}

export function expectArray<Item>(
  value: unknown,
  label: string,
  readItem: (item: unknown, itemLabel: string) => Item,
  maxLength = MAX_LIST_LENGTH
): Item[] {
  if (!Array.isArray(value) || value.length > maxLength) {
    fail(label, `a list of at most ${maxLength} entries`);
  }
  return value.map((item, index) => readItem(item, `${label}[${index}]`));
}

function expectOptionalArray<Item>(
  value: unknown,
  label: string,
  readItem: (item: unknown, itemLabel: string) => Item,
  maxLength = MAX_LIST_LENGTH
): Item[] | undefined {
  return value === undefined ? undefined : expectArray(value, label, readItem, maxLength);
}

const readEpisodeNumber = (value: unknown, label: string): number => expectInteger(value, label, { min: 0, max: 10_000 });

export function expectMediaType(value: unknown, label = "media type"): MediaType {
  return expectOneOf(value, MEDIA_TYPES, label);
}

export function expectDiscoveryAction(value: unknown): DiscoveryAction {
  return expectOneOf(value, DISCOVERY_ACTIONS, "discovery action");
}

export function expectOtherDebridProvider(value: unknown): OtherDebridProviderId {
  return expectOneOf(value, OTHER_DEBRID_PROVIDERS, "debrid provider");
}

export function expectCatalogItem(value: unknown, label = "catalog item"): CatalogItem {
  const item = expectRecord(value, label);
  expectId(item.id, `${label} id`);
  expectMediaType(item.mediaType, `${label} media type`);
  expectString(item.title, `${label} title`, { allowEmpty: true });
  if (item.genreIds !== undefined) {
    expectArray(item.genreIds, `${label} genres`, (genre, genreLabel) => expectInteger(genre, genreLabel), 100);
  }
  return item as unknown as CatalogItem;
}

export function expectCatalogDetails(value: unknown, label = "title details"): CatalogDetails {
  const details = expectCatalogItem(value, label) as unknown as Record<string, unknown>;
  expectOptionalId(details.imdbId, `${label} IMDb id`);
  if (details.seasons !== undefined) {
    expectArray(details.seasons, `${label} seasons`, (season, seasonLabel) => {
      const record = expectRecord(season, seasonLabel);
      expectInteger(record.seasonNumber, `${seasonLabel} number`, { min: 0, max: 10_000 });
      expectInteger(record.episodeCount, `${seasonLabel} episode count`, { min: 0, max: 100_000 });
      return record;
    }, 500);
  }
  return details as unknown as CatalogDetails;
}

export function expectStreamingItems(value: unknown): StreamingAvailabilityItem[] {
  return expectArray(value, "title list", (item, label) => {
    const record = expectRecord(item, label);
    return { id: expectId(record.id, `${label} id`), mediaType: expectMediaType(record.mediaType, `${label} media type`) };
  });
}

export function expectStreamingCatalogueRequest(value: unknown): StreamingCatalogueRequest {
  const request = expectRecord(value, "streaming catalogue request");
  return {
    streamingServices: expectArray(request.streamingServices, "streaming services", (service, label) => expectId(service, label) as StreamingCatalogueRequest["streamingServices"][number], 20),
    mediaType: expectOneOf(request.mediaType, ["all", ...MEDIA_TYPES] as const, "catalogue media type"),
    genreIds: expectArray(request.genreIds, "genres", (genre, label) => expectInteger(genre, label), 100),
    minimumRating: expectOptionalFiniteNumber(request.minimumRating, "minimum rating") ?? 0,
    query: expectString(request.query, "catalogue search", { maxLength: 500, allowEmpty: true }),
    skip: expectInteger(request.skip, "catalogue offset"),
    showAll: expectOptionalBoolean(request.showAll, "show all")
  };
}

export function expectTorrentSource(value: unknown, label = "torrent source"): TorrentSource {
  const source = expectRecord(value, label);
  expectId(source.id, `${label} id`);
  const infoHash = expectString(source.infoHash, `${label} info hash`, { maxLength: 64 });
  if (!/^(?:[a-f0-9]{40}|[a-z2-7]{32})$/i.test(infoHash.trim())) {
    fail(`${label} info hash`, "a 40-character hex or 32-character base32 hash");
  }
  expectString(source.name, `${label} name`, { maxLength: MAX_TEXT_LENGTH, allowEmpty: true });
  expectOptionalInteger(source.fileIndex, `${label} file index`);
  expectOptionalArray(source.selectedFileIndices, `${label} selected files`, (index, indexLabel) => expectInteger(index, indexLabel), 5_000);
  expectArray(source.trackers ?? [], `${label} trackers`, (tracker, trackerLabel) => expectString(tracker, trackerLabel, { maxLength: 2_048 }), 500);
  return source as unknown as TorrentSource;
}

export function expectSourceSearchRequest(value: unknown): SourceSearchRequest {
  const request = expectRecord(value, "source search request");
  return {
    media: expectCatalogDetails(request.media),
    season: expectOptionalInteger(request.season, "season", { min: 0, max: 10_000 }),
    episode: expectOptionalInteger(request.episode, "episode", { min: 0, max: 10_000 }),
    episodes: expectOptionalArray(request.episodes, "episodes", readEpisodeNumber, 5_000)
  };
}

export function expectVerifyCachedSourcesRequest(value: unknown): VerifyCachedSourcesRequest {
  const request = expectRecord(value, "cached source request");
  return {
    sources: expectArray(request.sources, "sources", (source, label) => expectTorrentSource(source, label)),
    media: expectCatalogDetails(request.media),
    season: expectOptionalInteger(request.season, "season", { min: 0, max: 10_000 }),
    episode: expectOptionalInteger(request.episode, "episode", { min: 0, max: 10_000 })
  };
}

export function expectDownloadRequest(value: unknown): RealDebridDownloadRequest {
  const request = expectRecord(value, "download request");
  return {
    source: expectTorrentSource(request.source),
    media: expectCatalogDetails(request.media),
    season: expectOptionalInteger(request.season, "season", { min: 0, max: 10_000 }),
    episode: expectOptionalInteger(request.episode, "episode", { min: 0, max: 10_000 }),
    episodes: expectOptionalArray(request.episodes, "episodes", readEpisodeNumber, 5_000),
    destinationLocationId: expectOptionalId(request.destinationLocationId, "download location")
  };
}

export function expectDiscoveryPreferences(value: unknown): DiscoveryPreferences {
  return expectRecord(value, "discovery preferences") as unknown as DiscoveryPreferences;
}

export function expectDeleteDownloadedFileRequest(value: unknown): DeleteDownloadedFileRequest {
  const request = expectRecord(value, "downloaded file selection");
  return {
    libraryLocationId: expectId(request.libraryLocationId, "download location"),
    titleKey: expectString(request.titleKey, "title key", { maxLength: 1_000 }),
    fileId: expectString(request.fileId, "file id", { maxLength: 1_000 })
  };
}

export function expectSubtitleTrack(value: unknown, label = "subtitle track"): SubtitleTrack {
  const track = expectRecord(value, label);
  expectInteger(track.index, `${label} index`, { max: 10_000 });
  expectString(track.codecName, `${label} codec`, { maxLength: 200, allowEmpty: true });
  expectBoolean(track.isSupported, `${label} support flag`);
  return track as unknown as SubtitleTrack;
}

function expectSettings(value: unknown): AppSettings {
  return expectRecord(value, "translation settings") as unknown as AppSettings;
}

export function expectAppSettings(value: unknown): AppSettings {
  return expectSettings(value);
}

export function expectMediaTransformRequest(value: unknown, label = "media request"): MediaTransformRequest {
  const request = expectRecord(value, label);
  return {
    videoPath: expectPath(request.videoPath, "video path"),
    audioTrackIndex: expectOptionalInteger(request.audioTrackIndex, "audio track", { max: 10_000 }),
    audioProfileId: expectString(request.audioProfileId, "audio profile", { maxLength: 100 }) as MediaTransformRequest["audioProfileId"],
    keepOnlySelectedAudioTrack: expectOptionalBoolean(request.keepOnlySelectedAudioTrack, "keep only selected audio track"),
    subtitlePath: expectOptionalPath(request.subtitlePath, "subtitle path"),
    keepOnlyNewSubtitleTrack: expectOptionalBoolean(request.keepOnlyNewSubtitleTrack, "keep only new subtitle track"),
    subtitleEncodingId: expectOptionalOneOf(request.subtitleEncodingId, SUBTITLE_ENCODING_IDS, "subtitle encoding"),
    subtitleLanguage: expectOptionalString(request.subtitleLanguage, "subtitle language", 20),
    subtitleTitle: expectOptionalString(request.subtitleTitle, "subtitle title", 200),
    outputDirectory: expectOptionalPath(request.outputDirectory, "output folder"),
    outputConflictMode: expectOneOf(request.outputConflictMode, OUTPUT_CONFLICT_MODES, "existing-file handling"),
    outputMode: expectOptionalOneOf(request.outputMode, OUTPUT_MODES, "output mode"),
    outputContainerId: expectOptionalOneOf(request.outputContainerId, CONTAINER_IDS, "media format"),
    audioGainDb: expectOptionalFiniteNumber(request.audioGainDb, "volume adjustment")
  };
}

export function expectMediaPreparationRequest(value: unknown): MediaTranslationPreparationRequest {
  const request = expectRecord(value, "media preparation request");
  return {
    ...expectMediaTransformRequest(request, "media preparation request"),
    subtitleTrack: expectSubtitleTrack(request.subtitleTrack)
  };
}

export function expectTranslationJobRequest(value: unknown): TranslationJobRequest {
  const request = expectRecord(value, "translation request");
  return {
    videoPath: expectPath(request.videoPath, "video path"),
    track: expectSubtitleTrack(request.track),
    settings: expectSettings(request.settings),
    sampleMode: expectOneOf(request.sampleMode, SAMPLE_MODES, "sample mode"),
    alternateOutputDirectory: expectOptionalPath(request.alternateOutputDirectory, "output folder"),
    extractedSubtitlePath: expectOptionalPath(request.extractedSubtitlePath, "extracted subtitle path")
  };
}

export function expectDryRunRequest(value: unknown): DryRunRequest {
  const request = expectRecord(value, "estimate request");
  return {
    videoPath: expectPath(request.videoPath, "video path"),
    track: expectSubtitleTrack(request.track),
    settings: expectSettings(request.settings),
    sampleMode: expectOneOf(request.sampleMode, SAMPLE_MODES, "sample mode")
  };
}

export function expectBatchJobRequest(value: unknown): BatchJobRequest {
  const request = expectRecord(value, "batch request");
  return {
    folderPath: expectPath(request.folderPath, "batch folder"),
    settings: expectSettings(request.settings),
    alternateOutputDirectory: expectOptionalPath(request.alternateOutputDirectory, "output folder"),
    resumeItems: expectOptionalArray(request.resumeItems, "resume items", (item, label) => expectRecord(item, label), 10_000) as BatchJobRequest["resumeItems"]
  };
}

export function expectSubtitleExportRequest(value: unknown): SubtitleExportRequest {
  const request = expectRecord(value, "subtitle export request");
  return {
    videoPath: expectPath(request.videoPath, "video path"),
    track: expectSubtitleTrack(request.track),
    outputDirectory: expectPath(request.outputDirectory, "output folder")
  };
}

export function expectSubtitleExportManyRequest(value: unknown): SubtitleExportManyRequest {
  const request = expectRecord(value, "subtitle export request");
  return {
    videoPath: expectPath(request.videoPath, "video path"),
    tracks: expectArray(request.tracks, "subtitle tracks", (track, label) => expectSubtitleTrack(track, label), 500),
    outputDirectory: expectPath(request.outputDirectory, "output folder")
  };
}

export function expectMediaBatchCheckpoint(value: unknown): MediaBatchSessionCheckpoint {
  const checkpoint = expectRecord(value, "media batch checkpoint");
  expectOptionalId(checkpoint.id, "media batch id");
  expectArray(checkpoint.videoPaths, "batch videos", expectPath, 10_000);
  expectArray(checkpoint.subtitlePaths ?? [], "batch subtitles", expectPath, 10_000);
  expectPath(checkpoint.referenceVideoPath, "batch reference video");
  expectArray(checkpoint.items, "batch items", (item, label) => {
    const record = expectRecord(item, label);
    expectPath(record.videoPath, `${label} video path`);
    return record;
  }, 10_000);
  return checkpoint as unknown as MediaBatchSessionCheckpoint;
}

export function expectWorkflowProfileDraft(value: unknown): WorkflowProfileDraft {
  const draft = expectRecord(value, "workflow");
  expectOptionalId(draft.id, "workflow id");
  expectString(draft.name, "workflow name", { maxLength: 200, allowEmpty: true });
  expectRecord(draft.config, "workflow settings");
  return draft as unknown as WorkflowProfileDraft;
}
