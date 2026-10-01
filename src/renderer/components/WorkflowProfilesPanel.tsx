import { Languages, Pencil, Plus, Save, Trash2, X, Zap, Music2, Clapperboard } from "lucide-react";
import { useState } from "react";
import { audioGainLimits, audioTransformProfiles } from "../../core/media/AudioProfiles";
import { mediaContainerProfiles } from "../../core/media/MediaContainers";
import { subtitleEncodingProfiles } from "../../core/media/SubtitleEncodings";
import { cloneSettings, createWorkflowProfileDraft } from "../../core/workflow/WorkflowProfiles";
import type { AppSettings } from "../../main/settingsService";
import { formatError } from "../format";
import type {
  WorkflowMediaSection,
  WorkflowProfile,
  WorkflowProfileDraft,
  WorkflowTranslationSection
} from "../../main/workflowProfileService";

interface WorkflowProfilesPanelProps {
  initialProfile?: WorkflowProfile;
  editorOnly?: boolean;
  onClose?: () => void;
  currentSettings: AppSettings;
  profiles: WorkflowProfile[];
  onSave: (draft: WorkflowProfileDraft) => Promise<WorkflowProfile>;
  onDelete: (id: string) => Promise<void>;
}

export function WorkflowProfilesPanel({ currentSettings, profiles, onSave, onDelete, initialProfile, editorOnly, onClose }: WorkflowProfilesPanelProps) {
  const [editor, setEditor] = useState<WorkflowProfileDraft | undefined>(() => initialProfile ? cloneAsDraft(initialProfile) : editorOnly ? createWorkflowProfileDraft(currentSettings) : undefined);
  const [saving, setSaving] = useState(false);
  const [profileError, setProfileError] = useState<string>();

  async function save(): Promise<void> {
    if (
      !editor
      || !editor.name.trim()
      || (!editor.config.translation.enabled && !editor.config.media.enabled)
    ) {
      return;
    }
    setSaving(true);
    setProfileError(undefined);
    try {
      await onSave(editor);
      setEditor(undefined);
      onClose?.();
    } catch (error) {
      setProfileError(formatError(error));
    } finally {
      setSaving(false);
    }
  }

  async function deleteEditedProfile(): Promise<void> {
    if (!editor?.id || !window.confirm(`Delete workflow “${editor.name}”?`)) return;
    setSaving(true);
    setProfileError(undefined);
    try {
      await onDelete(editor.id);
      onClose?.();
    } catch (error) {
      setProfileError(formatError(error));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string): Promise<void> {
    setProfileError(undefined);
    try {
      await onDelete(id);
      if (editor?.id === id) setEditor(undefined);
    } catch (error) {
      setProfileError(formatError(error));
    }
  }

  return (
    <section className="settings-section workflow-profiles-settings provider-section">
      {!editorOnly && <>
      <div className="settings-section-header">
        <Zap size={16} />
        <h3>Workflow Profiles</h3>
        <span className="status-pill ok">{profiles.length} saved</span>
      </div>
      <p className="settings-section-description">
        Saved settings for translation, audio and media output.
      </p>

      {profiles.length > 0 && (
        <div className="workflow-profile-list">
          {profiles.map((profile) => (
            <div className="workflow-profile-card" key={profile.id}>
              <span className="workflow-profile-kind workflow" aria-hidden="true"><Zap size={15} /></span>
              <div>
                <strong>{profile.name}</strong>
                <small>{profileSummary(profile)}</small>
              </div>
              <button className="icon-button" onClick={() => setEditor(cloneAsDraft(profile))} title={`Edit ${profile.name}`} type="button">
                <Pencil size={14} />
              </button>
              <button className="icon-button danger-icon" onClick={() => remove(profile.id)} title={`Delete ${profile.name}`} type="button">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      </>}
      {profileError && <div className="batch-match-warning">{profileError}</div>}

      {!editorOnly && !editor && (
        <div className="workflow-profile-create-row">
          <button className="text-button" onClick={() => setEditor(createWorkflowProfileDraft(currentSettings))} type="button">
            <Plus size={15} />
            New workflow profile
          </button>
        </div>
      )}

      {editor && (
        <div className="workflow-profile-editor unified-workflow-editor">
          <div className="workflow-profile-editor-header">
            <strong>{editor.id ? "Edit workflow profile" : "New workflow profile"}</strong>
            <button className="icon-button" onClick={() => { setEditor(undefined); onClose?.(); }} title="Close profile editor" aria-label="Close profile editor" type="button">
              <X size={16} />
            </button>
          </div>

          <label className="field">
            Profile name
            <input
              autoFocus
              maxLength={60}
              value={editor.name}
              onChange={(event) => setEditor({ ...editor, name: event.target.value })}
              placeholder="TV English to Bulgarian"
            />
          </label>

          <TranslationSection editor={editor} currentSettings={currentSettings} onChange={setEditor} />
          <MediaSection editor={editor} onChange={setEditor} />

          {!editor.config.translation.enabled && !editor.config.media.enabled && (
            <div className="batch-match-warning">Enable Translation or Media output to make this profile runnable.</div>
          )}

          <div className="button-row workflow-profile-editor-actions">
            <button
              className="primary-button"
              onClick={save}
              disabled={
                !editor.name.trim()
                || saving
                || (!editor.config.translation.enabled && !editor.config.media.enabled)
              }
              type="button"
            >
              <Save size={15} />
              {saving ? "Saving…" : "Save profile"}
            </button>
            {editorOnly && editor.id && (
              <button className="text-button" type="button" disabled={saving} onClick={deleteEditedProfile}>
                <Trash2 size={15} /> Delete workflow
              </button>
            )}
            <span className="field-hint">File paths and API keys are never stored.</span>
          </div>
        </div>
      )}
    </section>
  );
}

function TranslationSection({
  editor,
  currentSettings,
  onChange
}: {
  editor: WorkflowProfileDraft;
  currentSettings: AppSettings;
  onChange: (draft: WorkflowProfileDraft) => void;
}) {
  const section = editor.config.translation;
  const update = (updates: Partial<WorkflowTranslationSection>): void => {
    onChange({
      ...editor,
      config: { ...editor.config, translation: { ...section, ...updates } }
    });
  };
  const updateSettings = (updates: Partial<AppSettings>): void => {
    update({ settings: { ...section.settings, ...updates } });
  };

  return (
    <section className={`workflow-part-card${section.enabled ? " enabled" : ""}`}>
      <div className="workflow-part-header">
        <span><Languages size={16} /><strong>Translation</strong></span>
        <label className="workflow-part-toggle">
          <input
            aria-label="Enable translation"
            className="switch"
            type="checkbox"
            checked={section.enabled}
            onChange={(event) => update({ enabled: event.target.checked })}
          />
          {section.enabled ? "Enabled" : "Disabled"}
        </label>
      </div>
      <p>Create Bulgarian subtitles from an embedded subtitle track.</p>

      {section.enabled && (
        <div className="settings-form-grid">
          <label>
            Provider
            <select value={section.settings.providerId} onChange={(event) => updateSettings({ providerId: event.target.value as AppSettings["providerId"] })}>
              <option value="mock">Mock</option>
              <option value="gemini">Gemini</option>
              <option value="vercel">Vercel AI Gateway</option>
            </select>
          </label>
          <label>
            Context
            <select value={section.settings.contextMode} onChange={(event) => updateSettings({ contextMode: event.target.value as AppSettings["contextMode"] })}>
              <option value="auto">Auto scene-aware</option>
              <option value="minimal">Minimal</option>
              <option value="larger">Larger</option>
            </select>
          </label>
          <label>
            Track to translate
            <select
              value={section.trackPreference}
              onChange={(event) => update({ trackPreference: event.target.value as WorkflowTranslationSection["trackPreference"] })}
            >
              <option value="english">English track</option>
              <option value="selected">Currently selected / first supported</option>
            </select>
          </label>
          {!editor.config.media.enabled ? (
            <>
              <label>
                Sample
                <select value={section.sampleMode} onChange={(event) => update({ sampleMode: event.target.value as WorkflowTranslationSection["sampleMode"] })}>
                  <option value="none">Full file</option>
                  <option value="first20">First 20 cues</option>
                  <option value="firstScene">First scene</option>
                  <option value="first3Minutes">First 3 minutes</option>
                </select>
              </label>
              <label>
                If subtitle file exists
                <select
                  value={section.settings.outputConflictMode}
                  onChange={(event) => updateSettings({ outputConflictMode: event.target.value as AppSettings["outputConflictMode"] })}
                >
                  <option value="versioned">Create versioned filename</option>
                  <option value="overwrite">Overwrite</option>
                  <option value="cancel">Cancel</option>
                </select>
              </label>
            </>
          ) : (
            <div className="workflow-profile-snapshot settings-field-wide">
              Full subtitle track · the translated result is passed directly to Media output.
            </div>
          )}
          <div className="workflow-profile-snapshot settings-field-wide">
            <span>{translationSnapshotSummary(section.settings)}</span>
            <button
              className="text-button"
              onClick={() => update({
                settings: {
                  ...cloneSettings(currentSettings),
                  batchUnlocked: currentSettings.batchUnlocked
                }
              })}
              type="button"
            >
              Use current translation settings
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function MediaSection({
  editor,
  onChange
}: {
  editor: WorkflowProfileDraft;
  onChange: (draft: WorkflowProfileDraft) => void;
}) {
  const section = editor.config.media;
  const update = (updates: Partial<WorkflowMediaSection>): void => {
    onChange({
      ...editor,
      config: { ...editor.config, media: { ...section, ...updates } }
    });
  };

  return (
    <section className={`workflow-part-card${section.enabled ? " enabled" : ""}`}>
      <div className="workflow-part-header">
        <span><Clapperboard size={16} /><strong>Media output</strong></span>
        <label className="workflow-part-toggle">
          <input
            aria-label="Enable media output"
            className="switch"
            type="checkbox"
            checked={section.enabled}
            onChange={(event) => update({ enabled: event.target.checked })}
          />
          {section.enabled ? "Enabled" : "Disabled"}
        </label>
      </div>
      <p>Build a processed video. Audio and subtitles can be enabled independently.</p>

      {section.enabled && (
        <div className="settings-form-grid">
          <div className="workflow-subpart-toggle settings-field-wide">
            <label>
              <input
                aria-label="Process audio"
                type="checkbox"
                checked={section.audioEnabled}
                onChange={(event) => update({ audioEnabled: event.target.checked })}
              />
              <Music2 size={15} /> Process audio
            </label>
            <small>When disabled, the original audio streams are copied unchanged.</small>
          </div>
          {section.audioEnabled && (
            <>
              <label>
                Audio format
                <select value={section.audioProfileId} onChange={(event) => update({ audioProfileId: event.target.value as WorkflowMediaSection["audioProfileId"] })}>
                  {audioTransformProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
                </select>
              </label>
              <label>
                Volume
                <input
                  type="number"
                  min={audioGainLimits.minimumDb}
                  max={audioGainLimits.maximumDb}
                  step={audioGainLimits.stepDb}
                  value={section.audioGainDb}
                  onChange={(event) => update({ audioGainDb: Number(event.target.value) })}
                  disabled={section.audioProfileId === "copy"}
                />
              </label>
            </>
          )}
          <div className="workflow-subpart-toggle settings-field-wide">
            <label>
              <input
                aria-label="Keep only selected audio track"
                type="checkbox"
                checked={section.keepOnlySelectedAudioTrack}
                onChange={(event) => update({ keepOnlySelectedAudioTrack: event.target.checked })}
              />
              <Music2 size={15} /> Keep only selected audio track
            </label>
            <small>Removes every other audio track from the processed output. The source is untouched unless Replace original MKV is selected.</small>
          </div>

          <div className="workflow-subpart-toggle settings-field-wide">
            <label>
              <input
                aria-label="Include subtitles"
                type="checkbox"
                checked={section.subtitlesEnabled}
                onChange={(event) => update({ subtitlesEnabled: event.target.checked })}
              />
              <Languages size={15} /> Include subtitles
            </label>
            <small>
              {editor.config.translation.enabled
                ? "Embeds the translated Bulgarian subtitle automatically."
                : "Uses the subtitle file selected on the Media page."}
            </small>
          </div>

          {section.subtitlesEnabled && !editor.config.translation.enabled && (
            <label className="settings-field-wide">
              Existing subtitle encoding
              <select value={section.subtitleEncodingId} onChange={(event) => update({ subtitleEncodingId: event.target.value as WorkflowMediaSection["subtitleEncodingId"] })}>
                {subtitleEncodingProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
              </select>
            </label>
          )}
          {section.subtitlesEnabled && (
            <div className="workflow-subpart-toggle settings-field-wide">
              <label>
                <input
                  aria-label="Keep only added subtitle track"
                  type="checkbox"
                  checked={section.keepOnlyNewSubtitleTrack}
                  onChange={(event) => update({ keepOnlyNewSubtitleTrack: event.target.checked })}
                />
                <Languages size={15} /> Keep only added subtitle track
              </label>
              <small>Removes embedded subtitle tracks and keeps only the Bulgarian subtitle added by this workflow.</small>
            </div>
          )}

          <label>
            Output
            <select
              value={section.outputMode}
              onChange={(event) => {
                const outputMode = event.target.value as WorkflowMediaSection["outputMode"];
                update({ outputMode, ...(outputMode === "replace-original" ? { outputContainerId: "mkv" } : {}) });
              }}
            >
              <option value="new-file">Create new file</option>
              <option value="replace-original">Replace original MKV</option>
            </select>
          </label>
          {section.outputMode === "new-file" && (
            <>
              <label>
                Media format
                <select value={section.outputContainerId} onChange={(event) => update({ outputContainerId: event.target.value as WorkflowMediaSection["outputContainerId"] })}>
                  {mediaContainerProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
                </select>
              </label>
              <label className="settings-field-wide">
                If output file already exists
                <select value={section.outputConflictMode} onChange={(event) => update({ outputConflictMode: event.target.value as WorkflowMediaSection["outputConflictMode"] })}>
                  <option value="versioned">Create versioned filename</option>
                  <option value="overwrite">Overwrite</option>
                  <option value="cancel">Cancel</option>
                </select>
              </label>
            </>
          )}
          {section.outputMode === "replace-original" && (
            <div className="workflow-profile-snapshot settings-field-wide">
              The original MKV is replaced safely after the processed temporary file is complete.
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function cloneAsDraft(profile: WorkflowProfile): WorkflowProfileDraft {
  return JSON.parse(JSON.stringify(profile)) as WorkflowProfileDraft;
}

export function profileSummary(profile: WorkflowProfile): string {
  const parts: string[] = [];
  if (profile.config.translation.enabled) {
    const track = profile.config.translation.trackPreference === "english" ? "English → Bulgarian" : "selected track → Bulgarian";
    parts.push(track);
  }
  if (profile.config.media.enabled) {
    if (profile.config.media.audioEnabled) {
      const audio = audioTransformProfiles.find((item) => item.id === profile.config.media.audioProfileId)?.label
        ?? profile.config.media.audioProfileId;
      parts.push(audio);
    } else {
      parts.push("original audio");
    }
    if (profile.config.media.keepOnlySelectedAudioTrack) parts.push("selected audio only");
    if (profile.config.media.subtitlesEnabled) parts.push("subtitles included");
    if (profile.config.media.keepOnlyNewSubtitleTrack) parts.push("new subtitle only");
    parts.push(profile.config.media.outputMode === "replace-original"
      ? "replace MKV"
      : mediaContainerProfiles.find((item) => item.id === profile.config.media.outputContainerId)?.label
        ?? profile.config.media.outputContainerId);
  }
  return parts.join(" · ");
}

function translationSnapshotSummary(settings: AppSettings): string {
  const provider = settings.providerId;
  const model = provider === "vercel" ? settings.vercel.modelId : provider === "gemini" ? settings.gemini.modelId : "local mock";
  const rate = provider === "vercel" ? settings.vercel.rateLimitMode : settings.gemini.rateLimitMode;
  return `${model} · ${rate}`;
}
