import { useId } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { ActivityScene } from "@/components/activities/ActivityScene";
import { usePublicStake } from "@/components/publicSite/PublicStakeProvider";
import { ANNUNCIATA } from "@/copy/annunciata";
import { CATALOGO } from "@/copy/catalogo";
import { HOME } from "@/copy/home";
import { usePublishedActivities } from "@/hooks/usePublishedActivities";
import { fillCopy } from "@/copy/parole";
import type { Event } from "@/types";
import { getActivityPath } from "@/utils/activityLinks";
import {
  formatListWhen,
  isPublicActivityType,
  monthDay,
  monthKey,
  monthLabel,
  publicActivityTypeLabel,
  publicActivityTypeOf,
  shortMonth,
} from "@/utils/publicCatalog";
import { getPublicEventState, hasEventEnded } from "@/utils/publicEventState";

function coverUrl(event: Event) {
  return event.coverImageUrl?.trim() || event.heroImageUrl?.trim() || "";
}

function statusClass(phase: ReturnType<typeof getPublicEventState>["phase"]) {
  if (phase === "open") {
    return "open";
  }

  // Annunciata: «Iscrizioni a breve», stesso segno di «Iscrizioni dal…».
  if (phase === "upcoming" || phase === "announced") {
    return "soon";
  }

  return "closed";
}

export function ActivitiesPage() {
  const filterIds = useId();
  const [searchParams, setSearchParams] = useSearchParams();
  const { stakes, stakeId, stakeName, selectStake } = usePublicStake();
  const { events, error, loading } = usePublishedActivities(stakeId);
  const time = searchParams.get("time") === "past" ? "past" : "upcoming";
  const month = searchParams.get("month") ?? "";
  const type = searchParams.get("type") ?? "";
  const typeFilter = isPublicActivityType(type) ? type : "";
  const paloId = `${filterIds}-palo`;
  const meseId = `${filterIds}-mese`;
  const tipoId = `${filterIds}-tipo`;

  const months = [...new Set(events.map((event) => monthKey(event.startDate)).filter(Boolean))].sort();
  const rows = events
    .filter((event) => (time === "past" ? hasEventEnded(event) : !hasEventEnded(event)))
    .filter((event) => !month || monthKey(event.startDate) === month)
    .filter((event) => !typeFilter || publicActivityTypeOf(event) === typeFilter)
    .sort((left, right) => {
      const delta = new Date(left.startDate).getTime() - new Date(right.startDate).getTime();
      return time === "past" ? -delta : delta;
    });

  function setParam(key: "time" | "month" | "type", value: string) {
    const next = new URLSearchParams(searchParams);

    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }

    setSearchParams(next, { replace: true });
  }

  const scope = stakeId ? stakeName || CATALOGO.caricamento : HOME.tuttaItalia;

  return (
    <main>
      <section className="page-head">
        <div className="wrap">
          <h1>{CATALOGO.titolo}</h1>
          <p className="sub">{scope}</p>
          <div aria-label={CATALOGO.periodo} className="seg" role="tablist">
            <button
              aria-selected={time === "upcoming"}
              role="tab"
              type="button"
              onClick={() => setParam("time", "upcoming")}
            >
              {CATALOGO.inProgramma}
            </button>
            <button
              aria-selected={time === "past"}
              role="tab"
              type="button"
              onClick={() => setParam("time", "past")}
            >
              {CATALOGO.passate}
            </button>
          </div>
        </div>
      </section>

      <section className="filters">
        <div className="wrap">
          <div className="field">
            <span id={`${paloId}-label`}>{CATALOGO.palo}</span>
            <select
              aria-labelledby={`${paloId}-label`}
              className="select"
              id={paloId}
              value={stakeId}
              onChange={(event) => selectStake(event.target.value)}
            >
              <option value="">{HOME.tuttaItalia}</option>
              {stakeId && !stakes.some((stake) => stake.id === stakeId) ? (
                <option value={stakeId}>{CATALOGO.caricamento}</option>
              ) : null}
              {stakes.map((stake) => (
                <option key={stake.id} value={stake.id}>
                  {stake.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <span id={`${meseId}-label`}>{CATALOGO.mese}</span>
            <select
              aria-labelledby={`${meseId}-label`}
              className="select"
              id={meseId}
              value={months.includes(month) ? month : ""}
              onChange={(event) => setParam("month", event.target.value)}
            >
              <option value="">{CATALOGO.tuttiIMesi}</option>
              {months.map((key) => (
                <option key={key} value={key}>
                  {monthLabel(key)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <span id={`${tipoId}-label`}>{CATALOGO.tipo}</span>
            <select
              aria-labelledby={`${tipoId}-label`}
              className="select"
              id={tipoId}
              value={typeFilter}
              onChange={(event) => setParam("type", event.target.value)}
            >
              <option value="">{CATALOGO.tuttiITipi}</option>
              <option value="standard">{CATALOGO.tipi.standard}</option>
              <option value="overnight">{CATALOGO.tipi.overnight}</option>
              <option value="trip">{CATALOGO.tipi.trip}</option>
              <option value="camp">{CATALOGO.tipi.camp}</option>
              <option value="multi_day">{CATALOGO.tipi.multi_day}</option>
            </select>
          </div>
          <p aria-live="polite" className="count">
            {loading
              ? CATALOGO.caricamento
              : rows.length === 1
                ? CATALOGO.conteggioUna
                : fillCopy(CATALOGO.conteggio, { numero: String(rows.length) })}
          </p>
        </div>
      </section>

      <section className="wrap list-wrap">
        {error ? (
          <p className="pub-alert" role="alert">
            {error}
          </p>
        ) : null}
        <ol className="list">
          {loading
            ? null
            : rows.map((event) => {
                const state = getPublicEventState(event);
                const past = hasEventEnded(event) || state.phase === "ended" || state.phase === "cancelled";
                // Il modulo c'è solo con le iscrizioni aperte o con una data d'apertura.
                const canRegister = !past && (state.phase === "open" || state.phase === "upcoming");
                const image = coverUrl(event);
                const name = stakes.find((stake) => stake.id === event.stakeId)?.name;

                return (
                  <li key={`${event.stakeId}:${event.id}`}>
                    <Link className="row" to={getActivityPath(event.id, event.stakeId)}>
                      <span className="date">
                        <b>{monthDay(event.startDate)}</b>
                        <small>{shortMonth(event.startDate)}</small>
                      </span>
                      <span className="thumb">
                        {image ? <img alt="" src={image} /> : <ActivityScene className="media-scene" />}
                      </span>
                      <div>
                        {name ? <span className="palo-label">{name}</span> : null}
                        <h2>{event.title}</h2>
                        <p className="meta">
                          {formatListWhen(event, { missingPlace: ANNUNCIATA.luogoDaDefinire })}
                        </p>
                        <div className="tags">
                          <span className={`status ${statusClass(state.phase)}`}>{state.label}</span>
                          <span className="type">{publicActivityTypeLabel(publicActivityTypeOf(event))}</span>
                        </div>
                      </div>
                      <span className="go btn btn-ghost btn-small">
                        {canRegister ? CATALOGO.dettagliIscrizione : CATALOGO.dettagli}
                      </span>
                    </Link>
                  </li>
                );
              })}
        </ol>
        <div className="empty" hidden={loading || Boolean(error) || rows.length > 0}>
          <strong>{CATALOGO.vuotoFiltri}</strong>
          <p>{CATALOGO.vuotoPaloTesto}</p>
          <button
            className="btn btn-ghost btn-small"
            type="button"
            onClick={() => selectStake("", ["month", "type"])}
          >
            {CATALOGO.togliFiltri}
          </button>
        </div>
        <p className="legend">{CATALOGO.legenda}</p>
      </section>
    </main>
  );
}
