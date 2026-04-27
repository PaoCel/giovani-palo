import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { EmptyState } from "@/components/EmptyState";
import { PageHero } from "@/components/PageHero";
import { SectionCard } from "@/components/SectionCard";
import { StatusBadge } from "@/components/StatusBadge";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useAuth } from "@/hooks/useAuth";
import { adminEventsService } from "@/services/firestore/adminEventsService";
import type { RegistrationStatus } from "@/types";
import { formatDateTime } from "@/utils/formatters";
import { getGenderRoleCategoryLabel } from "@/utils/profile";
import {
  getRegistrationStatusLabel,
  getRegistrationStatusTone,
} from "@/utils/registrations";

export function AdminStakeRegistrationsPage() {
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId ?? "roma-est";
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | RegistrationStatus>("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const { data: entries, loading, error } = useAsyncData(
    () => adminEventsService.listStakeRegistrations(stakeId),
    [stakeId],
    [],
  );

  const filteredEntries = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return entries.filter(({ eventTitle, registration }) => {
      const matchesSearch =
        !normalizedSearch ||
        eventTitle.toLowerCase().includes(normalizedSearch) ||
        registration.fullName.toLowerCase().includes(normalizedSearch) ||
        registration.email.toLowerCase().includes(normalizedSearch) ||
        registration.unitNameSnapshot.toLowerCase().includes(normalizedSearch);
      const matchesStatus =
        statusFilter === "all" || registration.registrationStatus === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [entries, search, statusFilter]);

  useEffect(() => {
    if (filteredEntries.length === 0) {
      setSelectedKey(null);
      return;
    }

    setSelectedKey((current) =>
      current &&
      filteredEntries.some(({ eventId, registration }) => `${eventId}:${registration.id}` === current)
        ? current
        : `${filteredEntries[0].eventId}:${filteredEntries[0].registration.id}`,
    );
  }, [filteredEntries]);

  const selectedEntry =
    filteredEntries.find(({ eventId, registration }) => `${eventId}:${registration.id}` === selectedKey) ??
    null;

  function getUnitLabel(unitNameSnapshot: string, answerValue: unknown) {
    if (unitNameSnapshot) {
      return unitNameSnapshot;
    }

    return typeof answerValue === "string" && answerValue.trim()
      ? answerValue
      : "Unità non indicata";
  }

  return (
    <div className="page">
      <PageHero
        eyebrow="Iscritti"
        title="Registrazioni del palo"
        description="Lista compatta con dettaglio del partecipante selezionato."
        actions={
          <Link className="button button--ghost" to="/admin/events">
            Vai alle attività
          </Link>
        }
      />

      <SectionCard title="Filtri" description="Cerca per attività, nome, email o unità.">
        <div className="card-grid card-grid--two">
          <label className="field">
            <span>Cerca</span>
            <input
              className="input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Attività, nome, email o unità"
            />
          </label>

          <label className="field">
            <span>Stato iscrizione</span>
            <select
              className="input"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as "all" | RegistrationStatus)
              }
            >
              <option value="all">Tutti</option>
              <option value="active">Attiva</option>
              <option value="submitted">Inviata</option>
              <option value="confirmed">Confermata</option>
              <option value="waitlist">Lista d'attesa</option>
              <option value="cancelled">Annullata</option>
            </select>
          </label>
        </div>
      </SectionCard>

      {error ? (
        <div className="notice notice--warning">
          <div>
            <h3>Caricamento registrazioni non riuscito</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      <SectionCard
        title="Iscritti"
        description={`${filteredEntries.length} registrazioni trovate.`}
      >
        {loading ? (
          <p className="subtle-text">Sto caricando le registrazioni del palo...</p>
        ) : filteredEntries.length === 0 ? (
          <EmptyState
            title="Nessuna registrazione trovata"
            description="Le nuove iscrizioni compariranno qui."
          />
        ) : (
          <div className="selection-layout">
            <div className="selection-list" role="list" aria-label="Registrazioni del palo">
              {filteredEntries.map(({ eventId, eventTitle, registration }) => (
                <button
                  key={`${eventId}:${registration.id}`}
                  className={
                    selectedEntry &&
                    selectedEntry.eventId === eventId &&
                    selectedEntry.registration.id === registration.id
                      ? "selection-card selection-card--active"
                      : "selection-card"
                  }
                  onClick={() => setSelectedKey(`${eventId}:${registration.id}`)}
                  type="button"
                >
                  <div className="selection-card__content">
                    <strong>{registration.fullName}</strong>
                    <p>
                      {getGenderRoleCategoryLabel(registration.genderRoleCategory) ||
                        "Organizzazione non indicata"}
                    </p>
                    <p>
                      {getUnitLabel(
                        registration.unitNameSnapshot,
                        registration.answers.unitName,
                      )}
                    </p>
                    <p>{eventTitle}</p>
                  </div>
                  <StatusBadge
                    label={getRegistrationStatusLabel(registration.registrationStatus)}
                    tone={getRegistrationStatusTone(registration.registrationStatus)}
                  />
                </button>
              ))}
            </div>

            {selectedEntry ? (
              <article className="registration-detail">
                <div className="section-head">
                  <div>
                    <h3>{selectedEntry.registration.fullName}</h3>
                    <p>{selectedEntry.eventTitle}</p>
                  </div>
                  <StatusBadge
                    label={getRegistrationStatusLabel(
                      selectedEntry.registration.registrationStatus,
                    )}
                    tone={getRegistrationStatusTone(
                      selectedEntry.registration.registrationStatus,
                    )}
                  />
                </div>

                <dl className="summary-list">
                  <div>
                    <dt>Organizzazione</dt>
                    <dd>
                      {getGenderRoleCategoryLabel(
                        selectedEntry.registration.genderRoleCategory,
                      ) || "-"}
                    </dd>
                  </div>
                  <div>
                    <dt>Unità</dt>
                    <dd>
                      {getUnitLabel(
                        selectedEntry.registration.unitNameSnapshot,
                        selectedEntry.registration.answers.unitName,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Email</dt>
                    <dd>{selectedEntry.registration.email || "-"}</dd>
                  </div>
                  <div>
                    <dt>Telefono</dt>
                    <dd>{selectedEntry.registration.phone || "-"}</dd>
                  </div>
                  <div>
                    <dt>Canale</dt>
                    <dd>
                      {selectedEntry.registration.submittedByMode === "anonymous"
                        ? "Senza account"
                        : "Con account"}
                    </dd>
                  </div>
                  <div>
                    <dt>Aggiornata</dt>
                    <dd>{formatDateTime(selectedEntry.registration.updatedAt)}</dd>
                  </div>
                </dl>

                <div className="inline-actions">
                  <Link
                    className="button button--ghost button--small"
                    to={`/admin/events/${selectedEntry.eventId}/registrations`}
                  >
                    Apri elenco attività
                  </Link>
                  <Link
                    className="button button--soft button--small"
                    to={`/admin/events/${selectedEntry.eventId}`}
                  >
                    Apri attività
                  </Link>
                </div>
              </article>
            ) : null}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
