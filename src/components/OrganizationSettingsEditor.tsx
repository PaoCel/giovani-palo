import { useEffect, useMemo, useState, type FormEvent } from "react";

import type { OrganizationProfile, StandardFieldKey } from "@/types";
import {
  normalizeStandardFieldKeys,
  visibleStandardFieldDefinitions,
} from "@/utils/formFields";

interface OrganizationSettingsEditorProps {
  initialProfile: OrganizationProfile;
  busy?: boolean;
  onSave: (
    input: Omit<OrganizationProfile, "id" | "stakeId" | "stakeSlug" | "isActive" | "updatedAt">,
  ) => Promise<void>;
}

interface OrganizationFormValues {
  stakeName: string;
  publicHomeTitle: string;
  publicHomeSubtitle: string;
  accountHelpText: string;
  codeRecoveryHelpText: string;
  units: string[];
  unitDraft: string;
  youngMenPresident: string;
  youngMenCounselorsText: string;
  youngWomenPresident: string;
  youngWomenCounselorsText: string;
  supportContact: string;
  guestRegistrationHint: string;
  allowGuestRegistration: boolean;
  requireLoginForEdit: boolean;
  enabledStandardFields: StandardFieldKey[];
}

function normalizeUnits(values: string[]) {
  const seen = new Set<string>();

  return values.reduce<string[]>((accumulator, item) => {
    const normalized = item.trim();

    if (!normalized) {
      return accumulator;
    }

    const key = normalized.toLocaleLowerCase("it-IT");

    if (seen.has(key)) {
      return accumulator;
    }

    seen.add(key);
    accumulator.push(normalized);
    return accumulator;
  }, []);
}

function getInitialValues(profile: OrganizationProfile): OrganizationFormValues {
  return {
    stakeName: profile.stakeName,
    publicHomeTitle: profile.publicHomeTitle,
    publicHomeSubtitle: profile.publicHomeSubtitle,
    accountHelpText: profile.accountHelpText,
    codeRecoveryHelpText: profile.codeRecoveryHelpText,
    units: normalizeUnits(profile.units),
    unitDraft: "",
    youngMenPresident: profile.youngMenPresident,
    youngMenCounselorsText: profile.youngMenCounselors.join(", "),
    youngWomenPresident: profile.youngWomenPresident,
    youngWomenCounselorsText: profile.youngWomenCounselors.join(", "),
    supportContact: profile.supportContact,
    guestRegistrationHint: profile.guestRegistrationHint,
    allowGuestRegistration: profile.registrationDefaults.allowGuestRegistration,
    requireLoginForEdit: profile.registrationDefaults.requireLoginForEdit,
    enabledStandardFields: normalizeStandardFieldKeys(
      profile.registrationDefaults.enabledStandardFields,
    ),
  };
}

function splitCommaList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeUnitLabel(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function OrganizationSettingsEditor({
  initialProfile,
  busy,
  onSave,
}: OrganizationSettingsEditorProps) {
  const [values, setValues] = useState<OrganizationFormValues>(getInitialValues(initialProfile));
  const [error, setError] = useState<string | null>(null);

  const selectedDefaultFieldLabels = useMemo(
    () =>
      visibleStandardFieldDefinitions
        .filter((field) => values.enabledStandardFields.includes(field.key))
        .map((field) => field.label),
    [values.enabledStandardFields],
  );

  useEffect(() => {
    setValues(getInitialValues(initialProfile));
  }, [initialProfile]);

  function addUnit() {
    const normalized = normalizeUnitLabel(values.unitDraft);

    if (!normalized) {
      return;
    }

    const alreadyExists = values.units.some(
      (unit) => unit.toLocaleLowerCase("it-IT") === normalized.toLocaleLowerCase("it-IT"),
    );

    if (alreadyExists) {
      setValues((current) => ({ ...current, unitDraft: "" }));
      return;
    }

    setValues((current) => ({
      ...current,
      units: [...current.units, normalized],
      unitDraft: "",
    }));
  }

  function removeUnit(unitToRemove: string) {
    setValues((current) => ({
      ...current,
      units: current.units.filter((unit) => unit !== unitToRemove),
    }));
  }

  function toggleStandardField(fieldKey: StandardFieldKey) {
    setValues((current) => {
      const exists = current.enabledStandardFields.includes(fieldKey);

      return {
        ...current,
        enabledStandardFields: exists
          ? current.enabledStandardFields.filter((value) => value !== fieldKey)
          : normalizeStandardFieldKeys([...current.enabledStandardFields, fieldKey]),
      };
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!values.stakeName.trim()) {
      setError("Inserisci almeno il nome del palo.");
      return;
    }

    if (values.units.length === 0) {
      setError("Configura almeno un'unità: verrà usata nell'onboarding e nei moduli iscrizione.");
      return;
    }

    if (values.enabledStandardFields.length === 0) {
      setError("Seleziona almeno un campo standard predefinito per i nuovi moduli.");
      return;
    }

    await onSave({
      stakeName: values.stakeName.trim(),
      publicHomeTitle: values.publicHomeTitle.trim(),
      publicHomeSubtitle: values.publicHomeSubtitle.trim(),
      accountHelpText: values.accountHelpText.trim(),
      codeRecoveryHelpText: values.codeRecoveryHelpText.trim(),
      units: values.units,
      youngMenPresident: values.youngMenPresident.trim(),
      youngMenCounselors: splitCommaList(values.youngMenCounselorsText),
      youngWomenPresident: values.youngWomenPresident.trim(),
      youngWomenCounselors: splitCommaList(values.youngWomenCounselorsText),
      supportContact: values.supportContact.trim(),
      guestRegistrationHint: values.guestRegistrationHint.trim(),
      registrationDefaults: {
        allowGuestRegistration: values.allowGuestRegistration,
        requireLoginForEdit: values.requireLoginForEdit,
        enabledStandardFields: values.enabledStandardFields,
      },
    });
  }

  return (
    <form className="form-stack" onSubmit={handleSubmit}>
      {error ? <div className="form-error">{error}</div> : null}

      <div className="surface-panel">
        <div className="section-head">
          <div>
            <h3>Identità e supporto</h3>
            <p>Le informazioni qui definite alimentano home, onboarding e supporto ai partecipanti.</p>
          </div>
        </div>

        <div className="stack">
          <label className="field">
            <span>Nome del palo</span>
            <input
              className="input"
              value={values.stakeName}
              onChange={(event) =>
                setValues((current) => ({ ...current, stakeName: event.target.value }))
              }
            />
          </label>

          <label className="field">
            <span>Titolo homepage pubblica</span>
            <input
              className="input"
              value={values.publicHomeTitle}
              onChange={(event) =>
                setValues((current) => ({ ...current, publicHomeTitle: event.target.value }))
              }
              placeholder="Titolo principale della home"
            />
          </label>

          <label className="field">
            <span>Sottotitolo homepage pubblica</span>
            <textarea
              className="input input--textarea"
              rows={3}
              value={values.publicHomeSubtitle}
              onChange={(event) =>
                setValues((current) => ({ ...current, publicHomeSubtitle: event.target.value }))
              }
              placeholder="Spiega in poche righe account, iscrizioni e utilizzo della piattaforma."
            />
          </label>

          <label className="field">
            <span>Testo aiuto account</span>
            <textarea
              className="input input--textarea"
              rows={3}
              value={values.accountHelpText}
              onChange={(event) =>
                setValues((current) => ({ ...current, accountHelpText: event.target.value }))
              }
              placeholder="Testo guida nella schermata account/login."
            />
          </label>

          <label className="field">
            <span>Testo recupero codice ospite</span>
            <textarea
              className="input input--textarea"
              rows={3}
              value={values.codeRecoveryHelpText}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  codeRecoveryHelpText: event.target.value,
                }))
              }
              placeholder="Messaggio per chi si è già iscritto come ospite."
            />
          </label>

          <label className="field">
            <span>Contatto di supporto</span>
            <input
              className="input"
              value={values.supportContact}
              onChange={(event) =>
                setValues((current) => ({ ...current, supportContact: event.target.value }))
              }
              placeholder="Dirigente di riferimento, email o telefono"
            />
            <small>Viene usato per dare un riferimento chiaro in caso di dubbi o recuperi manuali.</small>
          </label>

          <label className="field">
            <span>Messaggio per iscrizioni ospite</span>
            <textarea
              className="input input--textarea"
              rows={3}
              value={values.guestRegistrationHint}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  guestRegistrationHint: event.target.value,
                }))
              }
              placeholder="Esempio: conserva il codice di 6 caratteri o contatta i dirigenti del palo."
            />
          </label>
        </div>
      </div>

      <div className="surface-panel">
        <div className="section-head">
          <div>
            <h3>Catalogo unità</h3>
            <p>Questa lista diventa la fonte di verità per profili e iscrizioni.</p>
          </div>
        </div>

        <div className="inline-actions">
          <input
            className="input"
            value={values.unitDraft}
            onChange={(event) =>
              setValues((current) => ({ ...current, unitDraft: event.target.value }))
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addUnit();
              }
            }}
            placeholder="Aggiungi rione o unità"
          />
          <button className="button button--soft button--small" onClick={addUnit} type="button">
            Aggiungi unità
          </button>
        </div>

        {values.units.length > 0 ? (
          <div className="chip-row unit-chip-list">
            {values.units.map((unit) => (
              <span key={unit} className="surface-chip unit-chip">
                <span>{unit}</span>
                <button
                  className="unit-chip__remove"
                  onClick={() => removeUnit(unit)}
                  type="button"
                  aria-label={`Rimuovi ${unit}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="subtle-text">
            Nessuna unità configurata. Finché non ne aggiungi almeno una, onboarding e modulo non
            permetteranno una scelta coerente.
          </p>
        )}
      </div>

      <div className="card-grid card-grid--two">
        <div className="surface-panel">
          <h3>Responsabili Giovani Uomini</h3>
          <div className="stack">
            <label className="field">
              <span>Presidente</span>
              <input
                className="input"
                value={values.youngMenPresident}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    youngMenPresident: event.target.value,
                  }))
                }
              />
            </label>

            <label className="field">
              <span>Consiglieri</span>
              <input
                className="input"
                value={values.youngMenCounselorsText}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    youngMenCounselorsText: event.target.value,
                  }))
                }
                placeholder="Nome 1, Nome 2"
              />
            </label>
          </div>
        </div>

        <div className="surface-panel">
          <h3>Responsabili Giovani Donne</h3>
          <div className="stack">
            <label className="field">
              <span>Presidentessa</span>
              <input
                className="input"
                value={values.youngWomenPresident}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    youngWomenPresident: event.target.value,
                  }))
                }
              />
            </label>

            <label className="field">
              <span>Consigliere</span>
              <input
                className="input"
                value={values.youngWomenCounselorsText}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    youngWomenCounselorsText: event.target.value,
                  }))
                }
                placeholder="Nome 1, Nome 2"
              />
            </label>
          </div>
        </div>
      </div>

      <div className="surface-panel">
        <div className="section-head">
          <div>
            <h3>Preset iscrizione per nuovi eventi</h3>
            <p>Queste impostazioni vengono applicate automaticamente quando crei una nuova attività.</p>
          </div>
        </div>

        <div className="checkbox-grid">
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={values.allowGuestRegistration}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  allowGuestRegistration: event.target.checked,
                }))
              }
            />
            <span>Consenti iscrizione ospite di default</span>
          </label>

          <label className="toggle-field">
            <input
              type="checkbox"
              checked={values.requireLoginForEdit}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  requireLoginForEdit: event.target.checked,
                }))
              }
            />
            <span>Richiedi login per modificare l'iscrizione</span>
          </label>
        </div>

        <div className="checkbox-grid">
          {visibleStandardFieldDefinitions.map((field) => (
            <label key={field.key} className="toggle-field">
              <input
                type="checkbox"
                checked={values.enabledStandardFields.includes(field.key)}
                onChange={() => toggleStandardField(field.key)}
              />
              <span>
                <strong>{field.label}</strong>
                <small>{field.helpText}</small>
              </span>
            </label>
          ))}
        </div>

        <p className="subtle-text">
          Campi standard attivi di default: {selectedDefaultFieldLabels.join(", ")}.
        </p>
      </div>

      <button className="button button--primary" disabled={busy} type="submit">
        {busy ? "Salvataggio..." : "Salva console organizzazione"}
      </button>
    </form>
  );
}
