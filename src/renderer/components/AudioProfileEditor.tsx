import { useState } from "react";
import { audioTransformProfiles, type AudioProfileId, type AudioTransformProfile } from "../../core/media/AudioProfiles";
import { AppSelect } from "./AppSelect";

interface AudioProfileEditorProps {
  slots: AudioProfileId[];
  onSave: (slots: AudioProfileId[]) => void;
  onCancel: () => void;
}

function formatKey(profile: AudioTransformProfile): string {
  return profile.codec === "copy" ? "copy" : `${profile.codec}:${profile.channels}`;
}

function rateLabel(profile: AudioTransformProfile): string {
  return profile.bitRate ? `${Number.parseInt(profile.bitRate, 10)} kbps` : "Lossless";
}

const conversionProfiles = audioTransformProfiles.filter((profile) => profile.codec !== "copy");
const formatProfiles = [...new Map(conversionProfiles.map((profile) => [formatKey(profile), profile])).values()]
  .sort((left, right) => left.outputTitle.localeCompare(right.outputTitle));

export function AudioProfileEditor({ slots, onSave, onCancel }: AudioProfileEditorProps) {
  const [draft, setDraft] = useState<AudioProfileId[]>(slots);

  function updateSlot(index: number, id: AudioProfileId): void {
    setDraft((current) => current.map((value, position) => position === index ? id : value));
  }

  return (
    <div className="audio-profile-editor" aria-label="Edit audio profiles">
      <p>Keep Original Audio stays available. Choose four conversion profiles with the formats and bitrates you use most.</p>
      <div className="audio-profile-editor-labels" aria-hidden="true"><span /><span>Format</span><span>Bitrate</span></div>
      {draft.map((id, index) => {
        const current = conversionProfiles.find((profile) => profile.id === id)!;
        const selectedElsewhere = new Set(draft.filter((_item, position) => position !== index));
        const variants = conversionProfiles
          .filter((profile) => formatKey(profile) === formatKey(current))
          .sort((left, right) => Number.parseInt(left.bitRate ?? "0", 10) - Number.parseInt(right.bitRate ?? "0", 10));
        return (
          <div className="audio-profile-editor-row" key={index}>
            <strong>Slot {index + 1}</strong>
            <AppSelect
              ariaLabel={`Slot ${index + 1} audio format`}
              value={formatKey(current)}
              options={formatProfiles.map((profile) => ({
                value: formatKey(profile),
                label: profile.outputTitle,
                disabled: !conversionProfiles.some((candidate) =>
                  formatKey(candidate) === formatKey(profile) && !selectedElsewhere.has(candidate.id)
                )
              }))}
              onChange={(format) => {
                const next = conversionProfiles.find((profile) =>
                  formatKey(profile) === format && !selectedElsewhere.has(profile.id)
                );
                if (next) updateSlot(index, next.id);
              }}
            />
            <AppSelect
              ariaLabel={`Slot ${index + 1} audio bitrate`}
              value={id}
              options={variants.map((profile) => ({
                value: profile.id,
                label: rateLabel(profile),
                disabled: selectedElsewhere.has(profile.id)
              }))}
              onChange={(value) => updateSlot(index, value as AudioProfileId)}
              disabled={variants.length === 1}
            />
          </div>
        );
      })}
      <div className="button-row audio-profile-editor-actions">
        <button className="primary-button" type="button" onClick={() => onSave(draft)}>Save audio profiles</button>
        <button className="text-button" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
