import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { PageHero } from "@/components/PageHero";
import { SectionCard } from "@/components/SectionCard";
import { useAuth } from "@/hooks/useAuth";
import { userActivitiesService } from "@/services/firestore/userActivitiesService";
import { isPastEvent } from "@/utils/events";
import { formatEventWindow } from "@/utils/formatters";

export function SurveyHubPage() {
  const { session } = useAuth();
  const [items, setItems] = useState<Awaited<
    ReturnType<typeof userActivitiesService.listStakeActivityFeed>
  >>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    userActivitiesService
      .listStakeActivityFeed(session)
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const past = items.filter(({ event }) => isPastEvent(event));

  return (
    <div className="page-content">
      <PageHero
        eyebrow="Sondaggi"
        title="Sondaggi post-evento"
        description="Lasciaci un feedback sulle attività a cui hai partecipato. Le risposte sono anonime."
      />

      {loading ? <p className="subtle-text">Caricamento...</p> : null}

      {!loading && past.length === 0 ? (
        <SectionCard title="Nessuna attività disponibile">
          <p>Quando un'attività finisce potrai compilare il sondaggio.</p>
          <Link className="button button--ghost" to="/me">
            Torna alla dashboard
          </Link>
        </SectionCard>
      ) : null}

      <div className="stack">
        {past.map(({ event }) => (
          <article key={event.id} className="surface-panel surface-panel--subtle">
            <strong>{event.title}</strong>
            <p className="subtle-text">{formatEventWindow(event)}</p>
            <Link className="button button--ghost" to={`/me/sondaggi/${event.id}`}>
              Compila il sondaggio
            </Link>
          </article>
        ))}
      </div>
    </div>
  );
}
