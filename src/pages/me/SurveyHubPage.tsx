import { getSurveyHref } from "@/utils/surveyLinks";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { MemberLockedNote } from "@/components/membership/MemberLockedNote";
import { PageHero } from "@/components/PageHero";
import { SectionCard } from "@/components/SectionCard";
import { useAuth } from "@/hooks/useAuth";
import { useStakeMembership } from "@/hooks/useStakeMembership";
import { userActivitiesService } from "@/services/firestore/userActivitiesService";
import { isPastEvent } from "@/utils/events";
import { formatEventWindow } from "@/utils/formatters";

export function SurveyHubPage() {
  const { session } = useAuth();
  const { access } = useStakeMembership(session?.profile.stakeId ?? "");
  // I sondaggi sono dei membri: chi è in coda o fuori ha la sua frase e niente
  // elenco; finché il documento members non arriva non si mostra nulla.
  // Senza account personale (ospite) vale come fuori: i sondaggi sono dei membri.
  const locked = access === "waiting" || access === "out" || access === "guest";
  const canList = access === "member";
  const [items, setItems] = useState<Awaited<
    ReturnType<typeof userActivitiesService.listStakeActivityFeed>
  >>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!canList) return undefined;
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
  }, [session, canList]);

  const past = items.filter(({ event }) => isPastEvent(event));

  return (
    <div className="page-content">
      <PageHero
        eyebrow="Sondaggi"
        title="Sondaggi post-evento"
        description="Lasciaci un feedback sulle attività a cui hai partecipato. Le risposte sono anonime."
      />

      {locked ? (
        <SectionCard title="Sondaggi non disponibili">
          <MemberLockedNote access={access === "guest" ? "out" : access} kind="sondaggi" />
          <Link className="button button--ghost" to="/me">
            Torna alla dashboard
          </Link>
        </SectionCard>
      ) : null}

      {!locked && loading ? <p className="subtle-text">Caricamento...</p> : null}

      {canList && !loading && past.length === 0 ? (
        <SectionCard title="Nessuna attività disponibile">
          <p>Quando un'attività finisce potrai compilare il sondaggio.</p>
          <Link className="button button--ghost" to="/me">
            Torna alla dashboard
          </Link>
        </SectionCard>
      ) : null}

      <div className="stack">
        {(canList ? past : []).map(({ event }) => (
          <article key={event.id} className="surface-panel surface-panel--subtle">
            <strong>{event.title}</strong>
            <p className="subtle-text">{formatEventWindow(event)}</p>
            <Link className="button button--ghost" to={getSurveyHref(event.id)}>
              Compila il sondaggio
            </Link>
          </article>
        ))}
      </div>
    </div>
  );
}
