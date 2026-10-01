import { audioTransformProfiles, type AudioProfileId } from "../core/media/AudioProfiles";

export const AUDIO_PROFILE_SLOTS_KEY = "substranslate:audio-profile-slots";
export const DEFAULT_AUDIO_PROFILE_SLOTS: AudioProfileId[] = ["ac3-5-1", "eac3-5-1", "aac-stereo", "custom-mp3-2-256"];
const knownProfileIds = new Set<string>(audioTransformProfiles.filter((profile) => profile.codec !== "copy").map((profile) => profile.id));

export function normalizeAudioProfileSlots(value: unknown): AudioProfileId[] {
  if (
    !Array.isArray(value)
    || value.length !== 4
    || value.some((id) => typeof id !== "string" || !knownProfileIds.has(id))
    || new Set(value).size !== 4
  ) {
    return [...DEFAULT_AUDIO_PROFILE_SLOTS];
  }
  return value as AudioProfileId[];
}

export function readAudioProfileSlots(): AudioProfileId[] {
  try {
    return normalizeAudioProfileSlots(JSON.parse(window.localStorage.getItem(AUDIO_PROFILE_SLOTS_KEY) ?? "null"));
  } catch {
    return [...DEFAULT_AUDIO_PROFILE_SLOTS];
  }
}
