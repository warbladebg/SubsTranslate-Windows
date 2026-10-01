import type { AudioTrack } from "../video/AudioTrack";
import type { SubtitleTrack } from "../video/SubtitleTrack";
import { fileName } from "../util/paths";

export { fileName };

export interface BatchSubtitleMatchResult {
  matches: Record<string, string>;
  missingVideoPaths: string[];
}

export interface BatchOutputCollision {
  outputStem: string;
  videoPaths: string[];
}

export function matchBatchAudioTrack(
  referenceTracks: AudioTrack[],
  selectedReferenceIndex: number | undefined,
  targetTracks: AudioTrack[]
): AudioTrack | undefined {
  if (targetTracks.length === 0) {
    return undefined;
  }

  const referencePosition = referenceTracks.findIndex((track) => track.index === selectedReferenceIndex);
  if (referencePosition < 0) {
    return selectedReferenceIndex === undefined ? targetTracks[0] : undefined;
  }

  const referenceTrack = referenceTracks[referencePosition];
  const referenceTitle = normalizedMetadata(referenceTrack.title);
  const referenceLanguage = normalizedLanguage(referenceTrack.language);
  const referenceCodec = normalizedMetadata(referenceTrack.codecName);
  const referenceLayout = normalizedMetadata(referenceTrack.channelLayout);

  const metadataMatches = [
    uniqueMatch(targetTracks, (track) => Boolean(
      referenceTitle && referenceLanguage &&
      normalizedMetadata(track.title) === referenceTitle && normalizedLanguage(track.language) === referenceLanguage
    )),
    uniqueMatch(targetTracks, (track) => Boolean(
      referenceLanguage && referenceCodec && referenceTrack.channels &&
      normalizedLanguage(track.language) === referenceLanguage &&
      normalizedMetadata(track.codecName) === referenceCodec &&
      track.channels === referenceTrack.channels
    )),
    uniqueMatch(targetTracks, (track) => Boolean(
      referenceLanguage && referenceLayout &&
      normalizedLanguage(track.language) === referenceLanguage &&
      normalizedMetadata(track.channelLayout) === referenceLayout
    )),
    uniqueMatch(targetTracks, (track) => Boolean(
      referenceLanguage && referenceCodec &&
      normalizedLanguage(track.language) === referenceLanguage && normalizedMetadata(track.codecName) === referenceCodec
    )),
    uniqueMatch(targetTracks, (track) => Boolean(referenceLanguage && normalizedLanguage(track.language) === referenceLanguage)),
    uniqueMatch(targetTracks, (track) => Boolean(referenceTitle && normalizedMetadata(track.title) === referenceTitle))
  ];
  const metadataMatch = metadataMatches.find((track) => track !== undefined);
  if (metadataMatch) {
    return metadataMatch;
  }

  return targetTracks[referencePosition];
}

export function findBatchOutputCollisions(
  videoPaths: string[],
  commonOutputDirectory?: string
): BatchOutputCollision[] {
  const pathsByTarget = new Map<string, string[]>();
  for (const videoPath of videoPaths) {
    const outputDirectory = commonOutputDirectory || directoryPath(videoPath);
    const outputStem = fileStem(videoPath);
    const key = `${normalizePathKey(outputDirectory)}|${outputStem.toLowerCase()}`;
    const matches = pathsByTarget.get(key) ?? [];
    matches.push(videoPath);
    pathsByTarget.set(key, matches);
  }

  return [...pathsByTarget.values()]
    .filter((paths) => paths.length > 1)
    .map((paths) => ({ outputStem: fileStem(paths[0]), videoPaths: paths }));
}

export function matchBatchSubtitleTrack(
  referenceTrack: SubtitleTrack | undefined,
  referenceTracks: SubtitleTrack[],
  targetTracks: SubtitleTrack[]
): SubtitleTrack | undefined {
  const supportedTargets = targetTracks.filter((track) => track.isSupported);
  if (supportedTargets.length === 0) {
    return undefined;
  }
  if (!referenceTrack) {
    return supportedTargets[0];
  }

  const supportedReferences = referenceTracks.filter((track) => track.isSupported);
  const language = normalizedLanguage(referenceTrack.language);
  const title = normalizedMetadata(referenceTrack.title);
  const sameLanguage = (track: SubtitleTrack) => normalizedLanguage(track.language) === language;
  const titled = title && uniqueMatch(supportedTargets, (track) =>
    sameLanguage(track) && normalizedMetadata(track.title) === title);
  if (titled) return titled;

  // Preserve the selected variant among same-language tracks (full, forced, SDH).
  const peers = supportedReferences.filter((track) => sameLanguage(track) && track.codecName === referenceTrack.codecName);
  const peerPosition = peers.findIndex((track) => track.index === referenceTrack.index);
  const targets = supportedTargets.filter((track) => sameLanguage(track) && track.codecName === referenceTrack.codecName);
  if (targets.length) return targets[peerPosition];
  const languageTargets = supportedTargets.filter(sameLanguage);
  if (languageTargets.length === 1) return languageTargets[0];
  const referencePosition = supportedReferences.findIndex((track) => track.index === referenceTrack.index);
  return supportedTargets[referencePosition];
}

export function matchBatchSubtitleFiles(
  videoPaths: string[],
  subtitlePaths: string[]
): BatchSubtitleMatchResult {
  const subtitlesByStem = new Map<string, string[]>();
  for (const subtitlePath of subtitlePaths) {
    const stem = normalizeSubtitleStem(fileStem(subtitlePath));
    const matches = subtitlesByStem.get(stem) ?? [];
    matches.push(subtitlePath);
    subtitlesByStem.set(stem, matches);
  }

  const matches: Record<string, string> = {};
  const missingVideoPaths: string[] = [];
  for (const videoPath of videoPaths) {
    const candidates = subtitlesByStem.get(fileStem(videoPath).toLowerCase()) ?? [];
    if (candidates.length === 1) {
      matches[videoPath] = candidates[0];
    } else {
      missingVideoPaths.push(videoPath);
    }
  }

  return { matches, missingVideoPaths };
}

function fileStem(path: string): string {
  return fileName(path).replace(/\.[^.]+$/, "");
}

function directoryPath(path: string): string {
  const separatorIndex = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return separatorIndex >= 0 ? path.slice(0, separatorIndex) : "";
}

function normalizePathKey(path: string): string {
  return path.replace(/[\\/]+$/, "").toLowerCase();
}

function normalizedMetadata(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

function normalizedLanguage(value: string | undefined): string | undefined {
  const normalized = normalizedMetadata(value);
  return normalized && normalized !== "und" && normalized !== "unknown" ? normalized : undefined;
}

function uniqueMatch<T>(items: T[], predicate: (item: T) => boolean): T | undefined {
  const matches = items.filter(predicate);
  return matches.length === 1 ? matches[0] : undefined;
}

function normalizeSubtitleStem(stem: string): string {
  return stem.replace(/\.(?:bg|bul|bulgarian|translated)$/i, "").toLowerCase();
}
