import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { useAuth } from "@/hooks/useAuth";
import { momentsService } from "@/services/firestore/momentsService";
import { fillCopy } from "@/copy/parole";
import { MOMENTI } from "@/copy/momenti";
import type {
  MomentParticipantRequest,
  MomentsContext,
  ParticipantMoment,
} from "@/types/moments";
import { getAdminActionError } from "@/utils/adminErrors";
import { formatDateTime } from "@/utils/formatters";
import { ProgramAgendaMark } from "./ProgramAgendaMark";
import "@/styles/activity-program.css";

const time = (value: string) =>
  new Intl.DateTimeFormat("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
const day = (value: string) =>
  new Intl.DateTimeFormat("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(value));

export function ActivityProgram({
  stakeId,
  activityId,
}: {
  stakeId: string;
  activityId: string;
}) {
  const { session } = useAuth();
  if (!session || session.isAnonymous) return null;
  const context = `${session.firebaseUser.uid}|${session.profile.role}|${stakeId}|${activityId}`;
  return (
    <ProgramContent key={context} stakeId={stakeId} activityId={activityId} />
  );
}
function ProgramContent({
  stakeId,
  activityId,
}: {
  stakeId: string;
  activityId: string;
}) {
  const [data, setData] = useState<MomentsContext | null>(null);
  const [personId, setPersonId] = useState("");
  const personLabelId = useId();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ParticipantMoment | null>(null);
  const [, tick] = useState(0);
  const mounted = useRef(true),
    generation = useRef(0),
    pending = useRef<Promise<void> | null>(null);
  const clock = useRef({ server: 0, monotonic: 0 });
  const retry = useRef<MomentParticipantRequest | null>(null);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const result = await momentsService.context(stakeId, activityId);
      if (!mounted.current || request !== generation.current) return;
      clock.current = {
        server: Date.parse(result.serverNow),
        monotonic: performance.now(),
      };
      setData(result);
      setPersonId((previous) =>
        result.people.some((person) => person.registrationId === previous)
          ? previous
          : result.people.length === 1
            ? result.people[0].registrationId
            : "",
      );
    } catch (loadError) {
      if (mounted.current && request === generation.current) {
        if (
          String((loadError as { code?: string }).code).includes(
            "permission-denied",
          )
        )
          setData(null);
        setError(getAdminActionError(loadError, MOMENTI.erroreCarica));
      }
      throw loadError;
    }
  }, [stakeId, activityId]);
  useEffect(() => {
    mounted.current = true;
    void refresh().catch((loadError) => {
      if (mounted.current)
        setError(getAdminActionError(loadError, MOMENTI.erroreCarica));
    });
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, [refresh]);
  useEffect(() => {
    let lastRefresh = 0;
    const focus = () => {
      if (
        document.visibilityState !== "visible" ||
        pending.current ||
        Date.now() - lastRefresh < 5000
      )
        return;
      lastRefresh = Date.now();
      void refresh().catch(() => {});
    };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    const timer = window.setInterval(() => tick((value) => value + 1), 15_000);
    return () => {
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
      window.clearInterval(timer);
    };
  }, [refresh]);
  function act(moment: ParticipantMoment, action: "join" | "withdraw") {
    if (pending.current || !personId) return;
    setBusy(true);
    setError(null);
    const previousRetry = retry.current;
    const payload: MomentParticipantRequest =
      previousRetry &&
      previousRetry.action === action &&
      previousRetry.momentId === moment.id &&
      previousRetry.registrationId === personId
        ? previousRetry
        : {
            action,
            momentId: moment.id,
            registrationId: personId,
            expectedRevision:
              moment.entries.find((entry) => entry.registrationId === personId)
                ?.revision ?? null,
            requestId: crypto.randomUUID(),
          };
    retry.current = payload;
    const request = (async () => {
      try {
        await momentsService.participate(stakeId, activityId, payload);
        retry.current = null;
        if (mounted.current) {
          setConfirm(null);
          try {
            await refresh();
          } catch {
            if (mounted.current) setError(MOMENTI.salvatoDaRicaricare);
          }
        }
      } catch (actionError) {
        if (!mounted.current) return;
        const code = String((actionError as { code?: string }).code || "");
        if (!/deadline-exceeded|unavailable|internal|unknown/.test(code))
          retry.current = null;
        setError(
          code.includes("deadline-exceeded")
            ? MOMENTI.inCorso
            : getAdminActionError(actionError, MOMENTI.erroreAzione),
        );
        // A callable timeout is not a rollback; the stable entry ID makes a
        // repeated desired action safe after this authoritative reread.
        await refresh().catch(() => {});
      } finally {
        if (mounted.current) setBusy(false);
      }
    })();
    pending.current = request;
    void request.finally(() => {
      if (pending.current === request) pending.current = null;
    });
  }
  if ((!data && !error) || (data?.moments.length === 0 && !error)) return null;
  const person = data?.people.find((item) => item.registrationId === personId);
  let previousDay = "";
  return (
    <section
      className="surface-panel moments-panel"
      aria-label={MOMENTI.ilProgramma}
    >
      <div className="moments-header">
        <h2>{MOMENTI.ilProgramma}</h2>
        <ProgramAgendaMark />
      </div>
      {error ? (
        <div className="notice notice--warning" role="alert">
          <p>{error}</p>
          <button
            className="button button--ghost"
            disabled={busy}
            onClick={() => {
              setError(null);
              void refresh().catch((loadError) => {
                if (mounted.current)
                  setError(
                    getAdminActionError(loadError, MOMENTI.erroreCarica),
                  );
              });
            }}
          >
            {MOMENTI.ricarica}
          </button>
        </div>
      ) : null}
      {data && data.people.length > 1 ? (
        <label className="field moments-person">
          <span className="field__label" id={personLabelId}>
            {MOMENTI.scegliPersona}
          </span>
          {/* The wrapping label would add the options to the accessible name. */}
          <select
            aria-labelledby={personLabelId}
            className="input"
            value={personId}
            disabled={busy}
            onChange={(event) => {
              setPersonId(event.target.value);
              setConfirm(null);
              setError(null);
            }}
          >
            <option value="" disabled>
              {MOMENTI.scegliPartecipante}
            </option>
            {data.people.map((item) => (
              <option key={item.registrationId} value={item.registrationId}>
                {item.displayName}
                {item.eligible ? "" : ` · ${MOMENTI.nonAttiva}`}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {data?.people.length === 1 ? (
        <p className="moments-notice">
          {MOMENTI.partecipante}: <strong>{person?.displayName}</strong>
        </p>
      ) : null}
      {data?.moments.map((moment) => {
        const entry = moment.entries.find(
          (item) => item.registrationId === personId,
        );
        if (moment.restricted && !entry) return null;
        const heading = day(moment.startsAt),
          showDay = heading !== previousDay;
        previousDay = heading;
        const now =
          clock.current.server + performance.now() - clock.current.monotonic;
        const open =
          !moment.restricted &&
          moment.status === "published" &&
          moment.participation &&
          now >= Date.parse(moment.participation.opensAt) &&
          now < Date.parse(moment.participation.closesAt);
        const full =
          moment.capacity !== null && moment.taken >= moment.capacity;
        const changed =
          entry &&
          !moment.restricted &&
          entry.startsAtSnapshot !== moment.startsAt;
        return (
          <div key={moment.id} className="moments-day">
            {showDay ? <h3>{heading}</h3> : null}
            <article
              className={`moment-card${moment.type === "turni" ? " moment-card--signup" : ""}`}
            >
              {entry?.status === "approved" ? (
                <span className="moment-pill moment-pill--joined">
                  {MOMENTI.iscritto}
                </span>
              ) : entry?.status === "withdrawn" ? (
                <span className="moment-pill">
                  {entry.withdrawnReason === "participant"
                    ? MOMENTI.ritirato
                    : person?.eligible
                      ? MOMENTI.ripristinoDaVerificare
                      : MOMENTI.iscrizioneInattiva}
                </span>
              ) : null}
              <div className="moment-card__title">
                <span className="moment-card__time">
                  {time(moment.startsAt)}
                </span>
                <div className="moment-card__body">
                  <h4>{moment.title}</h4>
                  {moment.place ? (
                    <p className="moments-hint">{moment.place}</p>
                  ) : null}
                </div>
              </div>
              {changed ? (
                <p className="moments-hint">{MOMENTI.aggiornato}</p>
              ) : null}
              {moment.description ? <p>{moment.description}</p> : null}
              {moment.restricted ? (
                <p className="moments-hint">{MOMENTI.nonDisponibile}</p>
              ) : null}
              {moment.type === "turni" && !moment.restricted ? (
                <div className="moment-card__count">
                  <strong>
                    {full
                      ? MOMENTI.postiEsauriti
                      : (moment.capacity || 0) - moment.taken === 1
                        ? MOMENTI.unPosto
                        : fillCopy(MOMENTI.postiRimanenti, {
                            posti: String(
                              Math.max(
                                0,
                                (moment.capacity || 0) - moment.taken,
                              ),
                            ),
                          })}
                  </strong>
                  {moment.participation ? (
                    <span className="moments-hint">
                      {now < Date.parse(moment.participation.opensAt)
                        ? fillCopy(MOMENTI.apreIl, {
                            data: formatDateTime(moment.participation.opensAt),
                          })
                        : fillCopy(MOMENTI.chiudeIl, {
                            data: formatDateTime(moment.participation.closesAt),
                          })}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {moment.type === "turni" ? (
                entry?.status === "approved" ? (
                  <button
                    className="button button--secondary"
                    disabled={busy}
                    onClick={() => {
                      setConfirm(moment);
                      setError(null);
                    }}
                  >
                    {MOMENTI.rinuncia}
                  </button>
                ) : !moment.restricted ? (
                  <>
                    <button
                      className="button button--primary"
                      disabled={busy || !person?.eligible || !open || full}
                      onClick={() => act(moment, "join")}
                    >
                      {busy
                        ? MOMENTI.salvataggio
                        : full
                          ? MOMENTI.postiEsauriti
                          : !open
                            ? moment.participation &&
                              now < Date.parse(moment.participation.opensAt)
                              ? MOMENTI.iscrizioniFuture
                              : MOMENTI.iscrizioniChiuse
                            : entry
                              ? MOMENTI.riprendi
                              : MOMENTI.iscriviti}
                    </button>
                    {!person?.eligible ? (
                      <p className="moments-hint">
                        {person
                          ? MOMENTI.iscrizioneInattiva
                          : data.people.length > 1
                            ? MOMENTI.scegliPersona
                            : MOMENTI.iscrizioneNecessaria}
                      </p>
                    ) : null}
                  </>
                ) : null
              ) : null}
            </article>
          </div>
        );
      })}
      {confirm ? (
        <ConfirmSheet
          title={MOMENTI.rinunciaTitolo}
          body={MOMENTI.rinunciaCorpo}
          cancelLabel={MOMENTI.tieniPosto}
          confirmLabel={MOMENTI.rinuncia}
          busy={busy}
          error={error}
          onCancel={() => {
            if (!busy) {
              setConfirm(null);
              setError(null);
            }
          }}
          onConfirm={() => act(confirm, "withdraw")}
        />
      ) : null}
    </section>
  );
}
