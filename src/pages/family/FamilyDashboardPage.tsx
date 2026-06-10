import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { AppIcon } from "@/components/AppIcon";
import { AppModal } from "@/components/AppModal";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncData } from "@/hooks/useAsyncData";
import { childrenService, type ChildWriteInput } from "@/services/firestore/childrenService";
import { eventsService } from "@/services/firestore/eventsService";
import { registrationsService } from "@/services/firestore/registrationsService";
import { stakesService } from "@/services/firestore/stakesService";
import { unitsService } from "@/services/firestore/unitsService";
import type { ChildProfile, Event, Registration, Unit } from "@/types";
import { getActivitiesPath, getActivityRegistrationPath } from "@/utils/activityLinks";
import { formatEventWindow } from "@/utils/formatters";
import { getRegistrationStatusLabel, getRegistrationStatusTone } from "@/utils/registrations";

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

export function FamilyDashboardPage() {
  const { session } = useAuth();
  const parentUid = session?.firebaseUser.uid ?? "";
  const [childModalOpen, setChildModalOpen] = useState(false);
  const [editingChild, setEditingChild] = useState<ChildProfile | null>(null);
  const [childForm, setChildForm] = useState<ChildFormState>(emptyChildForm);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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
          : "Impossibile salvare il profilo del figlio.",
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
      !window.confirm(`Rimuovere il profilo di ${child.fullName || "questo figlio"}?`)
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

        {loading ? (
          <p className="subtle-text">Sto caricando i profili della famiglia...</p>
        ) : data.children.length === 0 ? (
          <EmptyState
            title="Nessun figlio collegato"
            description="Aggiungi il profilo di un figlio per iscriverlo alle attività e seguirne lo stato."
            action={
              <button className="button button--primary" onClick={openCreateChild} type="button">
                <AppIcon name="plus" />
                <span>Aggiungi figlio/a</span>
              </button>
            }
          />
        ) : (
          <div className="stack">
            {data.children.map((child) => {
              const childRegistrations = activeRegistrations.filter(
                (registration) => registration.childId === child.id,
              );

              return (
                <article key={child.id} className="surface-panel surface-panel--subtle">
                  <div className="chip-row" style={{ justifyContent: "space-between" }}>
                    <strong>{child.fullName || child.firstName}</strong>
                    <span className="surface-chip">{child.unitName || "Unità da definire"}</span>
                  </div>
                  {child.birthDate ? (
                    <p className="subtle-text">Data di nascita: {child.birthDate}</p>
                  ) : null}

                  {childRegistrations.length === 0 ? (
                    <p className="subtle-text">Nessuna iscrizione attiva.</p>
                  ) : (
                    <div className="stack">
                      {childRegistrations.map((registration) => {
                        const event = eventById.get(registration.eventId);
                        return (
                          <div key={registration.id} className="chip-row">
                            <StatusBadge
                              label={getRegistrationStatusLabel(registration.registrationStatus)}
                              tone={getRegistrationStatusTone(registration.registrationStatus)}
                            />
                            <span>{event?.title ?? "Attività"}</span>
                            {event ? (
                              <span className="subtle-text">{formatEventWindow(event)}</span>
                            ) : null}
                            <Link
                              className="button button--ghost button--small"
                              to={`${getActivityRegistrationPath(registration.eventId, registration.stakeId)}${getActivityRegistrationPath(registration.eventId, registration.stakeId).includes("?") ? "&" : "?"}child=${child.id}`}
                            >
                              Gestisci
                            </Link>
                          </div>
                        );
                      })}
                    </div>
                  )}

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
                <span>Aggiungi un altro figlio/a</span>
              </button>
            </div>
          </div>
        )}
      </section>

      {childModalOpen ? (
        <AppModal
          title={editingChild ? "Modifica profilo figlio" : "Aggiungi figlio/a"}
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
