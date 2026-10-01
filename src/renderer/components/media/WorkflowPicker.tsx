import { useId } from "react";
import { Check, Pencil, SlidersHorizontal, Zap } from "lucide-react";
import type { WorkflowProfile } from "../../../main/workflowProfileService";
import { profileSummary } from "../WorkflowProfilesPanel";

interface WorkflowPickerProps {
  mediaProfiles: WorkflowProfile[];
  translationOnlyProfiles: WorkflowProfile[];
  selectedProfileId: string;
  manual: boolean;
  disabled: boolean;
  canEdit: boolean;
  onSelectProfile: (id: string) => void;
  onSelectManual: () => void;
  onEditProfile: (profile: WorkflowProfile) => void;
}

export function WorkflowPicker({
  mediaProfiles,
  translationOnlyProfiles,
  selectedProfileId,
  manual,
  disabled,
  canEdit,
  onSelectProfile,
  onSelectManual,
  onEditProfile
}: WorkflowPickerProps) {
  const idPrefix = useId();

  return (
    <section className="workflow-picker" aria-labelledby={`${idPrefix}-title`}>
      <span className="section-label" id={`${idPrefix}-title`}>Workflow</span>
      <div className="media-workflow-gallery" role="group" aria-label="Choose workflow">
        <div className={`media-workflow-tile manual-tile${manual ? " selected" : ""}`}>
          <button
            type="button"
            className="media-workflow-tile-main"
            aria-pressed={manual}
            disabled={disabled}
            onClick={onSelectManual}
          >
            <span className="media-tile-icon" aria-hidden="true">{manual ? <Check size={16} /> : <SlidersHorizontal size={16} />}</span>
            <strong>Custom setup</strong>
            <small>Adjust audio, subtitles and output for this run.</small>
          </button>
        </div>
        {mediaProfiles.map((profile) => {
          const selected = selectedProfileId === profile.id;
          const nameId = `${idPrefix}-${profile.id}`;
          return (
            <div className={`media-workflow-tile${selected ? " selected" : ""}`} key={profile.id}>
              <button
                type="button"
                className="media-workflow-tile-main"
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => onSelectProfile(profile.id)}
              >
                <span className="media-tile-icon" aria-hidden="true">{selected ? <Check size={16} /> : <Zap size={16} />}</span>
                <strong id={nameId}>{profile.name}</strong>
                <small>{profileSummary(profile)}</small>
              </button>
              {canEdit && (
                <button
                  type="button"
                  className="icon-button button-sm media-tile-edit"
                  aria-label="Edit workflow"
                  aria-describedby={nameId}
                  disabled={disabled}
                  onClick={() => onEditProfile(profile)}
                  title={`Edit ${profile.name}`}
                >
                  <Pencil size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {canEdit && translationOnlyProfiles.length > 0 && (
        <details className="disclosure media-translation-profiles">
          <summary>Translation-only workflows run from the Translate page</summary>
          <div className="button-row">
            {translationOnlyProfiles.map((profile) => (
              <button className="text-button button-sm" key={profile.id} type="button" disabled={disabled} onClick={() => onEditProfile(profile)}>
                <Pencil size={13} />{profile.name}
              </button>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
