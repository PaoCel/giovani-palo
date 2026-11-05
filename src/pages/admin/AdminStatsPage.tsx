import { useMemo } from "react";
import { Link } from "react-router-dom";

import { AdminListSkeleton } from "@/components/AdminListSkeleton";
import { ButtonLink, Card, EmptyState, Icon, Notice, PageHeader, Pill } from "@/components/ui";
import { ADMIN_ELENCHI as COPY } from "@/copy/adminElenchi";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useAuth } from "@/hooks/useAuth";
import { adminEventsService } from "@/services/firestore/adminEventsService";
import { getGenderRoleCategoryLabel } from "@/utils/profile";
import {
  getRegistrationStatusLabel,
  getRegistrationStatusTone,
} from "@/utils/registrations";
import { DEFAULT_STAKE_ID } from "@/config/app";
import "@/styles/adminPages.css";

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
  const stakeId = session?.profile.stakeId ?? DEFAULT_STAKE_ID;
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

  const totals = [
    { label: "Iscritti attivi del palo", value: activeEntries.length, icon: "users" as const },
    { label: "Registrazioni totali", value: entries.length, icon: "list" as const },
    { label: "Iscritti con account", value: authenticatedEntries.length, icon: "user" as const },
    { label: "Iscritti come ospiti", value: anonymousEntries.length, icon: "ticket" as const },
  ];
  const distributions = [
    { key: "unit", title: "Unità", items: unitDistribution },
    { key: "org", title: "Organizzazione", items: organizationDistribution },
    { key: "city", title: "Città", items: cityDistribution },
  ];

  let list;
  if (loading) {
    list = <AdminListSkeleton label={COPY.statisticheCaricamento} />;
  } else if (error) {
    list = null;
  } else if (entries.length === 0) {
    list = (
      <EmptyState
        action={
          <ButtonLink to="/admin/events" variant="secondary">
            {COPY.vediTutteLeAttivita}
          </ButtonLink>
        }
        description={COPY.statisticheVuotoCorpo}
        headingAs="h3"
        title={COPY.statisticheVuotoTitolo}
      />
    );
  } else {
    list = (
      <ul className="admin-rows admin-rows--cards">
        {entries.map(({ eventId, eventTitle, registration }) => (
          <li key={`${eventId}:${registration.id}`}>
            <Link className="admin-row" to={`/admin/events/${eventId}`}>
              <span className="admin-row__info">
                <strong className="admin-row__title">{registration.fullName}</strong>
                <span className="admin-row__text">{eventTitle}</span>
                <span className="admin-row__text admin-row__text--muted">
                  {getGenderRoleCategoryLabel(registration.genderRoleCategory) || "Organizzazione non indicata"}
                  {" · "}
                  {registration.unitNameSnapshot || "Unità non indicata"}
                </span>
                <span className="admin-row__pills">
                  <Pill dot tone={getRegistrationStatusTone(registration.registrationStatus)}>
                    {getRegistrationStatusLabel(registration.registrationStatus)}
                  </Pill>
                </span>
              </span>
              <span className="sr-only">{COPY.apriAttivita}</span>
              <Icon name="arrow-right" className="admin-row__arrow" />
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="page page--admin-stats">
      <PageHeader description={COPY.statisticheDescrizione} title={COPY.statisticheTitolo} />

      {error ? (
        <Notice title={COPY.statisticheErrore} tone="warning">
          <p>{error}</p>
        </Notice>
      ) : null}

      <section aria-label={COPY.totali}>
        <ul className="admin-stats">
          {totals.map((item) => (
            <li key={item.label} className="admin-stat">
              <span className="admin-stat__icon" aria-hidden="true">
                <Icon name={item.icon} />
              </span>
              <span className="admin-stat__label">{item.label}</span>
              <strong className="admin-stat__value">{loading || error ? "…" : item.value}</strong>
            </li>
          ))}
        </ul>
      </section>

      {!loading && activeEntries.length > 0 ? (
        <div className="admin-distributions">
          {distributions.map((distribution) => (
            <Card key={distribution.key} title={distribution.title} titleAs="h2">
              <ul className="admin-bars">
                {distribution.items.map((item) => (
                  <li key={`${distribution.key}-${item.label}`} className="admin-bar">
                    <span className="admin-bar__label">{item.label}</span>
                    <span className="admin-bar__value">
                      {item.count} · {item.percent}%
                    </span>
                    <span aria-hidden="true" className="admin-bar__track">
                      <span className="admin-bar__fill" style={{ width: `${item.percent}%` }} />
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      ) : null}

      <section className="admin-block">
        <div className="admin-block__head">
          <h2>{COPY.iscrittiGlobali}</h2>
        </div>
        {list ? <Card>{list}</Card> : null}
      </section>
    </div>
  );
}
