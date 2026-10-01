export type AudioCodec = "aac" | "ac3" | "eac3" | "mp3" | "opus" | "vorbis" | "flac" | "alac";
export type AudioProfileId = "copy" | "ac3-5-1" | "eac3-5-1" | "aac-stereo"
  | `custom-${AudioCodec}-${2 | 6}-${number | "lossless"}`;

export const audioGainLimits = {
  minimumDb: -6,
  maximumDb: 6,
  stepDb: 0.5
} as const;

export function validateAudioGainDb(value: number | undefined): number {
  const gainDb = value ?? 0;
  if (!Number.isFinite(gainDb) || gainDb < audioGainLimits.minimumDb || gainDb > audioGainLimits.maximumDb) {
    throw new Error(`Volume adjustment must be between ${audioGainLimits.minimumDb} dB and +${audioGainLimits.maximumDb} dB.`);
  }
  return Object.is(gainDb, -0) ? 0 : gainDb;
}

export interface AudioTransformProfile {
  id: AudioProfileId;
  label: string;
  codec: "copy" | AudioCodec;
  encoder?: string;
  channels?: number;
  bitRate?: string;
  sampleRate?: number;
  outputTitle: string;
  fileSuffix: string;
}

const defaultAudioProfiles: AudioTransformProfile[] = [
  {
    id: "copy",
    label: "Keep Original Audio",
    codec: "copy",
    outputTitle: "Original audio",
    fileSuffix: "remux"
  },
  {
    id: "ac3-5-1",
    label: "Dolby Digital 5.1",
    codec: "ac3",
    channels: 6,
    bitRate: "640k",
    sampleRate: 48_000,
    outputTitle: "Dolby Digital 5.1",
    fileSuffix: "dd-5.1"
  },
  {
    id: "eac3-5-1",
    label: "Dolby Digital Plus 5.1",
    codec: "eac3",
    channels: 6,
    bitRate: "768k",
    sampleRate: 48_000,
    outputTitle: "Dolby Digital Plus 5.1",
    fileSuffix: "ddp-5.1"
  },
  {
    id: "aac-stereo",
    label: "AAC Stereo",
    codec: "aac",
    channels: 2,
    bitRate: "192k",
    sampleRate: 48_000,
    outputTitle: "AAC Stereo",
    fileSuffix: "aac-stereo"
  }
];

interface AudioFormatChoice {
  codec: AudioCodec;
  encoder: string;
  label: string;
  stereoRates: readonly number[];
  surroundRates: readonly number[];
}

// These encoders are bundled with FFmpeg and work with the media workflow's
// channel layouts. Container compatibility is checked before conversion.
const audioFormatChoices: readonly AudioFormatChoice[] = [
  { codec: "aac", encoder: "aac", label: "AAC", stereoRates: [96, 128, 160, 192, 256, 320], surroundRates: [384, 448, 512] },
  { codec: "ac3", encoder: "ac3", label: "Dolby Digital", stereoRates: [192, 256, 384], surroundRates: [384, 448, 640] },
  { codec: "eac3", encoder: "eac3", label: "Dolby Digital Plus", stereoRates: [192, 256, 384], surroundRates: [384, 640, 768] },
  { codec: "mp3", encoder: "libmp3lame", label: "MP3", stereoRates: [128, 160, 192, 256, 320], surroundRates: [] },
  { codec: "opus", encoder: "libopus", label: "Opus", stereoRates: [96, 128, 160, 192, 256], surroundRates: [256, 384, 512] },
  { codec: "vorbis", encoder: "libvorbis", label: "Vorbis", stereoRates: [128, 160, 192, 256], surroundRates: [384, 512] },
  { codec: "flac", encoder: "flac", label: "FLAC", stereoRates: [], surroundRates: [] },
  { codec: "alac", encoder: "alac", label: "Apple Lossless", stereoRates: [], surroundRates: [] }
];

const configurableAudioProfiles: AudioTransformProfile[] = audioFormatChoices.flatMap((format) =>
  ([2, 6] as const).flatMap((channels) => {
    const rates = channels === 2 ? format.stereoRates : format.surroundRates;
    const choices = rates.length ? rates : format.codec === "flac" || format.codec === "alac" ? [0] : [];
    return choices.map((rate) => {
      const layout = channels === 2 ? "Stereo" : "5.1";
      const rateLabel = rate ? `${rate} kbps` : "Lossless";
      return {
        id: `custom-${format.codec}-${channels}-${rate || "lossless"}` as AudioProfileId,
        label: `${format.label} ${layout} · ${rateLabel}`,
        codec: format.codec,
        encoder: format.encoder,
        channels,
        bitRate: rate ? `${rate}k` : undefined,
        sampleRate: 48_000,
        outputTitle: `${format.label} ${layout}`,
        fileSuffix: `${format.codec}-${channels === 2 ? "stereo" : "5.1"}-${rate || "lossless"}`
      };
    });
  })
);

export const audioTransformProfiles: AudioTransformProfile[] = [
  ...defaultAudioProfiles,
  ...configurableAudioProfiles.filter((profile) => !defaultAudioProfiles.some((preset) =>
    preset.codec === profile.codec && preset.channels === profile.channels && preset.bitRate === profile.bitRate
  ))
];
