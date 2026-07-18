import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { AppIcon } from "@/components/AppIcon";
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
  const [surveyChecked, setSurveyChecked] = useState(false);

  const initialTab: CampTab =
    searchParams.get("tab") === "sondaggio" ? "survey" : "gallery";
  const [tab, setTab] = useState<CampTab>(initialTab);

  useEffect(() => {
    if (!eventId || !stakeId) return;
    let cancelled = false;
    // Evento e presenza sondaggio non bloccano la galleria: quest'ultima si
    // carica per conto suo (cache-first). Qui solo titolo + tab sondaggio.
    eventsService
      .getEventById(stakeId, eventId)
      .then((eventData) => {
        if (!cancelled) setEvent(eventData);
      })
      .catch(() => undefined);
    surveysService
      .listActiveQuestions(stakeId, eventId)
      .then((questions) => {
        if (!cancelled) {
          setHasSurvey(questions.length > 0);
          setSurveyChecked(true);
        }
      })
      .catch(() => {
        if (!cancelled) setSurveyChecked(true);
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
  const cover = event?.coverImageUrl || event?.heroImageUrl || "";

  if (!eventId) {
    return (
      <div className="page">
        <p className="subtle-text">Campeggio non trovato.</p>
        <Link className="button button--ghost" to={homeHref}>
          Torna alla home
        </Link>
      </div>
    );
  }

  return (
    <div className="page camp-hub">
      <header className={`camp-hero${cover ? "" : " camp-hero--plain"}`}>
        {cover ? (
          <div
            className="camp-hero__bg"
            style={{ backgroundImage: `url(${cover})` }}
            aria-hidden="true"
          />
        ) : null}
        <div className="camp-hero__scrim" aria-hidden="true" />
        <div className="camp-hero__top">
          <Link className="camp-hero__back" to={homeHref} aria-label="Torna alla home">
            <AppIcon name="arrow-left" />
          </Link>
        </div>
        <div className="camp-hero__content">
          <span className="camp-hero__eyebrow">Ricordi del campeggio</span>
          <h1 className="camp-hero__title">{heroTitle}</h1>
          {event ? <p className="camp-hero__meta">{formatEventWindow(event)}</p> : null}
        </div>

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
      </header>

      {tab === "gallery" ? (
        <section className="camp-hub__panel">
          <CampGallery stakeId={stakeId} eventId={eventId} />
        </section>
      ) : (
        <section className="camp-hub__panel">
          {surveyChecked && !hasSurvey ? (
            <div className="camp-empty">
              <span className="camp-empty__emoji" aria-hidden="true">📝</span>
              <p>Il sondaggio del campeggio non è ancora disponibile. Torna più tardi.</p>
            </div>
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
