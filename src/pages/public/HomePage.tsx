import { useEffect, useRef } from "react";
import { Link, Navigate } from "react-router-dom";

import { ActivityScene } from "@/components/activities/ActivityScene";
import { usePublicStake } from "@/components/publicSite/PublicStakeProvider";
import { CATALOGO } from "@/copy/catalogo";
import { HOME } from "@/copy/home";
import { usePublishedActivities } from "@/hooks/usePublishedActivities";
import { useAuth } from "@/hooks/useAuth";
import { fillCopy } from "@/copy/parole";
import { getActivitiesPath, getActivityPath } from "@/utils/activityLinks";
import { formatHomeWhen, monthDay, shortMonth } from "@/utils/publicCatalog";
import { hasEventEnded } from "@/utils/publicEventState";
import type { Event } from "@/types";

const SYMBOL = "/theme-2026/simbolo-cammina-con-me.png";
const SOON = ["c1", "c2", "c3", "c1"] as const;

const THEME_LINKS = [
  {
    href: "https://www.churchofjesuschrist.org/callings/youth/2026-youth-theme?lang=ita",
    label: HOME.linkTema,
    note: HOME.linkTemaNota,
  },
  {
    href: "https://notizie.chiesadigesucristo.org/articolo/cammina-con-me-e-il-tema-del-2026-per-i-giovani-santi-degli-ultimi-giorni",
    label: HOME.linkSala,
    note: HOME.linkSalaNota,
  },
  {
    href: "https://www.churchofjesuschrist.org/media/music/collections/2026-youth-album?lang=ita",
    label: HOME.linkAlbum,
    note: HOME.linkAlbumNota,
  },
  {
    href: "https://assets.churchofjesuschrist.org/6i/q4/6iq40dsqxiqp9unrlkcjmbl792tqcivw3xqjdh47/2026_youth_theme_poster_usletter.pdf",
    label: HOME.linkPoster,
    note: HOME.linkPosterNota,
  },
] as const;

function coverUrl(event: Event) {
  return event.coverImageUrl?.trim() || event.heroImageUrl?.trim() || "";
}

export function HomePage() {
  const { session } = useAuth();
  const { stakeId, stakeName, selectStake, stakes } = usePublicStake();
  const { events, error, loading } = usePublishedActivities(stakeId);
  const railRef = useRef<HTMLUListElement | null>(null);
  const upcoming = events
    .filter((event) => !hasEventEnded(event))
    .sort((left, right) => new Date(left.startDate).getTime() - new Date(right.startDate).getTime());
  const scope = stakeId ? stakeName || CATALOGO.caricamento : HOME.inTuttaItalia;
  const activitiesPath = getActivitiesPath(stakeId || undefined);

  useEffect(() => {
    // Inserire la prima attività non deve far scorrere la riga e nasconderla.
    if (!loading) {
      railRef.current?.scrollTo({ left: 0 });
    }
  }, [loading, upcoming.length]);

  if (session?.isAuthenticated && !session.isAnonymous) {
    return (
      <Navigate
        replace
        to={
          session.profile.mustChangePassword
            ? "/password-reset"
            : session.isAdmin
              ? "/admin"
              : "/me"
        }
      />
    );
  }

  function scrollRail(direction: number) {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    railRef.current?.scrollBy({
      left: direction * 320,
      behavior: reduce ? "auto" : "smooth",
    });
  }

  return (
    <main>
      <section className="hero">
        <div className="hero-art">
          <div className="logo" role="img" aria-label={HOME.logoAlt} />
        </div>
        <div className="hero-text">
          <p className="kicker">{HOME.kicker}</p>
          <h1>{HOME.titolo}</h1>
          <p className="lead">{HOME.lead}</p>
          <div className="actions">
            <Link className="btn btn-accent" to={activitiesPath}>
              {HOME.scopri}
            </Link>
            <Link className="btn btn-line-light" to="/login">
              {HOME.accedi}
            </Link>
          </div>
        </div>
      </section>

      <section className="section" id="attivita">
        <div className="wrap head">
          <h2>
            {HOME.prossime}
            <small>{scope}</small>
          </h2>
          <div className="head-tools">
            <div className="rail-btns">
              <button aria-label={HOME.railIndietro} data-rail="-1" type="button" onClick={() => scrollRail(-1)} />
              <button aria-label={HOME.railAvanti} data-rail="1" type="button" onClick={() => scrollRail(1)} />
            </div>
            <Link to={activitiesPath}>{HOME.vediTutte}</Link>
          </div>
        </div>

        {error ? (
          <p className="pub-alert" role="alert">
            {error}
          </p>
        ) : null}

        {loading ? (
          <p className="rail-status" role="status">
            {CATALOGO.caricamento}
          </p>
        ) : null}

        <ul className="rail" ref={railRef}>
          {loading
            ? null
            : upcoming.map((event) => {
                const when = formatHomeWhen(event);
                const image = coverUrl(event);
                const name = stakes.find((stake) => stake.id === event.stakeId)?.name;

                return (
                  <li className="reveal" key={`${event.stakeId}:${event.id}`}>
                    <Link className="card feature" to={getActivityPath(event.id, event.stakeId)}>
                      <div className="media">
                        <span className="date-tag">
                          <b>{monthDay(event.startDate)}</b>
                          <small>{shortMonth(event.startDate)}</small>
                        </span>
                        {image ? <img alt="" src={image} /> : <ActivityScene className="media-scene" />}
                      </div>
                      {name ? <span className="palo-label">{name}</span> : null}
                      <h3>{event.title}</h3>
                      <p className="when">
                        <b>{when.date}</b>
                        {when.suffix}
                      </p>
                    </Link>
                  </li>
                );
              })}
          {!loading && upcoming.length === 0 ? (
            <li className="reveal">
              <div className="card none">
                <div className="media">
                  <strong>
                    {stakeId
                      ? fillCopy(HOME.vuotoPalo, { palo: stakeName || HOME.tuttaItalia })
                      : CATALOGO.vuotoInProgramma}
                  </strong>
                  <p>{CATALOGO.vuotoPaloTesto}</p>
                  {stakeId ? (
                    <button type="button" onClick={() => selectStake("")}>
                      {HOME.guardaTuttaItalia}
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          ) : null}
          {SOON.map((tone, index) => (
            <li className="reveal" key={`${tone}-${index}`}>
              <div className={`card soon ${tone}`}>
                <div className="media">
                  <img alt="" src={SYMBOL} />
                  <span>{HOME.inArrivo}</span>
                </div>
                <h3>{HOME.prossima}</h3>
                <p className="when">{HOME.prossimaQuando}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="how" id="come-funziona">
        <div className="wrap">
          <h2>{HOME.comeFunziona}</h2>
          <ol>
            <li>
              <b>1</b>
              <span>
                <strong>{HOME.passo1}</strong> {HOME.passo1Dove}
              </span>
            </li>
            <li>
              <b>2</b>
              <span>
                <strong>{HOME.passo2}</strong>, {HOME.passo2Come}
              </span>
            </li>
            <li>
              <b>3</b>
              <span>
                <strong>{HOME.passo3}</strong> {HOME.passo3Cosa}
              </span>
            </li>
          </ol>
        </div>
      </section>

      <section className="theme reveal" id="tema">
        <div className="theme-mark">
          <img alt="" src={SYMBOL} />
        </div>
        <div className="theme-body">
          <p className="kicker">{HOME.temaKicker}</p>
          <h2>{HOME.temaTitolo}</h2>
          <blockquote>
            {HOME.versetto}
            <cite>{HOME.versettoCitazione}</cite>
          </blockquote>
          <ul className="links">
            {THEME_LINKS.map((link) => (
              <li key={link.href}>
                <a href={link.href} rel="noopener noreferrer" target="_blank">
                  {link.label}
                  <small>{link.note}</small>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
