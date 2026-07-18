import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { PageHero } from "@/components/PageHero";
import { CampGallery } from "@/components/camp/CampGallery";
import { SurveyAnswerView } from "@/components/survey/SurveyAnswerView";
import { useAuth } from "@/hooks/useAuth";
import { eventsService } from "@/services/firestore/eventsService";
import { surveysService } from "@/services/firestore/surveysService";
import type { Event } from "@/types";
import { formatEventWindow } from "@/utils/formatters";

const DEFAULT_STAKE_ID = "roma-est";

type CampTab = "gallery" | "survey";

function useHomeHref() {
  const { session } = useAuth();
  if (session?.isAdmin) return "/admin";
  if (session?.isUnitLeader) return "/unit";
  if (session?.isParent) return "/family";
  return "/me";
}

export function CampHubPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId || DEFAULT_STAKE_ID;
  const homeHref = useHomeHref();

  const [event, setEvent] = useState<Event | null>(null);
  const [hasSurvey, setHasSurvey] = useState(false);
  const [loading, setLoading] = useState(true);

  const initialTab: CampTab =
    searchParams.get("tab") === "sondaggio" ? "survey" : "gallery";
  const [tab, setTab] = useState<CampTab>(initialTab);

  useEffect(() => {
    if (!eventId || !stakeId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      eventsService.getEventById(stakeId, eventId),
      surveysService
        .listActiveQuestions(stakeId, eventId)
        .then((questions) => questions.length > 0)
        .catch(() => false),
    ])
      .then(([eventData, surveyExists]) => {
        if (cancelled) return;
        setEvent(eventData);
        setHasSurvey(surveyExists);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, stakeId]);

  function selectTab(next: CampTab) {
    setTab(next);
    const params = new URLSearchParams(searchParams);
    if (next === "survey") params.set("tab", "sondaggio");
    else params.delete("tab");
    setSearchParams(params, { replace: true });
  }

  const heroTitle = useMemo(() => event?.title ?? "Campeggio", [event]);

  if (!eventId) {
    return (
      <div className="page">
        <PageHero className="hero--compact" eyebrow="Campeggio" title="Campeggio" />
        <p className="subtle-text">Campeggio non trovato.</p>
        <Link className="button button--ghost" to={homeHref}>
          Torna alla home
        </Link>
      </div>
    );
  }

  return (
    <div className="page camp-hub">
      <PageHero
        className="hero--compact"
        eyebrow="Ricordi del campeggio"
        title={heroTitle}
        description={event ? formatEventWindow(event) : undefined}
        actions={
          <Link className="button button--ghost" to={homeHref}>
            Torna alla home
          </Link>
        }
      />

      <div className="camp-hub__tabs" role="tablist" aria-label="Sezioni campeggio">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "gallery"}
          className={`camp-hub__tab${tab === "gallery" ? " camp-hub__tab--active" : ""}`}
          onClick={() => selectTab("gallery")}
        >
          Galleria
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "survey"}
          className={`camp-hub__tab${tab === "survey" ? " camp-hub__tab--active" : ""}`}
          onClick={() => selectTab("survey")}
        >
          Sondaggio
        </button>
      </div>

      {tab === "gallery" ? (
        <section className="camp-hub__panel">
          <CampGallery stakeId={stakeId} eventId={eventId} />
        </section>
      ) : (
        <section className="camp-hub__panel">
          {!loading && !hasSurvey ? (
            <p className="subtle-text">
              Il sondaggio del campeggio non è ancora disponibile. Torna più tardi.
            </p>
          ) : (
            <SurveyAnswerView
              stakeId={stakeId}
              eventId={eventId}
              showHero={false}
              backHref={homeHref}
              backLabel="Torna alla home"
            />
          )}
        </section>
      )}
    </div>
  );
}
