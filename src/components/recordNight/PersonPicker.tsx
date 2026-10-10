import { RecordNightIcon } from "@/components/recordNight/RecordNightIcon";

export interface RecordNightPickerPerson {
  registrationId: string;
  displayName: string;
  isSelf: boolean;
}

interface PersonPickerProps {
  people: ReadonlyArray<RecordNightPickerPerson>;
  selectedId: string;
  disabled: boolean;
  onSelect: (registrationId: string) => void;
}

// "Per chi?": chi agisce sui record quando l'account ha più iscrizioni (la
// propria e quelle dei figli). Pill compatte nella pelle Tabellone.
export function PersonPicker({ people, selectedId, disabled, onSelect }: PersonPickerProps) {
  return (
    <div aria-label="Per chi?" className="rn-picker" role="group">
      <span aria-hidden="true" className="rn-picker__label">
        Per chi?
      </span>
      <div className="rn-picker__pills">
        {people.map((person) => {
          const selected = person.registrationId === selectedId;
          return (
            <button
              aria-pressed={selected}
              className={selected ? "rn-picker__pill rn-picker__pill--on" : "rn-picker__pill"}
              disabled={disabled && !selected}
              key={person.registrationId}
              onClick={() => onSelect(person.registrationId)}
              type="button"
            >
              {selected ? <RecordNightIcon name="check" /> : null}
              {person.isSelf ? "Tu" : person.displayName}
            </button>
          );
        })}
      </div>
    </div>
  );
}
