import { useEffect, useState } from "react";
import { AlertCircle, Brain, Cloud, Gauge, KeyRound, Save, Server, Settings, SlidersHorizontal } from "lucide-react";
import type { AppSettings, ManualRateLimits } from "../../main/settingsService";
import { formatError } from "../format";
import type { ApiKeyInput } from "../hooks/useAppData";
import { hasProviderKey } from "../providerKeys";
import { SlidingIndicator } from "./SlidingIndicator";

interface Props {
  settings: AppSettings;
  hasGeminiKey: boolean;
  hasVercelKey: boolean;
  onSave: (settings: AppSettings, apiKeys?: ApiKeyInput) => Promise<void>;
}

type RemoteProviderId = "gemini" | "vercel";

const providerOptions: Array<{
  id: AppSettings["providerId"];
  label: string;
  caption: string;
  Icon: typeof Server;
}> = [
  { id: "mock", label: "Mock", caption: "Local test", Icon: Server },
  { id: "gemini", label: "Gemini", caption: "Google AI", Icon: Brain },
  { id: "vercel", label: "Vercel", caption: "AI Gateway", Icon: Cloud }
];

const REMOTE_PROVIDERS: Record<RemoteProviderId, { keyLabel: string; modelLabel: string; models: string[] }> = {
  gemini: {
    keyLabel: "Gemini API key",
    modelLabel: "Gemini model",
    models: ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3-flash-preview"]
  },
  vercel: {
    keyLabel: "Vercel AI Gateway key",
    modelLabel: "Vercel model",
    models: ["google/gemini-3.1-flash-lite", "google/gemini-3.5-flash-lite"]
  }
};

const MANUAL_LIMIT_FIELDS: Array<{ key: keyof ManualRateLimits; label: string; max?: number }> = [
  { key: "rpmLimit", label: "RPM" },
  { key: "tpmLimit", label: "TPM" },
  { key: "rpdLimit", label: "RPD" },
  { key: "stopAfterDailyPercentage", label: "Stop %", max: 100 },
  { key: "maxConcurrentRequests", label: "Concurrent", max: 4 }
];

const EMPTY_KEYS: Record<RemoteProviderId, string> = { gemini: "", vercel: "" };

export function SettingsPanel({ settings, hasGeminiKey, hasVercelKey, onSave }: Props) {
  const [draft, setDraft] = useState(settings);
  const [apiKeys, setApiKeys] = useState(EMPTY_KEYS);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const remote: RemoteProviderId | undefined = draft.providerId === "mock" ? undefined : draft.providerId;
  const remoteSettings = remote ? draft[remote] : undefined;
  const keySaved = hasProviderKey(draft.providerId, { hasGeminiKey, hasVercelKey });
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings) || Boolean(apiKeys.gemini.trim() || apiKeys.vercel.trim());

  /** Merges a patch into the active remote provider's settings. */
  function updateRemote(patch: Partial<AppSettings["gemini"]>): void {
    if (!remote) return;
    setDraft((current) => ({ ...current, [remote]: { ...current[remote], ...patch } }));
  }

  function updateManual(key: keyof ManualRateLimits, value: number): void {
    if (!remoteSettings) return;
    updateRemote({ manualRateLimits: { ...remoteSettings.manualRateLimits, [key]: value } });
  }

  async function save(): Promise<void> {
    setSaving(true);
    setSaveError(undefined);
    try {
      await onSave(draft, { geminiApiKey: apiKeys.gemini, vercelApiKey: apiKeys.vercel });
      setApiKeys(EMPTY_KEYS);
    } catch (error) {
      setSaveError(formatError(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel settings-panel">
      <div className="panel-header">
        <div>
          <h2><Settings size={17} /> Settings</h2>
          <p>Translation engine, access key and request limits.</p>
        </div>
        <button className={dirty ? "primary-button button-sm" : "text-button button-sm"} onClick={save} disabled={saving} type="button">
          <Save size={15} />
          Save
        </button>
      </div>

      {saveError && (
        <div className="notice error" role="alert">
          <AlertCircle size={16} />
          <span>{saveError}</span>
        </div>
      )}

      <div className="settings-stack">
        <section className="settings-section">
          <div className="provider-switcher" role="group" aria-label="Translation provider">
            <SlidingIndicator />
            {providerOptions.map(({ id, label, caption, Icon }) => (
              <button
                aria-pressed={draft.providerId === id}
                className={`provider-option${draft.providerId === id ? " active" : ""}`}
                key={id}
                onClick={() => setDraft((current) => ({ ...current, providerId: id }))}
                type="button"
              >
                <Icon size={17} />
                <span>
                  <strong>{label}</strong>
                  <small>{caption}</small>
                </span>
              </button>
            ))}
          </div>
        </section>

        {!remote || !remoteSettings ? (
          <p className="settings-summary">The mock provider runs locally for testing and has no remote options.</p>
        ) : (
          <>
            <section className="settings-section">
              <div className="settings-section-header">
                <KeyRound size={16} />
                <h3>Access</h3>
                <span className={keySaved ? "status-pill ok" : "status-pill warn"}>
                  {keySaved ? "Key saved" : "Key missing"}
                </span>
              </div>
              <div className="settings-form-grid">
                <label className="settings-field-wide">
                  {REMOTE_PROVIDERS[remote].keyLabel}
                  <input
                    type="password"
                    value={apiKeys[remote]}
                    onChange={(event) => setApiKeys((current) => ({ ...current, [remote]: event.target.value }))}
                    placeholder="Stored with OS encryption"
                  />
                </label>
              </div>
            </section>

            <section className="settings-section">
              <div className="settings-section-header">
                <SlidersHorizontal size={16} />
                <h3>Model</h3>
              </div>
              <div className="settings-form-grid">
                <label className="settings-field-wide">
                  {REMOTE_PROVIDERS[remote].modelLabel}
                  <input
                    list={`${remote}-models`}
                    value={remoteSettings.modelId}
                    onChange={(event) => updateRemote({ modelId: event.target.value })}
                  />
                  <datalist id={`${remote}-models`}>
                    {REMOTE_PROVIDERS[remote].models.map((model) => <option key={model} value={model} />)}
                  </datalist>
                </label>

                {remote === "gemini" && (
                  <label>
                    Thinking
                    <select
                      value={draft.gemini.thinkingLevel}
                      onChange={(event) => updateRemote({ thinkingLevel: event.target.value as AppSettings["gemini"]["thinkingLevel"] })}
                    >
                      <option value="auto">Automatic</option>
                      <option value="minimal">Minimal</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </label>
                )}

                <label>
                  Temperature
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.1"
                    value={remoteSettings.temperature}
                    onChange={(event) => updateRemote({ temperature: Number(event.target.value) })}
                  />
                </label>

                <label className="settings-field-wide">
                  Max output tokens
                  <input
                    type="number"
                    min="256"
                    step="256"
                    value={remoteSettings.maxOutputTokens}
                    onChange={(event) => updateRemote({ maxOutputTokens: Number(event.target.value) })}
                  />
                </label>
              </div>
            </section>

            <section className="settings-section">
              <div className="settings-section-header">
                <Gauge size={16} />
                <h3>Rate Limits</h3>
              </div>
              <div className="settings-form-grid">
                <label className="settings-field-wide">
                  Mode
                  <select
                    value={remoteSettings.rateLimitMode}
                    onChange={(event) => updateRemote({ rateLimitMode: event.target.value as AppSettings["gemini"]["rateLimitMode"] })}
                  >
                    <option value="auto-safe">Auto-safe</option>
                    <option value="manual">Manual limits</option>
                    <option value="aggressive">Aggressive</option>
                  </select>
                </label>
              </div>

              {remoteSettings.rateLimitMode === "manual" && (
                <div className="settings-manual-grid">
                  {MANUAL_LIMIT_FIELDS.map(({ key, label, max }) => (
                    <label key={key}>
                      {label}
                      <input
                        type="number"
                        min="1"
                        max={max}
                        value={remoteSettings.manualRateLimits[key]}
                        onChange={(event) => updateManual(key, Number(event.target.value))}
                      />
                    </label>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </section>
  );
}
