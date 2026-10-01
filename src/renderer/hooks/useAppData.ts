import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppSettings } from "../../main/settingsService";
import type { WorkflowProfile, WorkflowProfileDraft } from "../../main/workflowProfileService";
import { formatError } from "../format";
import type { ProviderKeyStatus } from "../providerKeys";

export interface ApiKeyInput {
  geminiApiKey?: string;
  vercelApiKey?: string;
}

/**
 * Settings, provider key status and workflow profiles shared by every page.
 * `reportError` receives load failures and is cleared (with undefined) before each save;
 * it must be stable (a state setter), since the data loads when it is first seen.
 */
export function useAppData(reportError: (message: string | undefined) => void) {
  const api = window.subtitleTranslator;
  const [settings, setSettings] = useState<AppSettings>();
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [hasVercelKey, setHasVercelKey] = useState(false);
  const [workflowProfiles, setWorkflowProfiles] = useState<WorkflowProfile[]>([]);

  useEffect(() => {
    void api.getSettings().then(setSettings, (error) => {
      reportError(`Could not load settings: ${formatError(error)}`);
    });
    void Promise.all([api.hasGeminiApiKey(), api.hasVercelApiKey(), api.getWorkflowProfiles()]).then(
      ([geminiKeyExists, vercelKeyExists, profiles]) => {
        setHasGeminiKey(geminiKeyExists);
        setHasVercelKey(vercelKeyExists);
        setWorkflowProfiles(profiles);
      },
      (error) => reportError(`Could not restore all saved app data: ${formatError(error)}`)
    );
  }, [api, reportError]);

  /** Persists settings and adopts the normalized copy the main process returns. */
  const persistSettings = useCallback(async (next: AppSettings): Promise<AppSettings> => {
    const saved = await api.saveSettings(next);
    setSettings(saved);
    return saved;
  }, [api]);

  const saveSettings = useCallback(async (next: AppSettings, apiKeys?: ApiKeyInput): Promise<void> => {
    reportError(undefined);
    const saved = await api.saveSettings(next);
    const geminiApiKey = apiKeys?.geminiApiKey?.trim();
    if (geminiApiKey) {
      await api.setGeminiApiKey(geminiApiKey);
      setHasGeminiKey(true);
    }
    const vercelApiKey = apiKeys?.vercelApiKey?.trim();
    if (vercelApiKey) {
      await api.setVercelApiKey(vercelApiKey);
      setHasVercelKey(true);
    }
    setSettings(saved);
  }, [api, reportError]);

  const saveWorkflowProfile = useCallback(async (draft: WorkflowProfileDraft): Promise<WorkflowProfile> => {
    reportError(undefined);
    const saved = await api.saveWorkflowProfile(draft);
    setWorkflowProfiles((current) => current.some((profile) => profile.id === saved.id)
      ? current.map((profile) => profile.id === saved.id ? saved : profile)
      : [...current, saved]);
    return saved;
  }, [api, reportError]);

  const deleteWorkflowProfile = useCallback(async (id: string): Promise<void> => {
    reportError(undefined);
    await api.deleteWorkflowProfile(id);
    setWorkflowProfiles((current) => current.filter((profile) => profile.id !== id));
  }, [api, reportError]);

  const keys = useMemo<ProviderKeyStatus>(() => ({ hasGeminiKey, hasVercelKey }), [hasGeminiKey, hasVercelKey]);

  return {
    settings,
    setSettings,
    persistSettings,
    saveSettings,
    keys,
    workflowProfiles,
    saveWorkflowProfile,
    deleteWorkflowProfile
  };
}
