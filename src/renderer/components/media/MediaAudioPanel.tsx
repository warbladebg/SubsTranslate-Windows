import { Music2, Pencil } from "lucide-react";
import { audioGainLimits, audioTransformProfiles, type AudioProfileId } from "../../../core/media/AudioProfiles";
import type { ProbeResult } from "../../../core/video/ProbeResult";
import { AppSelect } from "../AppSelect";
import { AudioProfileEditor } from "../AudioProfileEditor";
import { formatAudioTrack, formatGainDb, formatProfileDetails } from "./mediaFormatting";
import { findAudioProfile } from "./mediaWorkflowRequests";

interface MediaAudioPanelProps {
  isBatchMode: boolean;
  manual: boolean;
  locked: boolean;
  probe?: ProbeResult;
  audioTrackIndex?: number;
  audioProfileId: AudioProfileId;
  audioProfileSlots: AudioProfileId[];
  editingAudioProfiles: boolean;
  keepOnlySelectedAudioTrack: boolean;
  audioGainDb: number;
  onAudioTrackChange: (index: number | undefined) => void;
  onAudioProfileChange: (id: AudioProfileId) => void;
  onEditAudioProfiles: () => void;
  onSaveAudioProfileSlots: (slots: AudioProfileId[]) => void;
  onCancelAudioProfileEdit: () => void;
  onKeepOnlySelectedAudioTrackChange: (value: boolean) => void;
  onAudioGainChange: (value: number) => void;
}

export function MediaAudioPanel({
  isBatchMode,
  manual,
  locked,
  probe,
  audioTrackIndex,
  audioProfileId,
  audioProfileSlots,
  editingAudioProfiles,
  keepOnlySelectedAudioTrack,
  audioGainDb,
  onAudioTrackChange,
  onAudioProfileChange,
  onEditAudioProfiles,
  onSaveAudioProfileSlots,
  onCancelAudioProfileEdit,
  onKeepOnlySelectedAudioTrackChange,
  onAudioGainChange
}: MediaAudioPanelProps) {
  const selectedProfile = findAudioProfile(audioProfileId);
  // Audio copy is always first; a selected profile outside the saved slots temporarily takes the last slot.
  const visibleAudioProfileIds: AudioProfileId[] = audioProfileId === "copy" || audioProfileSlots.includes(audioProfileId)
    ? ["copy", ...audioProfileSlots]
    : ["copy", ...audioProfileSlots.slice(0, 3), audioProfileId];
  const trackLabel = isBatchMode ? "Reference audio track" : "Audio track";

  return (
    <section className="panel media-audio-panel">
      <div className="panel-header">
        <h2>
          <Music2 size={17} />
          Audio
        </h2>
        <div className="audio-panel-heading-actions">
          {manual && (
            <button className="ghost-button button-sm" type="button" disabled={locked || editingAudioProfiles} onClick={onEditAudioProfiles} title="Choose the conversion profiles shown here">
              <Pencil size={14} /> Edit
            </button>
          )}
          <span
            className="status-pill ok"
            title="FFmpeg is included with the app; no separate installation is required."
          >
            Video copy · FFmpeg
          </span>
        </div>
      </div>

      <div className="control-grid">
        <div className="app-select-field">
          <span>{trackLabel}</span>
          <AppSelect
            ariaLabel={trackLabel}
            value={audioTrackIndex === undefined ? "" : String(audioTrackIndex)}
            options={(probe?.audioTracks ?? []).map((track) => ({
              value: String(track.index),
              label: formatAudioTrack(track)
            }))}
            onChange={(value) => onAudioTrackChange(value ? Number(value) : undefined)}
            disabled={!probe?.audioTracks.length || locked}
            placeholder="No audio tracks detected"
          />
        </div>
      </div>

      {manual && <>
        <div className="profile-grid" aria-label="Audio profiles">
          {visibleAudioProfileIds.map((profileId) => {
            const profile = audioTransformProfiles.find((item) => item.id === profileId)!;
            return (
              <button
                key={profile.id}
                className={`profile-option ${profile.id === audioProfileId ? "active" : ""}`}
                onClick={() => onAudioProfileChange(profile.id)}
                type="button"
              >
                <strong>{profile.label}</strong>
                <span>{formatProfileDetails(profile)}</span>
              </button>
            );
          })}
        </div>
        {editingAudioProfiles && (
          <AudioProfileEditor
            slots={audioProfileSlots}
            onSave={onSaveAudioProfileSlots}
            onCancel={onCancelAudioProfileEdit}
          />
        )}

        <div className="workflow-subpart-toggle settings-field-wide">
          <label>
            <input
              type="checkbox"
              checked={keepOnlySelectedAudioTrack}
              onChange={(event) => onKeepOnlySelectedAudioTrackChange(event.target.checked)}
              disabled={!probe?.audioTracks.length || locked}
            />
            <Music2 size={15} /> Keep only selected audio track
          </label>
          <small>Removes every other audio track from the processed output.</small>
        </div>

        <div className={`audio-gain-control ${selectedProfile.codec === "copy" ? "disabled" : ""}`}>
          <div className="audio-gain-header">
            <span>Volume adjustment</span>
            <output htmlFor="audio-gain-slider">{formatGainDb(audioGainDb)}</output>
          </div>
          <input
            id="audio-gain-slider"
            type="range"
            min={audioGainLimits.minimumDb}
            max={audioGainLimits.maximumDb}
            step={audioGainLimits.stepDb}
            value={audioGainDb}
            onChange={(event) => onAudioGainChange(Number(event.target.value))}
            disabled={selectedProfile.codec === "copy"}
            aria-label="Volume adjustment"
          />
          <div className="audio-gain-scale" aria-hidden="true">
            <span>−6 dB</span>
            <span>0</span>
            <span>+6 dB</span>
          </div>
          <small>
            {selectedProfile.codec === "copy"
              ? "Choose a conversion profile to adjust volume."
              : "Applied equally to every channel; positive gain is protected from clipping."}
          </small>
        </div>
      </>}
    </section>
  );
}
