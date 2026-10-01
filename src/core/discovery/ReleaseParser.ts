import { createHash } from "node:crypto";
import type { PreferredQuality, TorrentSource } from "./DiscoveryTypes";
import { normalizeInfoHash } from "./MagnetLinks";
import { sortTorrentSources } from "./TorrentSourceSorting";
import { cleanText } from "../util/text";

export interface StremioStream {
  infoHash?: unknown;
  fileIdx?: unknown;
  name?: unknown;
  title?: unknown;
  description?: unknown;
  url?: unknown;
  sources?: unknown;
  subtitles?: unknown;
  behaviorHints?: unknown;
}

export function parseStremioStream(stream: StremioStream, provider: string, observedAt: string): TorrentSource | undefined {
  const playbackIdentity = parsePlaybackIdentity(stream.url);
  const rawInfoHash = typeof stream.infoHash === "string"
    ? stream.infoHash
    : playbackIdentity?.infoHash;
  if (!rawInfoHash) {
    return undefined;
  }

  let infoHash: string;
  try {
    infoHash = normalizeInfoHash(rawInfoHash);
  } catch {
    return undefined;
  }

  const behaviorFilename = parseBehaviorFilename(stream.behaviorHints);
  const name = cleanText(
    typeof stream.title === "string"
      ? stream.title
      : behaviorFilename
        ? behaviorFilename
        : typeof stream.description === "string"
        ? stream.description
        : typeof stream.name === "string"
          ? stream.name
          : infoHash
  );
  const description = cleanText([
    typeof stream.name === "string" ? stream.name : "",
    typeof stream.description === "string" ? stream.description : ""
  ].filter(Boolean).join(" · "));
  const combined = `${name} ${description} ${behaviorFilename ?? ""}`;
  const trackers = Array.isArray(stream.sources)
    ? stream.sources.filter((value): value is string => typeof value === "string")
    : [];
  const providerLabel = typeof stream.name === "string" ? stream.name : "";
  const providerClaimedCached = /\[(?:RD|REAL[\s-]?DEBRID)\+\]|\b(?:RD|REAL[\s-]?DEBRID)\s*\+|⚡/i.test(providerLabel);
  const fileIndex = typeof stream.fileIdx === "number" && Number.isInteger(stream.fileIdx) && stream.fileIdx >= 0
    ? stream.fileIdx
    : playbackIdentity?.fileIndex;

  return {
    id: createHash("sha256").update(`${provider}:${infoHash}:${fileIndex ?? ""}`).digest("hex").slice(0, 24),
    provider,
    infoHash,
    fileIndex,
    name: name || infoHash,
    description: description || undefined,
    sizeBytes: parseBehaviorVideoSize(stream.behaviorHints) ?? parseSizeBytes(combined),
    seeders: parseSeeders(combined),
    quality: parseQuality(combined),
    codec: parseCodec(combined),
    hdr: parseHdr(combined),
    audio: parseAudio(combined),
    audioLanguages: parseAudioLanguages(stream, provider),
    advertisedSubtitleLanguages: parseAdvertisedSubtitles(stream.subtitles, combined),
    isSeasonPack: parseSeasonPack(stream.title, behaviorFilename),
    releaseGroup: parseReleaseGroup(combined),
    trackers,
    observedAt,
    providerClaimedCached,
    cacheStatus: providerClaimedCached ? "provider-claimed-cached" : "unknown"
  };
}

function parseSeasonPack(title: unknown, behaviorFilename: string | undefined): boolean | undefined {
  const rawTitle = typeof title === "string" ? title : behaviorFilename ?? "";
  const primaryTitle = rawTitle.split(/\r?\n/, 1)[0]?.trim() ?? "";
  const pathText = `${rawTitle} ${behaviorFilename ?? ""}`;
  const hasEpisodeMarker = /\bS\d{1,2}[\s._-]*E\d{1,3}\b|\b\d{1,2}x\d{1,3}\b/i.test(primaryTitle);
  const hasSeasonRange = /\bS\d{1,2}\s*[-–]\s*S?\d{1,2}\b|\bseasons?\s*\d{1,2}\s*[-–]\s*\d{1,2}\b|\b\d{1,2}\s*[-–]\s*\d{1,2}\s*seasons?\b/i
    .test(primaryTitle);
  const namesCompleteSeason = /\b(?:complete|full)[\s._-]*(?:season|series)\b|\b(?:season|series)[\s._-]*\d{1,2}[\s._-]*(?:complete|pack)\b/i
    .test(primaryTitle);
  const seasonWithoutEpisode = !hasEpisodeMarker
    && /\bS\d{1,2}\b|\bseason[\s._-]*\d{1,2}\b/i.test(primaryTitle);
  const episodeInsideSeasonFolder = /(?:^|[\\/])(?:season[\s._-]*\d{1,2}|S\d{1,2})(?:[\\/])/i.test(pathText);

  return hasSeasonRange || namesCompleteSeason || seasonWithoutEpisode || episodeInsideSeasonFolder
    ? true
    : undefined;
}

function parseBehaviorVideoSize(value: unknown): number | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const size = (value as Record<string, unknown>).videoSize;
  return typeof size === "number" && Number.isSafeInteger(size) && size > 0 ? size : undefined;
}

function parseBehaviorFilename(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const filename = (value as Record<string, unknown>).filename;
  return typeof filename === "string" ? cleanText(filename) : undefined;
}

function parseAdvertisedSubtitles(value: unknown, releaseText: string): string[] | undefined {
  if (Array.isArray(value) && value.length > 0) {
    const languages = value
      .slice(0, 100)
      .flatMap((subtitle) => {
        if (!subtitle || typeof subtitle !== "object" || Array.isArray(subtitle)) {
          return [];
        }
        const language = (subtitle as Record<string, unknown>).lang;
        if (typeof language !== "string") {
          return [];
        }
        const cleaned = language.replace(/[^A-Za-z-]/g, "").slice(0, 12).toUpperCase();
        return cleaned ? [cleaned] : [];
      });
    return [...new Set(languages)];
  }

  if (/\b(?:no|without)[\s._-]*(?:subs?|subtitles?)\b/i.test(releaseText)) {
    return undefined;
  }
  return /\b(?:subs?|subtitles?|subbed|soft[\s._-]?subs?|multi[\s._-]?subs?|subsplease)\b|\b[A-Z]{2,3}[\s._-]?SUBS?\b/i
    .test(releaseText)
    ? []
    : undefined;
}

function parsePlaybackIdentity(value: unknown): { infoHash: string; fileIndex?: number } | undefined {
  if (typeof value !== "string" || value.length > 5_000) {
    return undefined;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) {
      return undefined;
    }
    const segments = url.pathname.split("/").filter(Boolean);
    let hashIndex = -1;
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      if (/^[a-f0-9]{40}$/i.test(segments[index])) {
        hashIndex = index;
        break;
      }
    }
    if (hashIndex < 0) {
      return undefined;
    }
    const rawFileIndex = segments[hashIndex + 2];
    const fileIndex = rawFileIndex && /^\d{1,8}$/.test(rawFileIndex)
      ? Number(rawFileIndex)
      : undefined;
    return {
      infoHash: segments[hashIndex],
      fileIndex: Number.isSafeInteger(fileIndex) ? fileIndex : undefined
    };
  } catch {
    return undefined;
  }
}

export function rankTorrentSources(
  sources: TorrentSource[],
  preferences: { preferredQuality: PreferredQuality; maxSizeGb: number; minSeeders: number }
): TorrentSource[] {
  const maxBytes = preferences.maxSizeGb > 0 ? preferences.maxSizeGb * 1024 ** 3 : Number.POSITIVE_INFINITY;
  return sortTorrentSources(sources
    .filter((source) => source.sizeBytes === undefined || source.sizeBytes <= maxBytes)
    .filter((source) => source.seeders === undefined || source.seeders >= preferences.minSeeders));
}

function parseSizeBytes(value: string): number | undefined {
  const match = value.match(/(\d+(?:[.,]\d+)?)\s*(TB|TiB|GB|GiB|MB|MiB)\b/i);
  if (!match) {
    return undefined;
  }
  const amount = Number(match[1].replace(",", "."));
  const unit = match[2].toUpperCase();
  const multiplier = unit.startsWith("T") ? 1024 ** 4 : unit.startsWith("G") ? 1024 ** 3 : 1024 ** 2;
  return Number.isFinite(amount) ? Math.round(amount * multiplier) : undefined;
}

function parseSeeders(value: string): number | undefined {
  const patterns = [
    /(?:seed(?:er)?s?|peers?)\s*[:=]?\s*(\d+)/i,
    /[👤👥]\s*(\d+)/u,
    /(\d+)\s*(?:seed(?:er)?s?)\b/i
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) {
      return Number(match[1]);
    }
  }
  return undefined;
}

function parseQuality(value: string): string | undefined {
  const heights = [...value.matchAll(/\b(\d{3,4})[pi]\b/gi)]
    .map((match) => Number(match[1]));
  if (/\b8k\b/i.test(value)) heights.push(4320);
  if (/\b(?:4k|uhd)\b/i.test(value)) heights.push(2160);
  if (/\bfhd\b/i.test(value)) heights.push(1080);
  const highest = Math.max(0, ...heights);
  return highest > 0 ? `${highest}p` : undefined;
}

function parseCodec(value: string): string | undefined {
  const match = value.match(/\b(AV1|HEVC|H[.\s-]?265|H[.\s-]?264|X265|X264|VC-1)\b/i);
  return match?.[1].replace(/[.\s-]/g, "").toUpperCase();
}

function parseHdr(value: string): string | undefined {
  const matches = value.match(/\b(DV|DOLBY[.\s-]?VISION|HDR10\+?|HDR)\b/gi);
  return matches ? [...new Set(matches.map((match) => match.toUpperCase().replace(/[.\s-]/g, " ")))].join(" / ") : undefined;
}

function parseAudio(value: string): string | undefined {
  const match = value.match(/\b(ATMOS|TRUEHD|DTS(?:-HD)?(?:\s*MA)?|EAC3|DDP(?:\s*5[.\s]1)?|AC3|AAC)\b/i);
  return match?.[1].toUpperCase();
}

const AUDIO_LANGUAGE_FLAGS: ReadonlyArray<readonly [string, string]> = [
  ["🇬🇧", "English"],
  ["🇺🇸", "English"],
  ["🇯🇵", "Japanese"],
  ["🇷🇺", "Russian"],
  ["🇮🇹", "Italian"],
  ["🇵🇹", "Portuguese"],
  ["🇧🇷", "Portuguese"],
  ["🇪🇸", "Spanish"],
  ["🇲🇽", "Spanish"],
  ["🇰🇷", "Korean"],
  ["🇨🇳", "Chinese"],
  ["🇹🇼", "Chinese"],
  ["🇫🇷", "French"],
  ["🇩🇪", "German"],
  ["🇳🇱", "Dutch"],
  ["🇮🇳", "Hindi"],
  ["🇵🇱", "Polish"],
  ["🇱🇹", "Lithuanian"],
  ["🇱🇻", "Latvian"],
  ["🇪🇪", "Estonian"],
  ["🇨🇿", "Czech"],
  ["🇸🇰", "Slovak"],
  ["🇸🇮", "Slovenian"],
  ["🇭🇺", "Hungarian"],
  ["🇷🇴", "Romanian"],
  ["🇧🇬", "Bulgarian"],
  ["🇷🇸", "Serbian"],
  ["🇭🇷", "Croatian"],
  ["🇺🇦", "Ukrainian"],
  ["🇬🇷", "Greek"],
  ["🇩🇰", "Danish"],
  ["🇫🇮", "Finnish"],
  ["🇸🇪", "Swedish"],
  ["🇳🇴", "Norwegian"],
  ["🇹🇷", "Turkish"],
  ["🇸🇦", "Arabic"],
  ["🇮🇷", "Persian"],
  ["🇮🇱", "Hebrew"],
  ["🇻🇳", "Vietnamese"],
  ["🇮🇩", "Indonesian"],
  ["🇲🇾", "Malay"],
  ["🇹🇭", "Thai"]
];

function parseAudioLanguages(stream: StremioStream, provider: string): string[] | undefined {
  const rawText = [
    typeof stream.title === "string" ? stream.title : "",
    typeof stream.description === "string" ? stream.description : "",
    parseBehaviorFilename(stream.behaviorHints) ?? ""
  ].join("\n");
  const detected = AUDIO_LANGUAGE_FLAGS
    .filter(([flag]) => rawText.includes(flag))
    .map(([, language]) => language);
  const unique = [...new Set(detected)];

  if (unique.includes("English")) {
    return ["English", ...unique.filter((language) => language !== "English")];
  }
  if (unique.length > 0) {
    return unique;
  }

  // Torrentio intentionally omits its language line when English is the only
  // detected language. Multi/dual-audio releases are also presented as English
  // because that is the useful track indicator in the compact source card.
  if (/multi[\s._-]*audio|dual[\s._-]*audio/i.test(rawText) || provider.toLowerCase() === "torrentio") {
    return ["English"];
  }
  return undefined;
}

function parseReleaseGroup(value: string): string | undefined {
  const match = value.match(/-([A-Za-z0-9][A-Za-z0-9._-]{1,20})(?:\s|$)/);
  return match?.[1];
}
