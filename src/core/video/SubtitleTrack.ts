import { SubtitleFormat } from "../subtitle/SubtitleCue";

export interface SubtitleTrack {
  index: number;
  codecName: string;
  codecType: "subtitle";
  language: string;
  title: string;
  isSupported: boolean;
  isTextBased: boolean;
  isImageBased: boolean;
  requiresOcr: boolean;
  supportedFormat?: SubtitleFormat;
  reason?: string;
}

export const textSubtitleCodecs: Record<string, SubtitleFormat> = {
  subrip: "srt",
  srt: "srt",
  ass: "ass",
  ssa: "ssa",
  webvtt: "webvtt",
  mov_text: "srt"
};

export const imageSubtitleCodecs = new Set([
  "hdmv_pgs_subtitle",
  "pgssub",
  "dvd_subtitle",
  "dvb_subtitle",
  "xsub",
  "vobsub"
]);

const ocrSubtitleCodecs: Record<string, SubtitleFormat> = {
  hdmv_pgs_subtitle: "pgs",
  pgssub: "pgs"
};

const exportableSubtitleExtensions: Record<string, string> = {
  subrip: "srt",
  srt: "srt",
  ass: "srt",
  ssa: "srt",
  webvtt: "srt",
  mov_text: "srt",
  hdmv_pgs_subtitle: "srt",
  pgssub: "srt"
};

export function classifySubtitleCodec(
  codecName: string
): Pick<SubtitleTrack, "isSupported" | "isTextBased" | "isImageBased" | "requiresOcr" | "supportedFormat" | "reason"> {
  const normalized = codecName.toLowerCase();
  const supportedFormat = textSubtitleCodecs[normalized];
  if (supportedFormat) {
    return {
      isSupported: true,
      isTextBased: true,
      isImageBased: false,
      requiresOcr: false,
      supportedFormat
    };
  }

  const ocrFormat = ocrSubtitleCodecs[normalized];
  if (ocrFormat) {
    return {
      isSupported: true,
      isTextBased: false,
      isImageBased: true,
      requiresOcr: true,
      supportedFormat: ocrFormat,
      reason: "This image-based subtitle track will be extracted and OCR processed before translation."
    };
  }

  if (imageSubtitleCodecs.has(normalized)) {
    return {
      isSupported: false,
      isTextBased: false,
      isImageBased: true,
      requiresOcr: false,
      reason: "This subtitle track is image-based. This version only supports text-based subtitles."
    };
  }

  return {
    isSupported: false,
    isTextBased: false,
    isImageBased: false,
    requiresOcr: false,
    reason: "This subtitle track format is not supported in this version."
  };
}

export function getSubtitleExportExtension(track: Pick<SubtitleTrack, "codecName">): string | undefined {
  return exportableSubtitleExtensions[track.codecName.toLowerCase()];
}

export function canExportSubtitleTrack(track: Pick<SubtitleTrack, "codecName">): boolean {
  return Boolean(getSubtitleExportExtension(track));
}

export function findEnglishSubtitleTrack(tracks: SubtitleTrack[]): SubtitleTrack | undefined {
  return tracks.find((track) => {
    const language = track.language.trim().toLowerCase();
    const title = track.title.trim().toLowerCase();
    return language === "en"
      || language === "eng"
      || language.startsWith("en-")
      || language.startsWith("eng-")
      || /\benglish\b/.test(title);
  });
}
