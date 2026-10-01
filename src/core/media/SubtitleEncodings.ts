import { errorMessage } from "../util/errors";
export type SubtitleEncodingId = "ansi" | "utf-16-le" | "utf-16-be" | "utf-8" | "utf-8-bom";

export interface SubtitleEncodingProfile {
  id: SubtitleEncodingId;
  label: string;
  decoderEncoding: "windows-1251" | "utf-16le" | "utf-16be" | "utf-8";
}

export const subtitleEncodingProfiles: SubtitleEncodingProfile[] = [
  {
    id: "ansi",
    label: "ANSI",
    decoderEncoding: "windows-1251"
  },
  {
    id: "utf-16-le",
    label: "UTF-16 LE",
    decoderEncoding: "utf-16le"
  },
  {
    id: "utf-16-be",
    label: "UTF-16 BE",
    decoderEncoding: "utf-16be"
  },
  {
    id: "utf-8",
    label: "UTF-8",
    decoderEncoding: "utf-8"
  },
  {
    id: "utf-8-bom",
    label: "UTF-8 with BOM",
    decoderEncoding: "utf-8"
  }
];

export function getSubtitleEncodingProfile(encodingId: SubtitleEncodingId): SubtitleEncodingProfile {
  const profile = subtitleEncodingProfiles.find((item) => item.id === encodingId);
  if (!profile) {
    throw new Error(`Unknown subtitle encoding: ${encodingId}`);
  }
  return profile;
}

export function decodeSubtitleBytes(bytes: Uint8Array, encodingId: SubtitleEncodingId): string {
  const profile = getSubtitleEncodingProfile(encodingId);
  try {
    return new TextDecoder(profile.decoderEncoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch (error) {
    throw new Error(
      `The subtitle file is not valid ${profile.label}: ${errorMessage(error)}`,
      { cause: error }
    );
  }
}
