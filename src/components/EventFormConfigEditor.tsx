import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";

import type { CustomField, EventAudience, EventFormConfig, StandardFieldKey } from "@/types";
import {
  type StandardFieldDefinition,
  isRoomRelatedStandardFieldKey,
  getVisibleStandardFieldDefinitions,
  normalizeStandardFieldKeys,
  removeRoomStandardFieldKeys,
} from "@/utils/formFields";
import { slugify } from "@/utils/slugify";

interface EventFormConfigEditorProps {
  initialConfig: EventFormConfig;
  busy?: boolean;
  allowRoomFields?: boolean;
  eventAudience?: EventAudience;
  standardFieldDefinitions?: StandardFieldDefinition[];
  onSave: (config: EventFormConfig) => Promise<void>;
}

function createEmptyCustomField(index: number): CustomField {
  return {
    id: `custom-${Date.now()}-${index}`,
    key: `customField${index + 1}`,
    label: "",
    type: "shortText",
    required: false,
    helpText: "",
    options: [],
  };
}

export function EventFormConfigEditor({
  initialConfig,
  busy,
  allowRoomFields = true,
  eventAudience = "congiunta",
  standardFieldDefinitions,
  onSave,
}: EventFormConfigEditorProps) {
  const forceAudienceField = eventAudience !== "congiunta";
  const [config, setConfig] = useState<EventFormConfig>({
    ...initialConfig,
    enabledStandardFields: normalizeStandardFieldKeys(
      forceAudienceField
        ? [...initialConfig.enabledStandardFields, "genderRoleCategory"]
        : initialConfig.enabledStandardFields,
    ),
  });
  const [error, setError] = useState<string | null>(null);
  const availableStandardFields =
    standardFieldDefinitions && standardFieldDefinitions.length > 0
      ? standardFieldDefinitions
      : getVisibleStandardFieldDefinitions();

  useEffect(() => {
    setConfig({
      ...initialConfig,
      enabledStandardFields: normalizeStandardFieldKeys(
        forceAudienceField
          ? [...initialConfig.enabledStandardFields, "genderRoleCategory"]
          : initialConfig.enabledStandardFields,
      ),
    });
  }, [forceAudienceField, initialConfig]);

  function toggleStandardField(key: StandardFieldKey) {
    if (forceAudienceField && key === "genderRoleCategory") {
      return;
    }

    setConfig((current) => {
      const exists = current.enabledStandardFields.includes(key);

      return {
        ...current,
        enabledStandardFields: exists
          ? current.enabledStandardFields.filter((value) => value !== key)
          : normalizeStandardFieldKeys([...current.enabledStandardFields, key]),
      };
    });
  }

  function updateCustomField(
    fieldId: string,
    updater: (field: CustomField) => CustomField,
  ) {
    setConfig((current) => ({
      ...current,
      customFields: current.customFields.map((field) =>
        field.id === fieldId ? updater(field) : field,
      ),
    }));
  }

  function removeCustomField(fieldId: string) {
    setConfig((current) => ({
      ...current,
      customFields: current.customFields.filter((field) => field.id !== fieldId),
    }));
  }

  function addCustomField() {
    setConfig((current) => ({
      ...current,
      customFields: [...current.customFields, createEmptyCustomField(current.customFields.length)],
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const invalidField = config.customFields.find((field) => !field.label.trim());

    if (invalidField) {
      setError("Ogni domanda personalizzata deve avere almeno una label.");
      return;
    }

    await onSave({
      ...config,
      enabledStandardFields: normalizeStandardFieldKeys(
        (allowRoomFields
          ? config.enabledStandardFields
          : removeRoomStandardFieldKeys(config.enabledStandardFields)
        ).concat(forceAudienceField ? ["genderRoleCategory"] : []),
      ),
      customFields: config.customFields.map((field) => ({
        ...field,
        key: slugify(field.key || field.label) || field.id,
        label: field.label.trim(),
        helpText: field.helpText?.trim() ?? "",
        options:
          field.type === "select"
            ? (field.options ?? []).map((option) => option.trim()).filter(Boolean)
            : [],
      })),
    });
  }

  return (
    <form className="form-stack" onSubmit={handleSubmit}>
      {error ? <div className="form-error">{error}</div> : null}

      <div className="checkbox-grid">
        <label className="toggle-field">
          <input
            type="checkbox"
            checked={config.allowGuestRegistration}
            onChange={(event) =>
              setConfig((current) => ({
                ...current,
                allowGuestRegistration: event.target.checked,
              }))
            }
          />
          <span>Consenti registrazione ospite / anonima</span>
        </label>

        <label className="toggle-field">
          <input
            type="checkbox"
            checked={config.requireLoginForEdit}
            onChange={(event) =>
              setConfig((current) => ({
                ...current,
                requireLoginForEdit: event.target.checked,
              }))
            }
          />
          <span>Richiedi login per modificare la registrazione</span>
        </label>
      </div>

      <div className="surface-panel">
        <h3>Campi standard</h3>
        <div className="checkbox-grid">
          {availableStandardFields
            .filter((field) => allowRoomFields || !isRoomRelatedStandardFieldKey(field.key))
            .map((field) => (
              <label key={field.key} className="toggle-field">
                <input
                  type="checkbox"
                  checked={config.enabledStandardFields.includes(field.key)}
                  disabled={forceAudienceField && field.key === "genderRoleCategory"}
                  onChange={() => toggleStandardField(field.key)}
                />
                <span>
                  <strong>{field.label}</strong>
                  <small>{field.helpText}</small>
                </span>
              </label>
            ))}
        </div>
      </div>

      <div className="surface-panel">
        <div className="section-head">
          <div>
            <h3>Domande personalizzate</h3>
            <p>Aggiungi domande brevi, descrizioni, menu a scelta o consensi.</p>
          </div>
          <button className="button button--ghost button--small" onClick={addCustomField} type="button">
            Aggiungi campo
          </button>
        </div>

        <div className="stack">
          {config.customFields.map((field, index) => (
            <div key={field.id} className="surface-panel surface-panel--subtle">
              <div className="card-grid card-grid--two">
                <label className="field">
                  <span>Label</span>
                  <input
                    className="input"
                    value={field.label}
                    onChange={(event) =>
                      updateCustomField(field.id, (current) => ({
                        ...current,
                        label: event.target.value,
                        key: slugify(event.target.value) || current.key,
                      }))
                    }
                  />
                </label>

                <label className="field">
                  <span>Tipo</span>
                  <select
                    className="input"
                    value={field.type}
                    onChange={(event) =>
                      updateCustomField(field.id, (current) => ({
                        ...current,
                        type: event.target.value as CustomField["type"],
                      }))
                    }
                  >
                    <option value="shortText">Testo breve</option>
                    <option value="longText">Testo lungo</option>
                    <option value="select">Scelta da elenco</option>
                    <option value="checkbox">Casella di conferma</option>
                  </select>
                </label>
              </div>

              <label className="field">
                <span>Help text</span>
                <input
                  className="input"
                  value={field.helpText ?? ""}
                  onChange={(event) =>
                    updateCustomField(field.id, (current) => ({
                      ...current,
                      helpText: event.target.value,
                    }))
                  }
                />
              </label>

              {field.type === "select" ? (
                <label className="field">
                  <span>Opzioni separate da virgola</span>
                  <input
                    className="input"
                    value={(field.options ?? []).join(", ")}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      updateCustomField(field.id, (current) => ({
                        ...current,
                        options: event.target.value.split(","),
                      }))
                    }
                  />
                </label>
              ) : null}

              <div className="inline-actions">
                <label className="toggle-field">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(event) =>
                      updateCustomField(field.id, (current) => ({
                        ...current,
                        required: event.target.checked,
                      }))
                    }
                  />
                  <span>Obbligatorio</span>
                </label>

                <button
                  className="button button--ghost button--small"
                  onClick={() => removeCustomField(field.id)}
                  type="button"
                >
                  Rimuovi
                </button>
              </div>

              <p className="subtle-text">Chiave interna del campo: `{field.key}`.</p>
            </div>
          ))}

          {config.customFields.length === 0 ? (
            <p className="subtle-text">Nessuna domanda personalizzata configurata per questo evento.</p>
          ) : null}
        </div>
      </div>

      <button className="button button--primary" disabled={busy} type="submit">
        {busy ? "Salvataggio..." : "Salva configurazione form"}
      </button>
    </form>
  );
}
