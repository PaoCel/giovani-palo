import { useEffect, useState, type FormEvent } from "react";

import { UserPageIntro } from "@/components/UserPageIntro";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncData } from "@/hooks/useAsyncData";
import { organizationService } from "@/services/firestore/organizationService";
import type { GenderRoleCategory } from "@/types";

const MANUAL_UNIT_VALUE = "__manual_unit__";

function normalizeUnitName(value: string) {
  return value.trim().toLocaleLowerCase("it-IT");
}

function isConfiguredUnit(unitOptions: string[], unitName: string) {
  return unitOptions.some((unit) => normalizeUnitName(unit) === normalizeUnitName(unitName));
}

export function MyProfilePage() {
  const { session, completeProfile } = useAuth();
  const stakeId = session?.profile.stakeId ?? "roma-est";
  const { data: organization } = useAsyncData(
    () => organizationService.getProfile(stakeId),
    [stakeId],
    null,
  );
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualUnitMode, setManualUnitMode] = useState(false);
  const [values, setValues] = useState({
    firstName: "",
    lastName: "",
    birthDate: "",
    genderRoleCategory: "giovane_uomo" as GenderRoleCategory,
    unitName: "",
  });

  useEffect(() => {
    if (!session) {
      return;
    }

    setValues({
      firstName: session.profile.firstName,
      lastName: session.profile.lastName,
      birthDate: session.profile.birthDate,
      genderRoleCategory:
        session.profile.genderRoleCategory || "giovane_uomo",
      unitName: session.profile.unitName,
    });
    setManualUnitMode(
      Boolean(
        session.isAdmin &&
          (!(organization?.units ?? []).length ||
            (session.profile.unitName &&
              !isConfiguredUnit(organization?.units ?? [], session.profile.unitName))),
      ),
    );
  }, [organization?.units, session]);

  if (!session) {
    return null;
  }

  const unitOptions = organization?.units ?? [];
  const hasConfiguredUnits = unitOptions.length > 0;
  const canUseManualUnit = session.isAdmin;
  const showManualUnitInput =
    canUseManualUnit &&
    (!hasConfiguredUnits ||
      manualUnitMode ||
      (values.unitName.trim() && !isConfiguredUnit(unitOptions, values.unitName)));
  const unitSelectValue = showManualUnitInput ? MANUAL_UNIT_VALUE : values.unitName;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    setError(null);
    const normalizedUnitName = values.unitName.trim();

    if (!normalizedUnitName) {
      setBusy(false);
      setError("Indica il tuo rione o ramo.");
      return;
    }

    if (
      !canUseManualUnit &&
      (!hasConfiguredUnits || !isConfiguredUnit(unitOptions, normalizedUnitName))
    ) {
      setBusy(false);
      setError("Seleziona un'unità valida dall'elenco.");
      return;
    }

    try {
      await completeProfile({
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        birthDate: values.birthDate,
        genderRoleCategory: values.genderRoleCategory,
        unitName: normalizedUnitName,
        stakeId,
      });
      setFeedback("Profilo aggiornato correttamente.");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile aggiornare il profilo.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <UserPageIntro />

      {error ? (
        <div className="notice notice--warning">
          <div>
            <h3>Aggiornamento non riuscito</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      {feedback ? (
        <div className="notice notice--info">
          <div>
            <h3>Profilo aggiornato</h3>
            <p>{feedback}</p>
          </div>
        </div>
      ) : null}

      <section className="card user-profile-card">
        <div className="user-profile-card__meta">
          <div className="surface-panel surface-panel--subtle">
            <strong>Palo</strong>
            <p>{organization?.stakeName || session.profile.stakeName || "Non definito"}</p>
          </div>
          <div className="surface-panel surface-panel--subtle">
            <strong>Email</strong>
            <p>{session.profile.email || session.firebaseUser.email || "Non disponibile"}</p>
          </div>
        </div>

        {organization &&
        (organization.youngMenPresident ||
          organization.youngMenCounselors.length ||
          organization.youngWomenPresident ||
          organization.youngWomenCounselors.length ||
          organization.supportContact) ? (
          <div className="surface-panel surface-panel--subtle stake-leaders-card">
            <h3>Responsabili del palo</h3>
            <div className="card-grid card-grid--two">
              {(organization.youngMenPresident || organization.youngMenCounselors.length) ? (
                <div className="stake-leaders-card__group">
                  <strong>GU</strong>
                  {organization.youngMenPresident ? <p>{organization.youngMenPresident}</p> : null}
                  {organization.youngMenCounselors.length ? (
                    <small>{organization.youngMenCounselors.join(", ")}</small>
                  ) : null}
                </div>
              ) : null}

              {(organization.youngWomenPresident || organization.youngWomenCounselors.length) ? (
                <div className="stake-leaders-card__group">
                  <strong>GD</strong>
                  {organization.youngWomenPresident ? <p>{organization.youngWomenPresident}</p> : null}
                  {organization.youngWomenCounselors.length ? (
                    <small>{organization.youngWomenCounselors.join(", ")}</small>
                  ) : null}
                </div>
              ) : null}
            </div>

            {organization.supportContact ? (
              <p className="stake-leaders-card__support">Supporto: {organization.supportContact}</p>
            ) : null}
          </div>
        ) : null}

        <form className="form-stack" onSubmit={handleSubmit}>
          <div className="card-grid card-grid--two">
            <label className="field">
              <span>Nome</span>
              <input
                className="input"
                value={values.firstName}
                onChange={(eventInput) =>
                  setValues((current) => ({ ...current, firstName: eventInput.target.value }))
                }
              />
            </label>

            <label className="field">
              <span>Cognome</span>
              <input
                className="input"
                value={values.lastName}
                onChange={(eventInput) =>
                  setValues((current) => ({ ...current, lastName: eventInput.target.value }))
                }
              />
            </label>
          </div>

          <div className="card-grid card-grid--two">
            <label className="field">
              <span>Data di nascita</span>
              <input
                className="input"
                type="date"
                value={values.birthDate}
                onChange={(eventInput) =>
                  setValues((current) => ({ ...current, birthDate: eventInput.target.value }))
                }
              />
            </label>

            <label className="field">
              <span>Organizzazione</span>
              <select
                className="input"
                value={values.genderRoleCategory}
                onChange={(eventInput) =>
                  setValues((current) => ({
                    ...current,
                    genderRoleCategory: eventInput.target.value as GenderRoleCategory,
                  }))
                }
              >
                <option value="giovane_uomo">Giovane uomo</option>
                <option value="giovane_donna">Giovane donna</option>
                <option value="dirigente">Dirigente</option>
                <option value="accompagnatore">Accompagnatore</option>
              </select>
            </label>
          </div>

          <label className="field">
            <span>Unità di appartenenza</span>
            {hasConfiguredUnits ? (
              <select
                className="input"
                value={unitSelectValue}
                onChange={(eventInput) => {
                  const { value } = eventInput.target;

                  if (value === MANUAL_UNIT_VALUE) {
                    setManualUnitMode(true);
                    setValues((current) => ({
                      ...current,
                      unitName: isConfiguredUnit(unitOptions, current.unitName) ? "" : current.unitName,
                    }));
                    return;
                  }

                  setManualUnitMode(false);
                  setValues((current) => ({ ...current, unitName: value }));
                }}
              >
                <option value="">Seleziona un'unità</option>
                {unitOptions.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
                {canUseManualUnit ? (
                  <option value={MANUAL_UNIT_VALUE}>Unità non in elenco</option>
                ) : null}
              </select>
            ) : canUseManualUnit ? null : (
              <select className="input" disabled value="">
                <option value="">Nessuna unità configurata</option>
              </select>
            )}
            {showManualUnitInput ? (
              <input
                className="input"
                placeholder="Scrivi la tua unità"
                value={values.unitName}
                onChange={(eventInput) =>
                  setValues((current) => ({ ...current, unitName: eventInput.target.value }))
                }
              />
            ) : null}
            <small>
              {showManualUnitInput
                ? "Se la tua unità non è ancora in elenco, scrivila qui."
                : hasConfiguredUnits
                  ? "Seleziona l'unità configurata per il tuo palo."
                  : "L'amministratore deve prima configurare almeno un'unità."}
            </small>
          </label>

          <div className="inline-actions">
            <button className="button button--primary" disabled={busy} type="submit">
              {busy ? "Salvataggio..." : "Salva profilo"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
