import { Link } from "react-router-dom";

import { AppIcon } from "@/components/AppIcon";
import { EmptyState } from "@/components/EmptyState";
import { HomeFeed } from "@/components/feed/HomeFeed";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useAuth } from "@/hooks/useAuth";
import { unitLeaderService, type UnitActivitySummary } from "@/services/firestore/unitLeaderService";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("it-IT", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function ActivityRow({ summary }: { summary: UnitActivitySummary }) {
  const { stats } = summary;

  return (
    <Link className="unit-activity-row" to={`/unit/activities/${summary.eventId}`}>
      <div className="unit-activity-row__info">
        <strong className="unit-activity-row__title">{summary.eventTitle}</strong>
        <span className="unit-activity-row__date">{formatDate(summary.eventStartDate)}</span>
      </div>

      <div className="unit-activity-row__stats">
        <span className="unit-stat unit-stat--ok" title="Iscritti unità">
          <AppIcon name="users" />
          {stats.total}
        </span>

        {stats.needsTransport > 0 && (
          <span className="unit-stat unit-stat--warn" title="Passaggio necessario / trasporto da definire">
            <AppIcon name="map-pin" />
            {stats.needsTransport}
          </span>
        )}

        {stats.missingPhotoConsent > 0 && (
          <span className="unit-stat unit-stat--warn" title="Consenso foto mancante">
            <AppIcon name="eye" />
            {stats.missingPhotoConsent}
          </span>
        )}

        {stats.missingParentConsent > 0 && (
          <span className="unit-stat unit-stat--danger" title="Modulo genitore mancante (minorenni)">
            <AppIcon name="badge" />
            {stats.missingParentConsent}
          </span>
        )}

        <AppIcon name="arrow-right" />
      </div>
    </Link>
  );
}

export function UnitDashboardPage() {
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId ?? "roma-est";
  const unitId = session?.profile.unitId ?? "";
  const unitName = session?.profile.unitName || "la tua unità";

  const { data: summaries, loading, error } = useAsyncData(
    () => unitLeaderService.getUnitActivitySummaries(stakeId, unitId, unitName),
    [stakeId, unitId, unitName],
    [],
  );

  const totals = summaries.reduce(
    (acc, s) => ({
      iscritti: acc.iscritti + s.stats.total,
      passaggio: acc.passaggio + s.stats.needsTransport,
      consensoFoto: acc.consensoFoto + s.stats.missingPhotoConsent,
      consensoGenitore: acc.consensoGenitore + s.stats.missingParentConsent,
    }),
    { iscritti: 0, passaggio: 0, consensoFoto: 0, consensoGenitore: 0 },
  );

  return (
    <div className="page page--unit-dashboard">
      <section className="admin-section">
        <div className="admin-section__head">
          <div>
            <h2>Benvenuto</h2>
            <p className="subtle-text">Vista per i dirigenti di {unitName}</p>
          </div>
        </div>
      </section>

      {!loading && summaries.length > 0 && (
        <section className="admin-metrics">
          <article className="admin-metric">
            <strong>{totals.iscritti}</strong>
            <span>Iscritti unità</span>
          </article>
          <article className="admin-metric admin-metric--warn">
            <strong>{totals.passaggio}</strong>
            <span>Passaggio necessario</span>
          </article>
          <article className="admin-metric admin-metric--warn">
            <strong>{totals.consensoFoto}</strong>
            <span>Consenso foto mancante</span>
          </article>
          <article className="admin-metric admin-metric--danger">
            <strong>{totals.consensoGenitore}</strong>
            <span>Modulo genitore mancante</span>
          </article>
        </section>
      )}

      <section className="admin-section">
        <div className="admin-section__head">
          <div>
            <h2>Attività del palo</h2>
            <p className="subtle-text">Ultime 6 attività — clicca per vedere i giovani della tua unità</p>
          </div>
        </div>

        {error ? (
          <div className="notice notice--warning">
            <div>
              <h3>Impossibile caricare le attività</h3>
              <p>{error}</p>
            </div>
          </div>
        ) : loading ? (
          <p className="subtle-text">Caricamento attività...</p>
        ) : summaries.length === 0 ? (
          <EmptyState
            title="Nessuna attività"
            description="Le attività del palo compariranno qui non appena pubblicate."
          />
        ) : (
          <div className="unit-activity-list">
            {summaries.map((s) => (
              <ActivityRow key={s.eventId} summary={s} />
            ))}
          </div>
        )}
      </section>

      <section className="admin-section">
        <div className="admin-section__head">
          <div>
            <h2>Legenda</h2>
          </div>
        </div>
        <div className="unit-legend">
          <span className="unit-stat unit-stat--ok"><AppIcon name="users" /> Iscritti unità</span>
          <span className="unit-stat unit-stat--warn"><AppIcon name="map-pin" /> Passaggio necessario / da definire</span>
          <span className="unit-stat unit-stat--warn"><AppIcon name="eye" /> Consenso foto mancante</span>
          <span className="unit-stat unit-stat--danger"><AppIcon name="badge" /> Modulo genitore mancante</span>
        </div>
      </section>

      <section className="user-dashboard-section">
        <div className="user-section-heading">
          <h2>Dalle attività</h2>
          <p className="subtle-text">
            Ultime novità e gallerie dello stake.
          </p>
        </div>
        <HomeFeed />
      </section>
    </div>
  );
}
