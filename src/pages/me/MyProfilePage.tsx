import { useEffect, useId, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { ConfirmSheet } from "@/components/ConfirmSheet";
import { StakeMembershipStatus } from "@/components/membership/StakeMembershipStatus";
import { Button, Card, Notice, PageHeader } from "@/components/ui";
import { getUserDisplayName } from "@/components/UserPageIntro";
import { TIPO_ACCOUNT } from "@/copy/tipoAccount";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncData } from "@/hooks/useAsyncData";
import { organizationService } from "@/services/firestore/organizationService";
import { usersService } from "@/services/firestore/usersService";
import type { GenderRoleCategory } from "@/types";
import { DEFAULT_STAKE_ID } from "@/config/app";
import { isMinorOn } from "@/utils/profileCompletion";

import "@/styles/myProfile.css";

const MANUAL_UNIT_VALUE = "__manual_unit__";

function normalizeUnitName(value: string) {
  return value.trim().toLocaleLowerCase("it-IT");
}

function isConfiguredUnit(unitOptions: string[], unitName: string) {
  return unitOptions.some((unit) => normalizeUnitName(unit) === normalizeUnitName(unitName));
}

export function MyProfilePage() {
  const labelIds = useId();
  const { session, completeProfile } = useAuth();
  const navigate = useNavigate();
  const [switchingRole, setSwitchingRole] = useState(false);
  const [parentSheetOpen, setParentSheetOpen] = useState(false);
  const stakeId = session?.profile.stakeId ?? DEFAULT_STAKE_ID;

  // Conferma nel foglio (parentSheetOpen), mai con un dialogo del browser.
  async function handleBecomeParent() {
    if (!session) {
      return;
    }

    setSwitchingRole(true);

    try {
      await usersService.setOwnAccountType(session.firebaseUser.uid, "parent");
      navigate("/family", { replace: true });
    } catch (caughtError) {
      setParentSheetOpen(false);
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile cambiare tipo di account.",
      );
    } finally {
      setSwitchingRole(false);
    }
  }
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

  const stakeName = organization?.stakeName || session.profile.stakeName;
  const hasLeaders = Boolean(
    organization &&
      (organization.youngMenPresident ||
        organization.youngMenCounselors.length ||
        organization.youngWomenPresident ||
        organization.youngWomenCounselors.length ||
        organization.supportContact),
  );

  return (
    <div className="page my-profile">
      <PageHeader eyebrow="Profilo" title={getUserDisplayName(session)} />

      {error ? (
        <Notice title="Aggiornamento non riuscito" tone="warning">
          <p>{error}</p>
        </Notice>
      ) : null}

      {feedback ? (
        <Notice title="Profilo aggiornato" tone="success">
          <p>{feedback}</p>
        </Notice>
      ) : null}

      <div className="my-profile__layout">
        <Card className="my-profile__form" title="I tuoi dati">
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
                <span id={`${labelIds}-organizzazione`}>Organizzazione</span>
                {/* The wrapping label would add the options to the accessible name. */}
                <select
                  aria-labelledby={`${labelIds}-organizzazione`}
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
              <span id={`${labelIds}-unita`}>Unità di appartenenza</span>
              {hasConfiguredUnits ? (
                <select
                  aria-labelledby={`${labelIds}-unita`}
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
                <select aria-labelledby={`${labelIds}-unita`} className="input" disabled value="">
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

            <div className="my-profile__actions">
              <Button busy={busy} type="submit">
                {busy ? "Salvataggio..." : "Salva profilo"}
              </Button>
            </div>
          </form>
        </Card>

        <div className="my-profile__side">
          <Card variant="cool">
            <dl className="my-profile__facts">
              <div>
                <dt>Palo</dt>
                <dd>{stakeName || "Non definito"}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{session.profile.email || session.firebaseUser.email || "Non disponibile"}</dd>
              </div>
            </dl>
            <StakeMembershipStatus stakeName={stakeName} />
          </Card>

          {organization && hasLeaders ? (
            <Card className="my-profile__leaders" title="Responsabili del palo" variant="cool">
              {(organization.youngMenPresident || organization.youngMenCounselors.length) ? (
                <div className="my-profile__leader-group">
                  <strong>GU</strong>
                  {organization.youngMenPresident ? <p>{organization.youngMenPresident}</p> : null}
                  {organization.youngMenCounselors.length ? (
                    <small>{organization.youngMenCounselors.join(", ")}</small>
                  ) : null}
                </div>
              ) : null}

              {(organization.youngWomenPresident || organization.youngWomenCounselors.length) ? (
                <div className="my-profile__leader-group">
                  <strong>GD</strong>
                  {organization.youngWomenPresident ? <p>{organization.youngWomenPresident}</p> : null}
                  {organization.youngWomenCounselors.length ? (
                    <small>{organization.youngWomenCounselors.join(", ")}</small>
                  ) : null}
                </div>
              ) : null}

              {organization.supportContact ? (
                <p className="my-profile__support">Supporto: {organization.supportContact}</p>
              ) : null}
            </Card>
          ) : null}

          {/* L'account di un minore non diventa mai da genitore (FLUSSO_GENITORE.md). */}
          {!session.isAdmin &&
          !session.isUnitLeader &&
          !isMinorOn(session.profile.birthDate, new Date()) ? (
            <Card
              subtitle="Con un account genitore puoi creare i profili dei tuoi figli, iscriverli alle attività e seguire lo stato delle loro iscrizioni da un'unica dashboard."
              title="Sei un genitore?"
              variant="cool"
            >
              <div className="my-profile__actions">
                <Button
                  disabled={switchingRole}
                  onClick={() => setParentSheetOpen(true)}
                  variant="secondary"
                >
                  {TIPO_ACCOUNT.passaGenitore}
                </Button>
              </div>
            </Card>
          ) : null}
        </div>
      </div>

      {parentSheetOpen ? (
        <ConfirmSheet
          body={TIPO_ACCOUNT.passaGenitoreTesto}
          busy={switchingRole}
          busyLabel={TIPO_ACCOUNT.passaGenitoreInCorso}
          cancelLabel={TIPO_ACCOUNT.restaComeSei}
          confirmLabel={TIPO_ACCOUNT.passaGenitore}
          onCancel={() => setParentSheetOpen(false)}
          onConfirm={() => void handleBecomeParent()}
          title={TIPO_ACCOUNT.passaGenitoreTitolo}
        />
      ) : null}
    </div>
  );
}
