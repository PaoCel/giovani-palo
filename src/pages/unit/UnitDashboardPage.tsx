import { Link } from "react-router-dom";

import type { AppIconName } from "@/components/AppIcon";
import { ActivityMediaHighlight } from "@/components/gallery/ActivityMediaHighlight";
import { FamilyHomeSection } from "@/components/family/FamilyHomeSection";
import { HomeFeed } from "@/components/feed/HomeFeed";
import { MembershipQueueCards } from "@/components/membership/MembershipQueueCards";
import { Card, EmptyState, Icon, Notice, PageHeader } from "@/components/ui";
import { HOME_UNITA } from "@/copy/homeUnita";
import { fillCopy } from "@/copy/parole";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useAuth } from "@/hooks/useAuth";
import { unitLeaderService, type UnitActivitySummary } from "@/services/firestore/unitLeaderService";
import { DEFAULT_STAKE_ID } from "@/config/app";
import dirigenteUrl from "@/assets/flusso-genitore/dirigente.webp";

import "@/styles/unitHome.css";

type StatKey = "iscritti" | "passaggio" | "consensoFoto" | "consensoGenitore";
type StatTone = "ok" | "warn" | "danger";

// Riquadri dei totali e indicatori delle righe: stessa icona e stessa parola,
// così la riga si legge senza legenda.
const STATS: { key: StatKey; icon: AppIconName; tone: StatTone; label: string }[] = [
  { key: "iscritti", icon: "users", tone: "ok", label: HOME_UNITA.iscritti },
  { key: "passaggio", icon: "map-pin", tone: "warn", label: HOME_UNITA.passaggio },
  { key: "consensoFoto", icon: "eye", tone: "warn", label: HOME_UNITA.consensoFoto },
  { key: "consensoGenitore", icon: "badge", tone: "danger", label: HOME_UNITA.consensoGenitore },
];

function statsOf(summary: UnitActivitySummary): Record<StatKey, number> {
  return {
    iscritti: summary.stats.total,
    passaggio: summary.stats.needsTransport,
    consensoFoto: summary.stats.missingPhotoConsent,
    consensoGenitore: summary.stats.missingParentConsent,
  };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("it-IT", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function ActivityRow({ summary }: { summary: UnitActivitySummary }) {
  const values = statsOf(summary);
  // Gli avvisi compaiono solo quando c'è qualcosa da sistemare; gli iscritti sempre.
  const shown = STATS.filter((stat) => stat.key === "iscritti" || values[stat.key] > 0);

  return (
    <li>
      <Link className="unit-home-row" to={`/unit/activities/${summary.eventId}`}>
        <span className="unit-home-row__info">
          <strong className="unit-home-row__title">{summary.eventTitle}</strong>
          <span className="unit-home-row__date">{formatDate(summary.eventStartDate)}</span>
        </span>
        <span className="unit-home-row__stats">
          {shown.map((stat) => (
            <span className={`unit-home-stat unit-home-stat--${stat.tone}`} key={stat.key}>
              <Icon name={stat.icon} />
              <span aria-hidden="true">{values[stat.key]}</span>
              <span className="sr-only">
                {fillCopy(HOME_UNITA.indicatore, { n: String(values[stat.key]), cosa: stat.label })}
              </span>
            </span>
          ))}
        </span>
        <Icon name="arrow-right" className="unit-home-row__arrow" />
      </Link>
    </li>
  );
}

export function UnitDashboardPage() {
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId ?? DEFAULT_STAKE_ID;
  const unitId = session?.profile.unitId ?? "";
  const unitName = session?.profile.unitName || HOME_UNITA.unitaDiRiserva;

  const { data: summaries, loading, error } = useAsyncData(
    () => unitLeaderService.getUnitActivitySummaries(stakeId, unitId),
    [stakeId, unitId],
    [],
  );

  const totals = summaries.reduce<Record<StatKey, number>>(
    (acc, summary) => {
      const values = statsOf(summary);
      return {
        iscritti: acc.iscritti + values.iscritti,
        passaggio: acc.passaggio + values.passaggio,
        consensoFoto: acc.consensoFoto + values.consensoFoto,
        consensoGenitore: acc.consensoGenitore + values.consensoGenitore,
      };
    },
    { iscritti: 0, passaggio: 0, consensoFoto: 0, consensoGenitore: 0 },
  );

  let activities;
  if (error) {
    activities = (
      <Notice tone="warning" title={HOME_UNITA.erroreAttivita}>
        <p>{error}</p>
      </Notice>
    );
  } else if (loading) {
    activities = (
      <div aria-busy="true" className="unit-home-skeleton">
        <span className="sr-only" role="status">{HOME_UNITA.caricamentoAttivita}</span>
        {[0, 1, 2].map((item) => (
          <span aria-hidden="true" className="unit-home-skeleton__row" key={item} />
        ))}
      </div>
    );
  } else if (summaries.length === 0) {
    activities = (
      <EmptyState
        action={null}
        description={HOME_UNITA.vuotoCorpo}
        headingAs="h3"
        illustration={dirigenteUrl}
        title={HOME_UNITA.vuotoTitolo}
      />
    );
  } else {
    activities = (
      <ul className="unit-home-rows">
        {summaries.map((summary) => (
          <ActivityRow key={summary.eventId} summary={summary} />
        ))}
      </ul>
    );
  }

  return (
    <div className="page page--unit-dashboard">
      <PageHeader
        description={fillCopy(HOME_UNITA.descrizione, { unita: unitName })}
        title={HOME_UNITA.titolo}
      />

      {unitId ? (
        <MembershipQueueCards peoplePath="/unit/persone" stakeId={stakeId} unitId={unitId} />
      ) : (
        <Notice live="none" title={HOME_UNITA.senzaUnitaTitolo} tone="warning">
          <p>{HOME_UNITA.senzaUnitaCorpo}</p>
        </Notice>
      )}

      {!loading && summaries.length > 0 ? (
        <section aria-label={HOME_UNITA.totali} className="unit-home-metrics">
          {STATS.map((stat) => {
            const value = totals[stat.key];
            return (
              <article
                className={value > 0 ? `unit-home-metric unit-home-metric--${stat.tone}` : "unit-home-metric"}
                key={stat.key}
              >
                <span aria-hidden="true" className="unit-home-metric__icon">
                  <Icon name={stat.icon} />
                </span>
                <strong className="unit-home-metric__value">{value}</strong>
                <span className="unit-home-metric__label">{stat.label}</span>
              </article>
            );
          })}
        </section>
      ) : null}

      <Card className="unit-home-activities" subtitle={HOME_UNITA.attivitaDescrizione} title={HOME_UNITA.attivitaTitolo}>
        {activities}
      </Card>

      {/* Figli del dirigente (G2): iscritti da qui, seguiti in Famiglia. */}
      <FamilyHomeSection variant="unit" />

      <ActivityMediaHighlight />

      <section className="user-dashboard-section">
        <div className="user-section-heading">
          <h2>{HOME_UNITA.feedTitolo}</h2>
          <p className="subtle-text">{HOME_UNITA.feedDescrizione}</p>
        </div>
        <HomeFeed />
      </section>
    </div>
  );
}
