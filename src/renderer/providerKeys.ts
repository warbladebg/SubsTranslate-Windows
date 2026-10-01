import type { AppSettings } from "../main/settingsService";

export interface ProviderKeyStatus {
  hasGeminiKey: boolean;
  hasVercelKey: boolean;
}

type ProviderId = AppSettings["providerId"];

/** Whether the provider can run; the local mock provider needs no key. */
export function hasProviderKey(providerId: ProviderId, keys: ProviderKeyStatus): boolean {
  if (providerId === "gemini") return keys.hasGeminiKey;
  if (providerId === "vercel") return keys.hasVercelKey;
  return true;
}

/** Explains which API key is missing for the provider, or undefined when it can run. */
export function missingProviderKeyError(
  providerId: ProviderId,
  keys: ProviderKeyStatus,
  context: "run" | "batch" = "run"
): string | undefined {
  if (hasProviderKey(providerId, keys)) return undefined;
  const [keyName, providerName] = providerId === "gemini"
    ? ["Gemini API key", "Gemini"]
    : ["Vercel AI Gateway API key", "Vercel"];
  return context === "batch"
    ? `${keyName} is missing. Add it in Settings before continuing the batch.`
    : `${keyName} is missing. Add it in Settings before using ${providerName}.`;
}
