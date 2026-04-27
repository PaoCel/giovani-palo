import { useMemo } from "react";
import { Link } from "react-router-dom";

import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useAuth } from "@/hooks/useAuth";
import { adminEventsService } from "@/services/firestore/adminEventsService";
import { getGenderRoleCategoryLabel } from "@/utils/profile";
import {
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

export function AdminStatsPage() {
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId ?? "roma-est";
  const { data: entries, loading, error } = useAsyncData(
    () => adminEventsService.listStakeRegistrations(stakeId),
    [stakeId],
    [],
  );

  const activeEntries = useMemo(
    () =>
      entries.filter(({ registration }) => registration.registrationStatus !== "cancelled"),
    [entries],
  );
  const authenticatedEntries = useMemo(
    () =>
      activeEntries.filter(({ registration }) => registration.submittedByMode === "authenticated"),
    [activeEntries],
  );
  const anonymousEntries = useMemo(
    () => activeEntries.filter(({ registration }) => registration.submittedByMode === "anonymous"),
    [activeEntries],
  );
  const unitDistribution = useMemo(
    () =>
      buildDistribution(
        activeEntries,
        ({ registration }) => registration.unitNameSnapshot,
        "Unità non indicata",
      ),
    [activeEntries],
  );
  const cityDistribution = useMemo(
    () =>
      buildDistribution(
        activeEntries,
        ({ registration }) =>
          typeof registration.answers.city === "string" ? registration.answers.city : "",
        "Città non indicata",
      ),
    [activeEntries],
  );
  const organizationDistribution = useMemo(
    () =>
      buildDistribution(
        activeEntries,
        ({ registration }) => getGenderRoleCategoryLabel(registration.genderRoleCategory) || "",
        "Organizzazione non indicata",
      ),
    [activeEntries],
  );

  return (
    <div className="page">
      {error ? (
        <div className="notice notice--warning">
          <div>
            <h3>Statistiche non disponibili</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      <section className="admin-metrics">
        <article className="admin-metric">
          <strong>{loading ? "..." : activeEntries.length}</strong>
          <span>Iscritti attivi del palo</span>
        </article>
        <article className="admin-metric">
          <strong>{loading ? "..." : entries.length}</strong>
          <span>Registrazioni totali</span>
        </article>
        <article className="admin-metric">
          <strong>{loading ? "..." : authenticatedEntries.length}</strong>
          <span>Iscritti con account</span>
        </article>
        <article className="admin-metric">
          <strong>{loading ? "..." : anonymousEntries.length}</strong>
          <span>Iscritti come ospiti</span>
        </article>
      </section>

      <div className="card-grid card-grid--three">
        <article className="surface-panel surface-panel--subtle">
          <h3>Unità</h3>
          <ul className="plain-list">
            {unitDistribution.map((item) => (
              <li key={`unit-${item.label}`}>
                <strong>{item.label}</strong>
                <span>{item.count} • {item.percent}%</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="surface-panel surface-panel--subtle">
          <h3>Organizzazione</h3>
          <ul className="plain-list">
            {organizationDistribution.map((item) => (
              <li key={`org-${item.label}`}>
                <strong>{item.label}</strong>
                <span>{item.count} • {item.percent}%</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="surface-panel surface-panel--subtle">
          <h3>Città</h3>
          <ul className="plain-list">
            {cityDistribution.map((item) => (
              <li key={`city-${item.label}`}>
                <strong>{item.label}</strong>
                <span>{item.count} • {item.percent}%</span>
              </li>
            ))}
          </ul>
        </article>
      </div>

      <section className="admin-section">
        <div className="admin-section__head">
          <div>
            <h2>Iscritti globali del palo</h2>
          </div>
        </div>

        {loading ? (
          <p className="subtle-text">Sto preparando gli iscritti del palo...</p>
        ) : entries.length === 0 ? (
          <EmptyState
            title="Nessuna registrazione"
            description="Le iscrizioni globali compariranno qui."
          />
        ) : (
          <div className="stack">
            {entries.map(({ eventId, eventTitle, registration }) => (
              <article key={`${eventId}:${registration.id}`} className="surface-panel surface-panel--subtle admin-registration-row">
                <div>
                  <strong>{registration.fullName}</strong>
                  <p>{eventTitle}</p>
                  <p>
                    {getGenderRoleCategoryLabel(registration.genderRoleCategory) || "Organizzazione non indicata"}
                    {" • "}
                    {registration.unitNameSnapshot || "Unità non indicata"}
                  </p>
                </div>
                <div className="admin-registration-row__meta">
                  <StatusBadge
                    label={getRegistrationStatusLabel(registration.registrationStatus)}
                    tone={getRegistrationStatusTone(registration.registrationStatus)}
                  />
                  <Link className="admin-inline-link" to={`/admin/events/${eventId}`}>
                    Apri attività
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
