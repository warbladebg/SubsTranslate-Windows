export type MediaContainerId = "mkv" | "mp4" | "mov";

export interface MediaContainerProfile {
  id: MediaContainerId;
  label: string;
  extension: ".mkv" | ".mp4" | ".mov";
  description: string;
  subtitleCodec: "copy" | "mov_text";
  supportsReplaceOriginal: boolean;
  ffprobeFormatNames: string[];
}

export const mediaContainerProfiles: MediaContainerProfile[] = [
  {
    id: "mkv",
    label: "Matroska (MKV)",
    extension: ".mkv",
    description: "Recommended — preserves every compatible source stream.",
    subtitleCodec: "copy",
    supportsReplaceOriginal: true,
    ffprobeFormatNames: ["matroska", "webm"]
  },
  {
    id: "mp4",
    label: "MPEG-4 (MP4)",
    extension: ".mp4",
    description: "Broad playback support; text subtitles become MP4 text.",
    subtitleCodec: "mov_text",
    supportsReplaceOriginal: false,
    ffprobeFormatNames: ["mov", "mp4", "m4a", "3gp", "3g2", "mj2"]
  },
  {
    id: "mov",
    label: "QuickTime (MOV)",
    extension: ".mov",
    description: "Editing-friendly; text subtitles become QuickTime text.",
    subtitleCodec: "mov_text",
    supportsReplaceOriginal: false,
    ffprobeFormatNames: ["mov", "mp4", "m4a", "3gp", "3g2", "mj2"]
  }
];

export function getMediaContainerProfile(containerId: MediaContainerId): MediaContainerProfile {
  const profile = mediaContainerProfiles.find((item) => item.id === containerId);
  if (!profile) {
    throw new Error(`Unknown output format: ${containerId}`);
  }
  return profile;
}
