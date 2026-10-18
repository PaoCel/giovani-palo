import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { AppIcon } from "@/components/AppIcon";
import { AppModal } from "@/components/AppModal";
import {
  ConsentChoices,
  consentChoiceFromDecision,
  getConsentChoicesProblem,
  type ConsentChoicesValue,
} from "@/components/ConsentChoices";
import { ActivityMediaHighlight } from "@/components/gallery/ActivityMediaHighlight";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { FAMIGLIA } from "@/copy/famiglia";
import { fillCopy } from "@/copy/parole";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncData } from "@/hooks/useAsyncData";
import { childrenService, type ChildWriteInput } from "@/services/firestore/childrenService";
import { eventsService } from "@/services/firestore/eventsService";
import { parentAuthorizationService } from "@/services/firestore/parentAuthorizationService";
import { registrationsService } from "@/services/firestore/registrationsService";
import { stakesService } from "@/services/firestore/stakesService";
import { unitsService } from "@/services/firestore/unitsService";
import type { ChildProfile, Event, PhotoConsentDecision, Registration, Unit } from "@/types";
import { isConsentStaleError } from "@/utils/callableError";
import { getActivitiesPath, getActivityRegistrationPath } from "@/utils/activityLinks";
import { formatDateOnly, formatEventWindow } from "@/utils/formatters";
import { getRegistrationStatusLabel, getRegistrationStatusTone } from "@/utils/registrations";

const AVATAR_PALETTE = ["#235d90", "#b58a50", "#2d6b56", "#7a4f8f", "#b14e44", "#1f6f7d"];

function getChildInitials(child: ChildProfile) {
  const first = child.firstName?.trim().charAt(0) ?? "";
  const last = child.lastName?.trim().charAt(0) ?? "";
  const initials = `${first}${last}` || child.fullName?.trim().charAt(0) || "?";
  return initials.toUpperCase();
}

function getAvatarColor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 997;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

interface FamilyData {
  stakeId: string;
  children: ChildProfile[];
  registrations: Registration[];
  events: Event[];
  units: Unit[];
}

const initialData: FamilyData = {
  stakeId: "",
  children: [],
  registrations: [],
  events: [],
  units: [],
};

interface ChildFormState {
  firstName: string;
  lastName: string;
  birthDate: string;
  genderRoleCategory: "giovane_uomo" | "giovane_donna" | "";
  unitId: string;
}

const emptyChildForm: ChildFormState = {
  firstName: "",
  lastName: "",
  birthDate: "",
  genderRoleCategory: "",
  unitId: "",
};

function describeConsent(value: PhotoConsentDecision | undefined) {
  if (value === "accepted") return "Acconsento";
  if (value === "refused" || value === "revoked") return "Non acconsento";
  return "Da completare";
}

interface ConsentTarget {
  registration: Registration;
  childName: string;
  eventTitle: string;
}

export function FamilyDashboardPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const parentUid = session?.firebaseUser.uid ?? "";
  const [childModalOpen, setChildModalOpen] = useState(false);
  const [editingChild, setEditingChild] = useState<ChildProfile | null>(null);
  const [childForm, setChildForm] = useState<ChildFormState>(emptyChildForm);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [consentTarget, setConsentTarget] = useState<ConsentTarget | null>(null);
  const [consentChoices, setConsentChoices] = useState<ConsentChoicesValue>({
    photo: null,
    social: null,
  });
  const [consentSaving, setConsentSaving] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  // Le scelte sono cambiate altrove: prima di salvare vanno rilette.
  const [consentStale, setConsentStale] = useState(false);
  const [consentReloading, setConsentReloading] = useState(false);
  // Dopo il salvataggio la lettura dal server può fallire: lo stato locale
  // resta quello della callable e lo diciamo, senza ripiegare sulla cache.
  const [staleDataWarning, setStaleDataWarning] = useState(false);
  // Numero del dialogo corrente: cambia a ogni apertura e chiusura. Le risposte
  // asincrone di un dialogo chiuso o sostituito (Annulla durante la rilettura,
  // un altro figlio aperto nel frattempo) non devono toccarne lo stato.
  const consentDialogRef = useRef(0);

  // Il genitore è già autenticato: non ha senso farlo passare dalla mail per
  // firmare. La callable emette un token a vita breve e apriamo la stessa
  // pagina di firma del magic-link.
  async function handleAuthorizeNow(registration: Registration) {
    setBusy(true);
    setActionError(null);

    try {
      const { token } = await parentAuthorizationService.issueOwnToken({
        stakeId: registration.stakeId,
        activityId: registration.eventId,
        registrationId: registration.id,
      });
      navigate(`/parent-confirm/${token}`);
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile aprire il modulo di autorizzazione.",
      );
      setBusy(false);
    }
  }

  const { data, loading, error, setData, reload } = useAsyncData(
    async () => {
      if (!parentUid) {
        return initialData;
      }

      const stakeId =
        session?.profile.stakeId || (await stakesService.getDefaultStakeId()) || "";

      const [children, registrations, events, units] = await Promise.all([
        childrenService.listChildren(parentUid),
        registrationsService.listFamilyRegistrations(parentUid),
        stakeId ? eventsService.listPublicEvents(stakeId) : Promise.resolve([]),
        stakeId ? unitsService.listActiveUnits(stakeId) : Promise.resolve([]),
      ]);

      return { stakeId, children, registrations, events, units };
    },
    [parentUid, session?.profile.stakeId],
    initialData,
  );

  const eventById = new Map(data.events.map((event) => [event.id, event]));
  const activeRegistrations = data.registrations.filter(
    (registration) => registration.registrationStatus !== "cancelled",
  );

  function openConsentModal(target: ConsentTarget) {
    const state = target.registration.parentAuthorization;
    setConsentChoices({
      photo: consentChoiceFromDecision(state?.photoConsent),
      social: consentChoiceFromDecision(state?.socialPublicationConsent),
    });
    setConsentError(null);
    setConsentStale(false);
    setConsentReloading(false);
    consentDialogRef.current += 1;
    setConsentTarget(target);
  }

  // Dopo una scrittura della callable la cache locale ha i valori di prima: la
  // lista si rilegge dal server. Se non risponde, nessun ripiego sulla cache.
  async function readRegistrationsFresh(): Promise<Registration[] | null> {
    try {
      return await registrationsService.listFamilyRegistrations(parentUid, { fresh: true });
    } catch {
      return null;
    }
  }

  async function handleConsentReload() {
    if (!consentTarget) return;
    const { registration } = consentTarget;
    const dialog = consentDialogRef.current;
    setConsentReloading(true);
    setConsentError(null);

    const registrations = await readRegistrationsFresh();
    // Dialogo chiuso o sostituito mentre si rileggeva: la risposta non lo riguarda.
    if (dialog !== consentDialogRef.current) return;
    setConsentReloading(false);

    const updated = registrations?.find(
      (item) => item.id === registration.id && item.eventId === registration.eventId,
    );
    if (!registrations || !updated) {
      setConsentError("Non riesco a leggere le scelte più recenti. Riprova tra poco.");
      return;
    }

    setData((current) => ({ ...current, registrations }));
    setStaleDataWarning(false);
    setConsentStale(false);
    setConsentTarget({ ...consentTarget, registration: updated });
    setConsentChoices({
      photo: consentChoiceFromDecision(updated.parentAuthorization?.photoConsent),
      social: consentChoiceFromDecision(updated.parentAuthorization?.socialPublicationConsent),
    });
  }

  function closeConsentModal() {
    if (consentSaving) return;
    consentDialogRef.current += 1;
    setConsentReloading(false);
    setConsentTarget(null);
  }

  async function handleConsentSave() {
    if (!consentTarget) return;
    const { photo, social } = consentChoices;
    if (photo === null || social === null) return;
    const { registration } = consentTarget;
    const dialog = consentDialogRef.current;

    setConsentSaving(true);
    setConsentError(null);

    try {
      const result = await parentAuthorizationService.updateConsent({
        stakeId: registration.stakeId,
        activityId: registration.eventId,
        registrationId: registration.id,
        photoConsent: photo,
        socialPublicationConsent: social,
        expectedUpdatedAt: registration.parentAuthorization?.consentUpdatedAt ?? null,
      });

      // Subito il valore nuovo a schermo, poi rilettura dal server.
      setData((current) => ({
        ...current,
        registrations: current.registrations.map((item) =>
          item.id === registration.id &&
          item.eventId === registration.eventId &&
          item.parentAuthorization
            ? {
                ...item,
                parentAuthorization: {
                  ...item.parentAuthorization,
                  photoConsent: result.photoConsent,
                  socialPublicationConsent: result.socialPublicationConsent,
                },
              }
            : item,
        ),
      }));
      // Il salvataggio è andato a buon fine comunque; si chiude solo il dialogo
      // che l'ha avviato, non uno aperto nel frattempo.
      if (dialog === consentDialogRef.current) {
        consentDialogRef.current += 1;
        setConsentTarget(null);
      }

      const registrations = await readRegistrationsFresh();
      if (registrations) {
        setData((current) => ({ ...current, registrations }));
        setStaleDataWarning(false);
      } else {
        setStaleDataWarning(true);
      }
    } catch (caughtError) {
      if (dialog !== consentDialogRef.current) return;
      setConsentStale(isConsentStaleError(caughtError));
      setConsentError(
        caughtError instanceof Error
          ? caughtError.message
          : "Non siamo riusciti a salvare le scelte. Riprova tra poco.",
      );
    } finally {
      setConsentSaving(false);
    }
  }

  // Riga "Foto e social" di un'iscrizione firmata. Resta anche per le iscrizioni
  // annullate: le foto già fatte esistono ancora, la scelta si può cambiare.
  function renderConsentRow(registration: Registration, child: ChildProfile, showEvent: boolean) {
    const authorization = registration.parentAuthorization;
    if (authorization?.status !== "authorized") return null;
    const eventTitle = eventById.get(registration.eventId)?.title ?? "Attività";

    return (
      <div className="family-consent-row" key={`consent:${registration.eventId}:${registration.id}`}>
        <span aria-hidden="true" className="family-consent-row__icon">
          <AppIcon name="camera" />
        </span>
        <div className="family-consent-row__info">
          <strong>{showEvent ? `Foto e social · ${eventTitle}` : "Foto e social"}</strong>
          <span>
            Foto: {describeConsent(authorization.photoConsent)} · Social:{" "}
            {describeConsent(authorization.socialPublicationConsent)}
          </span>
        </div>
        <button
          className="button button--soft button--small"
          disabled={busy}
          onClick={() =>
            openConsentModal({
              registration,
              childName: child.fullName || child.firstName,
              eventTitle,
            })
          }
          type="button"
        >
          Cambia le scelte
        </button>
      </div>
    );
  }

  function openCreateChild() {
    setEditingChild(null);
    setChildForm(emptyChildForm);
    setActionError(null);
    setChildModalOpen(true);
  }

  function openEditChild(child: ChildProfile) {
    setEditingChild(child);
    setChildForm({
      firstName: child.firstName,
      lastName: child.lastName,
      birthDate: child.birthDate,
      genderRoleCategory:
        child.genderRoleCategory === "giovane_uomo" ||
        child.genderRoleCategory === "giovane_donna"
          ? child.genderRoleCategory
          : "",
      unitId: child.unitId,
    });
    setActionError(null);
    setChildModalOpen(true);
  }

  async function handleChildSubmit(event: FormEvent) {
    event.preventDefault();

    if (!parentUid || !data.stakeId) {
      setActionError("Sessione non valida: riprova dopo aver ricaricato la pagina.");
      return;
    }

    const unit = data.units.find((item) => item.id === childForm.unitId) ?? null;
    const input: ChildWriteInput = {
      firstName: childForm.firstName,
      lastName: childForm.lastName,
      birthDate: childForm.birthDate,
      genderRoleCategory: childForm.genderRoleCategory,
      unitId: unit?.id ?? "",
      unitName: unit?.name ?? "",
      stakeId: data.stakeId,
    };

    setBusy(true);
    setActionError(null);

    try {
      if (editingChild) {
        await childrenService.updateChild(parentUid, editingChild.id, input);
      } else {
        await childrenService.createChild(parentUid, input);
      }

      setChildModalOpen(false);
      await reload();
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : FAMIGLIA.erroreSalvataggio,
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteChild(child: ChildProfile) {
    if (!parentUid) {
      return;
    }

    const hasRegistrations = activeRegistrations.some(
      (registration) => registration.childId === child.id,
    );

    if (hasRegistrations) {
      setActionError(
        `${child.fullName || "Questo profilo"} ha iscrizioni attive: annullale prima di rimuovere il profilo.`,
      );
      return;
    }

    if (
      typeof window !== "undefined" &&
      !window.confirm(
        fillCopy(FAMIGLIA.rimuoviProfilo, { nome: child.fullName || child.firstName }),
      )
    ) {
      return;
    }

    setBusy(true);
    setActionError(null);

    try {
      await childrenService.deleteChild(parentUid, child.id);
      setData((current) => ({
        ...current,
        children: current.children.filter((item) => item.id !== child.id),
      }));
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile rimuovere il profilo.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page page--user-dashboard">
      <ActivityMediaHighlight />

      <section className="user-dashboard-section">
        <div className="user-section-heading">
          <h2>La tua famiglia</h2>
          <p className="subtle-text">
            Gestisci i profili dei tuoi figli e le loro iscrizioni alle attività.
          </p>
        </div>

        {error ? (
          <div className="notice notice--warning">
            <div>
              <h3>Impossibile caricare i dati</h3>
              <p>{error}</p>
            </div>
          </div>
        ) : null}

        {actionError ? (
          <div className="notice notice--warning">
            <div>
              <h3>Azione non completata</h3>
              <p>{actionError}</p>
            </div>
          </div>
        ) : null}

        {staleDataWarning ? (
          <div className="notice notice--info">
            <div>
              <p>
                Le scelte sono salvate, ma non ho potuto verificare i dati più recenti.
                Ricarica la pagina tra poco per esserne certo.
              </p>
            </div>
          </div>
        ) : null}

        {loading ? (
          <p className="subtle-text">Sto caricando i profili della famiglia...</p>
        ) : data.children.length === 0 ? (
          <EmptyState
            title="Nessun figlio collegato"
            description={FAMIGLIA.nessunFiglioDescrizione}
            action={
              <button className="button button--primary" onClick={openCreateChild} type="button">
                <AppIcon name="plus" />
                <span>{FAMIGLIA.aggiungiFiglio}</span>
              </button>
            }
          />
        ) : (
          <div className="stack">
            {data.children.map((child) => {
              const childRegistrations = activeRegistrations.filter(
                (registration) => registration.childId === child.id,
              );
              const cancelledConsentRegistrations = data.registrations.filter(
                (registration) =>
                  registration.childId === child.id &&
                  registration.registrationStatus === "cancelled" &&
                  registration.parentAuthorization?.status === "authorized",
              );

              return (
                <article key={child.id} className="family-child-card">
                  <div className="family-child-card__head">
                    <span
                      aria-hidden="true"
                      className="child-avatar"
                      style={{ background: getAvatarColor(child.fullName || child.firstName) }}
                    >
                      {getChildInitials(child)}
                    </span>
                    <div className="family-child-card__identity">
                      <strong>{child.fullName || child.firstName}</strong>
                      <span>
                        {child.unitName || "Unità da definire"}
                        {child.birthDate ? ` · ${formatDateOnly(child.birthDate)}` : ""}
                      </span>
                    </div>
                    <span
                      className={
                        childRegistrations.length > 0
                          ? "status-badge status-badge--success"
                          : "status-badge status-badge--neutral"
                      }
                    >
                      {childRegistrations.length > 0
                        ? `${childRegistrations.length} iscrizion${childRegistrations.length === 1 ? "e" : "i"}`
                        : "Nessuna iscrizione"}
                    </span>
                  </div>

                  {childRegistrations.length === 0 ? (
                    <p className="subtle-text">
                      Nessuna iscrizione attiva: iscrivilo a una prossima attività.
                    </p>
                  ) : (
                    <div className="family-child-card__registrations">
                      {childRegistrations.map((registration) => {
                        const event = eventById.get(registration.eventId);
                        return (
                          <div
                            key={`${registration.eventId}:${registration.id}`}
                            className="family-reg-group"
                          >
                            <div className="family-reg-row">
                              <StatusBadge
                                label={getRegistrationStatusLabel(registration.registrationStatus)}
                                tone={getRegistrationStatusTone(registration.registrationStatus)}
                              />
                              <div className="family-reg-row__info">
                                <strong>{event?.title ?? "Attività"}</strong>
                                {event ? <span>{formatEventWindow(event)}</span> : null}
                              </div>
                              {registration.registrationStatus === "pending_parent_authorization" ? (
                                <button
                                  className="button button--primary button--small"
                                  disabled={busy}
                                  onClick={() => void handleAuthorizeNow(registration)}
                                  type="button"
                                >
                                  {busy ? "Apertura..." : "Autorizza ora"}
                                </button>
                              ) : null}
                              <Link
                                className="button button--ghost button--small"
                                to={`${getActivityRegistrationPath(registration.eventId, registration.stakeId)}${getActivityRegistrationPath(registration.eventId, registration.stakeId).includes("?") ? "&" : "?"}child=${child.id}`}
                              >
                                Gestisci
                              </Link>
                            </div>
                            {renderConsentRow(registration, child, false)}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {cancelledConsentRegistrations.length > 0 ? (
                    <div className="family-child-card__registrations">
                      {cancelledConsentRegistrations.map((registration) =>
                        renderConsentRow(registration, child, true),
                      )}
                    </div>
                  ) : null}

                  <div className="inline-actions">
                    <Link
                      className="button button--primary button--small"
                      to={getActivitiesPath(data.stakeId)}
                    >
                      <AppIcon name="ticket" />
                      <span>Iscrivi a un'attività</span>
                    </Link>
                    <button
                      className="button button--soft button--small"
                      disabled={busy}
                      onClick={() => openEditChild(child)}
                      type="button"
                    >
                      Modifica profilo
                    </button>
                    <button
                      className="button button--ghost button--small"
                      disabled={busy}
                      onClick={() => void handleDeleteChild(child)}
                      type="button"
                    >
                      Rimuovi
                    </button>
                  </div>
                </article>
              );
            })}

            <div className="inline-actions">
              <button className="button button--soft" onClick={openCreateChild} type="button">
                <AppIcon name="plus" />
                <span>{FAMIGLIA.aggiungiFiglio}</span>
              </button>
            </div>
          </div>
        )}
      </section>

      {consentTarget ? (
        <ConsentModal
          target={consentTarget}
          choices={consentChoices}
          saving={consentSaving}
          error={consentError}
          stale={consentStale}
          reloading={consentReloading}
          onReload={() => void handleConsentReload()}
          onChange={(next) => {
            setConsentError(null);
            setConsentChoices(next);
          }}
          onClose={closeConsentModal}
          onSave={() => void handleConsentSave()}
        />
      ) : null}

      {childModalOpen ? (
        <AppModal
          title={
            editingChild
              ? fillCopy(FAMIGLIA.modificaProfilo, {
                  nome: editingChild.fullName || editingChild.firstName,
                })
              : FAMIGLIA.aggiungiFiglio
          }
          subtitle="I dati servono a precompilare le iscrizioni alle attività."
          onClose={() => setChildModalOpen(false)}
        >
          <form className="stack" onSubmit={(event) => void handleChildSubmit(event)}>
            <label className="field">
              <span>Nome *</span>
              <input
                required
                type="text"
                value={childForm.firstName}
                onChange={(event) =>
                  setChildForm((current) => ({ ...current, firstName: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Cognome *</span>
              <input
                required
                type="text"
                value={childForm.lastName}
                onChange={(event) =>
                  setChildForm((current) => ({ ...current, lastName: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Data di nascita *</span>
              <input
                required
                type="date"
                value={childForm.birthDate}
                onChange={(event) =>
                  setChildForm((current) => ({ ...current, birthDate: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Gruppo *</span>
              <select
                required
                value={childForm.genderRoleCategory}
                onChange={(event) =>
                  setChildForm((current) => ({
                    ...current,
                    genderRoleCategory: event.target
                      .value as ChildFormState["genderRoleCategory"],
                  }))
                }
              >
                <option value="">Seleziona...</option>
                <option value="giovane_uomo">Giovane Uomo</option>
                <option value="giovane_donna">Giovane Donna</option>
              </select>
            </label>
            <label className="field">
              <span>Unità (rione/ramo)</span>
              <select
                value={childForm.unitId}
                onChange={(event) =>
                  setChildForm((current) => ({ ...current, unitId: event.target.value }))
                }
              >
                <option value="">Seleziona...</option>
                {data.units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="inline-actions">
              <button className="button button--primary" disabled={busy} type="submit">
                {busy ? "Salvataggio..." : editingChild ? "Salva modifiche" : "Aggiungi"}
              </button>
              <button
                className="button button--ghost"
                onClick={() => setChildModalOpen(false)}
                type="button"
              >
                Annulla
              </button>
            </div>
          </form>
        </AppModal>
      ) : null}
    </div>
  );
}

function ConsentModal({
  target,
  choices,
  saving,
  error,
  stale,
  reloading,
  onReload,
  onChange,
  onClose,
  onSave,
}: {
  target: ConsentTarget;
  choices: ConsentChoicesValue;
  saving: boolean;
  error: string | null;
  stale: boolean;
  reloading: boolean;
  onReload: () => void;
  onChange: (value: ConsentChoicesValue) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const state = target.registration.parentAuthorization;
  const initialPhoto = consentChoiceFromDecision(state?.photoConsent);
  const initialSocial = consentChoiceFromDecision(state?.socialPublicationConsent);
  const problem = getConsentChoicesProblem(choices.photo, choices.social);
  // Una scelta mancante (firma vecchia) si salva anche senza modifiche: va
  // data una risposta, anche il no.
  const incomplete = initialPhoto === null || initialSocial === null;
  const changed = choices.photo !== initialPhoto || choices.social !== initialSocial;
  const withdrawsConsent =
    (initialPhoto === "accepted" && choices.photo === "refused") ||
    (initialSocial === "accepted" && choices.social === "refused");
  const canSave = problem === null && (changed || incomplete) && !saving && !stale;

  return (
    <AppModal
      title="Foto e social"
      subtitle={`Per ${target.childName} · ${target.eventTitle}`}
      onClose={onClose}
      footer={
        <div className="inline-actions">
          <button
            className="button button--primary"
            disabled={!canSave}
            onClick={onSave}
            type="button"
          >
            {saving ? "Salvataggio..." : "Salva"}
          </button>
          {stale ? (
            <button
              className="button button--soft"
              disabled={reloading}
              onClick={onReload}
              type="button"
            >
              {reloading ? "Un attimo..." : "Ricarica le scelte"}
            </button>
          ) : null}
          <button className="button button--ghost" disabled={saving} onClick={onClose} type="button">
            Annulla
          </button>
        </div>
      }
    >
      <div className="stack">
        <p className="subtle-text">
          Il rifiuto non impedisce la partecipazione all'attività. Non serve rifare la firma.
        </p>
        <ConsentChoices value={choices} onChange={onChange} disabled={saving} />
        {withdrawsConsent ? (
          <p className="consent-note">
            <AppIcon name="bell" />
            <span>
              Le foto già fatte non vengono cancellate in automatico: gli organizzatori le
              rivedono e tolgono quelle che non puoi più autorizzare.
            </span>
          </p>
        ) : null}
        {error ? (
          <p className="consent-choices__error" role="alert">
            <AppIcon name="bell" />
            <span>{error}</span>
          </p>
        ) : null}
        {problem ? <p className="subtle-text">{problem}</p> : null}
      </div>
    </AppModal>
  );
}
