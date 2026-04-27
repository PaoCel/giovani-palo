import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { EmptyState } from "@/components/EmptyState";
import { PageHero } from "@/components/PageHero";
import { SectionCard } from "@/components/SectionCard";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useAuth } from "@/hooks/useAuth";
import { adminEventsService } from "@/services/firestore/adminEventsService";
import type { Registration, RegistrationStatus } from "@/types";
import { formatDateTime } from "@/utils/formatters";
import { getGenderRoleCategoryLabel } from "@/utils/profile";
import {
  formatRegistrationAnswerValue,
  getRegistrationAnswerEntries,
  getRegistrationStatusLabel,
  getRegistrationStatusTone,
} from "@/utils/registrations";

interface DistributionItem {
  label: string;
  count: number;
  percent: number;
}

function buildDistribution<T>(
  items: T[],
  getLabel: (item: T) => string,
  fallbackLabel: string,
) {
  const counts = new Map<string, number>();

  for (const item of items) {
    const rawLabel = getLabel(item).trim();
    const label = rawLabel || fallbackLabel;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  const total = items.length || 1;

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "it"))
    .map<DistributionItem>(([label, count]) => ({
      label,
      count,
      percent: Math.round((count / total) * 100),
    }));
}

export function AdminRegistrationsPage() {
  const { eventId } = useParams();
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId ?? "roma-est";
  const [statusFilter, setStatusFilter] = useState<"all" | RegistrationStatus>("all");
  const [search, setSearch] = useState("");
  const [selectedRegistrationId, setSelectedRegistrationId] = useState<string | null>(null);

  const { data: workspace, loading, error } = useAsyncData(
    async () => {
      if (!eventId) {
        return null;
      }

      return adminEventsService.getAdminEventWorkspace(stakeId, eventId);
    },
    [eventId, stakeId],
    null,
  );

  const filteredRegistrations = useMemo(() => {
    if (!workspace) {
      return [];
    }

    const normalizedSearch = search.trim().toLowerCase();

    return workspace.registrations.filter((registration) => {
      const matchesStatus =
        statusFilter === "all" || registration.registrationStatus === statusFilter;
      const matchesSearch =
        !normalizedSearch ||
        registration.fullName.toLowerCase().includes(normalizedSearch) ||
        registration.email.toLowerCase().includes(normalizedSearch) ||
        registration.unitNameSnapshot.toLowerCase().includes(normalizedSearch);

      return matchesStatus && matchesSearch;
    });
  }, [search, statusFilter, workspace]);
  const activeRegistrations = useMemo(
    () =>
      filteredRegistrations.filter(
        (registration) =>
          registration.registrationStatus !== "cancelled" && registration.status !== "cancelled",
      ),
    [filteredRegistrations],
  );

  useEffect(() => {
    if (filteredRegistrations.length === 0) {
      setSelectedRegistrationId(null);
      return;
    }

    setSelectedRegistrationId((current) =>
      current && filteredRegistrations.some((registration) => registration.id === current)
        ? current
        : filteredRegistrations[0].id,
    );
  }, [filteredRegistrations]);

  if (!eventId) {
    return (
      <div className="page">
        <EmptyState
          title="Evento non specificato"
          description="Manca l'identificativo dell'evento da monitorare."
          action={
            <Link className="button button--primary" to="/admin/events">
              Torna alle attività
            </Link>
          }
        />
      </div>
    );
  }

  const selectedRegistration =
    filteredRegistrations.find((registration) => registration.id === selectedRegistrationId) ?? null;
  const detailEntries =
    workspace && selectedRegistration
      ? getRegistrationAnswerEntries(workspace.formConfig, selectedRegistration).filter(
          (entry) =>
            !["birthDate", "genderRoleCategory", "unitName", "youthGroup"].includes(entry.key),
        )
      : [];

  function getUnitLabel(registration: Registration) {
    return (
      registration.unitNameSnapshot ||
      (typeof registration.answers.unitName === "string" ? registration.answers.unitName : "") ||
      "Unità non indicata"
    );
  }

  function getCategoryLabel(registration: Registration) {
    return (
      getGenderRoleCategoryLabel(registration.genderRoleCategory) || "Organizzazione non indicata"
    );
  }

  const organizationDistribution = useMemo(
    () =>
      buildDistribution(
        activeRegistrations,
        (registration) => getCategoryLabel(registration),
        "Organizzazione non indicata",
      ),
    [activeRegistrations],
  );
  const unitDistribution = useMemo(
    () =>
      buildDistribution(
        activeRegistrations,
        (registration) => getUnitLabel(registration),
        "Unità non indicata",
      ),
    [activeRegistrations],
  );
  const cityDistribution = useMemo(
    () =>
      buildDistribution(
        activeRegistrations,
        (registration) =>
          typeof registration.answers.city === "string" ? registration.answers.city : "",
        "Città non indicata",
      ),
    [activeRegistrations],
  );
  const registrationsWithAccount = activeRegistrations.filter((registration) => Boolean(registration.userId)).length;
  const anonymousRegistrations = activeRegistrations.length - registrationsWithAccount;

  return (
    <div className="page">
      <PageHero
        eyebrow="Registrazioni evento"
        title={workspace?.event.title ?? "Registrazioni evento"}
        description="Elenco rapido degli iscritti con dettaglio completo al tocco."
        actions={
          <Link className="button button--ghost" to={`/admin/events/${eventId}`}>
            Torna all'attività
          </Link>
        }
      />

      <SectionCard title="Filtri" description="Cerca per nome, email o unità.">
        <div className="card-grid card-grid--two">
          <label className="field">
            <span>Cerca</span>
            <input
              className="input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nome, email o unità"
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
            <h3>Impossibile leggere le registrazioni</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      <SectionCard title="Statistiche" description="Panoramica sulle iscrizioni attive.">
        {loading ? (
          <p className="subtle-text">Sto preparando le statistiche...</p>
        ) : !workspace ? (
          <p className="subtle-text">Statistiche non disponibili.</p>
        ) : (
          <div className="form-stack">
            <div className="card-grid card-grid--three">
              <StatCard
                label="Iscritti attivi"
                value={activeRegistrations.length}
                description="Registrazioni non annullate."
              />
              <StatCard
                label="Con account"
                value={registrationsWithAccount}
                description="Partecipanti autenticati."
              />
              <StatCard
                label="Senza account"
                value={anonymousRegistrations}
                description="Registrazioni ospite."
              />
            </div>

            <div className="card-grid card-grid--three">
              <article className="surface-panel surface-panel--subtle admin-insight-panel">
                <h3>Organizzazione</h3>
                {organizationDistribution.length === 0 ? (
                  <p className="subtle-text">Nessun dato disponibile.</p>
                ) : (
                  <ul className="plain-list">
                    {organizationDistribution.map((item) => (
                      <li key={`organization-${item.label}`}>
                        <strong>{item.label}</strong>
                        <span>{item.count} • {item.percent}%</span>
                      </li>
                    ))}
                  </ul>
                )}
              </article>

              <article className="surface-panel surface-panel--subtle admin-insight-panel">
                <h3>Unità</h3>
                {unitDistribution.length === 0 ? (
                  <p className="subtle-text">Nessun dato disponibile.</p>
                ) : (
                  <ul className="plain-list">
                    {unitDistribution.slice(0, 8).map((item) => (
                      <li key={`unit-${item.label}`}>
                        <strong>{item.label}</strong>
                        <span>{item.count} • {item.percent}%</span>
                      </li>
                    ))}
                  </ul>
                )}
              </article>

              <article className="surface-panel surface-panel--subtle admin-insight-panel">
                <h3>Città</h3>
                {cityDistribution.length === 0 ? (
                  <p className="subtle-text">Nessun dato disponibile.</p>
                ) : (
                  <ul className="plain-list">
                    {cityDistribution.slice(0, 8).map((item) => (
                      <li key={`city-${item.label}`}>
                        <strong>{item.label}</strong>
                        <span>{item.count} • {item.percent}%</span>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Iscritti"
        description={`${filteredRegistrations.length} registrazioni trovate.`}
      >
        {loading ? (
          <p className="subtle-text">Caricamento registrazioni...</p>
        ) : !workspace || filteredRegistrations.length === 0 ? (
          <EmptyState
            title="Nessuna registrazione trovata"
            description="Le nuove iscrizioni compariranno qui."
          />
        ) : (
          <div className="selection-layout">
            <div className="selection-list" role="list" aria-label="Elenco iscritti">
              {filteredRegistrations.map((registration) => (
                <button
                  key={registration.id}
                  className={
                    selectedRegistration?.id === registration.id
                      ? "selection-card selection-card--active"
                      : "selection-card"
                  }
                  onClick={() => setSelectedRegistrationId(registration.id)}
                  type="button"
                >
                  <div className="selection-card__content">
                    <strong>{registration.fullName}</strong>
                    <p>{getCategoryLabel(registration)}</p>
                    <p>{getUnitLabel(registration)}</p>
                  </div>
                  <StatusBadge
                    label={getRegistrationStatusLabel(registration.registrationStatus)}
                    tone={getRegistrationStatusTone(registration.registrationStatus)}
                  />
                </button>
              ))}
            </div>

            {selectedRegistration ? (
              <article className="registration-detail">
                <div className="section-head">
                  <div>
                    <h3>{selectedRegistration.fullName}</h3>
                    <p>
                      {selectedRegistration.userId ? "Utente con account" : "Iscrizione senza account"}
                    </p>
                  </div>
                  <StatusBadge
                    label={getRegistrationStatusLabel(selectedRegistration.registrationStatus)}
                    tone={getRegistrationStatusTone(selectedRegistration.registrationStatus)}
                  />
                </div>

                <dl className="summary-list">
                  <div>
                    <dt>Organizzazione</dt>
                    <dd>{getCategoryLabel(selectedRegistration)}</dd>
                  </div>
                  <div>
                    <dt>Unità</dt>
                    <dd>{getUnitLabel(selectedRegistration)}</dd>
                  </div>
                  <div>
                    <dt>Email</dt>
                    <dd>{selectedRegistration.email || "-"}</dd>
                  </div>
                  <div>
                    <dt>Telefono</dt>
                    <dd>{selectedRegistration.phone || "-"}</dd>
                  </div>
                  <div>
                    <dt>Data di nascita</dt>
                    <dd>{selectedRegistration.birthDate || "-"}</dd>
                  </div>
                  <div>
                    <dt>Aggiornata</dt>
                    <dd>{formatDateTime(selectedRegistration.updatedAt)}</dd>
                  </div>
                </dl>

                {detailEntries.length > 0 ? (
                  <div className="registration-detail__answers">
                    <h4>Dettagli registrazione</h4>
                    <ul className="plain-list">
                      {detailEntries.map((entry) => (
                        <li key={`${selectedRegistration.id}-${entry.key}`}>
                          <strong>{entry.label}</strong>
                          <span>{formatRegistrationAnswerValue(entry.value)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="subtle-text">Nessun dettaglio aggiuntivo oltre ai dati principali.</p>
                )}
              </article>
            ) : null}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
