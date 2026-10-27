import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AppModal } from "@/components/AppModal";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { ProgramAgendaMark } from "@/components/activities/ProgramAgendaMark";
import { MOMENTI } from "@/copy/momenti";
import { momentsService } from "@/services/firestore/momentsService";
import type {
  ActivityMoment,
  ActivityMomentType,
  MomentAdminAction,
  MomentAdminRequest,
  MomentFields,
  MomentRosterRow,
} from "@/types/moments";
import { getAdminActionError } from "@/utils/adminErrors";
import {
  formatDateTime,
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
} from "@/utils/formatters";
import "@/styles/activity-program.css";

type EditorForm = {
  type: ActivityMomentType;
  title: string;
  startsAt: string;
  endsAt: string;
  place: string;
  description: string;
  capacity: string;
  customWindow: boolean;
  opensAt: string;
  closesAt: string;
};
type Editor = {
  momentId: string;
  revision: number | null;
  original: EditorForm;
  form: EditorForm;
};
type Confirmation =
  | { kind: "discard" | "reload" }
  | {
      kind: "action";
      action: "hide" | "delete" | "draft";
      moment: ActivityMoment;
    };
function editForm(
  moment: ActivityMoment | null,
  startDate: string,
): EditorForm {
  return {
    type: moment?.type || "info",
    title: moment?.title || "",
    startsAt: toDatetimeLocalValue(moment?.startsAt || startDate),
    endsAt:
      moment && moment.endsAt !== moment.startsAt
        ? toDatetimeLocalValue(moment.endsAt)
        : "",
    place: moment?.place || "",
    description: moment?.description || "",
    capacity: moment?.capacity ? String(moment.capacity) : "",
    customWindow: moment?.participation?.customWindow === true,
    opensAt: moment?.participation
      ? toDatetimeLocalValue(moment.participation.opensAt)
      : "",
    closesAt: moment?.participation
      ? toDatetimeLocalValue(moment.participation.closesAt)
      : "",
  };
}
function fieldsOf(form: EditorForm): MomentFields {
  return {
    type: form.type,
    title: form.title,
    startsAt: fromDatetimeLocalValue(form.startsAt),
    endsAt: fromDatetimeLocalValue(form.endsAt),
    place: form.place,
    description: form.description,
    ...(form.type === "turni"
      ? {
          capacity: Number(form.capacity),
          customWindow: form.customWindow,
          ...(form.customWindow
            ? {
                opensAt: fromDatetimeLocalValue(form.opensAt),
                closesAt: fromDatetimeLocalValue(form.closesAt),
              }
            : {}),
        }
      : {}),
  };
}
export function MomentsAdminTab({
  stakeId,
  activityId,
  startDate,
  activityDraft,
  onDirtyChange,
  onPendingChange,
}: {
  stakeId: string;
  activityId: string;
  startDate: string;
  activityDraft: boolean;
  onDirtyChange: (value: boolean) => void;
  onPendingChange: (value: boolean) => void;
}) {
  const [moments, setMoments] = useState<ActivityMoment[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null),
    [preview, setPreview] = useState<ActivityMoment | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null),
    [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const [roster, setRoster] = useState<{
    moment: ActivityMoment;
    rows: MomentRosterRow[] | null;
    error: string | null;
  } | null>(null);
  const mounted = useRef(true),
    sequence = useRef(0),
    rosterSequence = useRef(0);
  const running = useRef(false),
    retry = useRef<MomentAdminRequest | null>(null);
  const formId = useId();
  const editorOpen = Boolean(editor);
  useEffect(() => {
    if (!editorOpen) return;
    const form = document.getElementById(formId);
    let frame = 0;
    const keepFieldVisible = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const field = document.activeElement;
        if (
          (field instanceof HTMLInputElement ||
            field instanceof HTMLTextAreaElement ||
            field instanceof HTMLSelectElement) &&
          form?.contains(field)
        )
          field.scrollIntoView({ block: "center" });
      });
    };
    form?.addEventListener("focusin", keepFieldVisible);
    window.visualViewport?.addEventListener("resize", keepFieldVisible);
    return () => {
      cancelAnimationFrame(frame);
      form?.removeEventListener("focusin", keepFieldVisible);
      window.visualViewport?.removeEventListener("resize", keepFieldVisible);
    };
  }, [editorOpen, formId]);
  const dirty = useMemo(
    () =>
      Boolean(
        editor &&
          JSON.stringify(editor.form) !== JSON.stringify(editor.original),
      ),
    [editor],
  );
  useEffect(() => {
    onDirtyChange(dirty || uncertain);
    return () => onDirtyChange(false);
  }, [dirty, uncertain, onDirtyChange]);
  useEffect(() => {
    if (!dirty && !uncertain) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, uncertain]);
  useEffect(() => {
    onPendingChange(busy || uncertain);
    return () => onPendingChange(false);
  }, [busy, uncertain, onPendingChange]);
  async function load() {
    const request = ++sequence.current;
    const result = await momentsService.adminContext(stakeId, activityId);
    if (mounted.current && request === sequence.current) {
      setMoments(result);
      setLoading(false);
    }
    return result;
  }
  useEffect(() => {
    mounted.current = true;
    void load().catch((loadError) => {
      if (mounted.current) {
        setLoading(false);
        setError(getAdminActionError(loadError, MOMENTI.erroreCarica));
      }
    });
    return () => {
      mounted.current = false;
      sequence.current++;
      rosterSequence.current++;
    };
  }, [stakeId, activityId]);
  useEffect(() => {
    if (editor) return;
    let lastRefresh = 0;
    const refreshOnFocus = () => {
      if (
        document.visibilityState !== "visible" ||
        running.current ||
        Date.now() - lastRefresh < 5000
      )
        return;
      lastRefresh = Date.now();
      void load().catch((loadError) => {
        if (mounted.current)
          setError(getAdminActionError(loadError, MOMENTI.erroreCarica));
      });
    };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, [editor, stakeId, activityId]);
  function openEditor(moment: ActivityMoment | null) {
    const form = editForm(moment, startDate);
    setEditor({
      momentId: moment?.id || crypto.randomUUID(),
      revision: moment?.revision ?? null,
      original: form,
      form,
    });
    setError(null);
    setConflict(false);
    setUncertain(false);
    retry.current = null;
  }
  function closeEditor() {
    if (busy) return;
    if (dirty || uncertain) setConfirmation({ kind: "discard" });
    else setEditor(null);
  }
  function update<K extends keyof EditorForm>(field: K, value: EditorForm[K]) {
    setEditor((previous) =>
      previous
        ? { ...previous, form: { ...previous.form, [field]: value } }
        : previous,
    );
  }
  async function mutate(
    action: MomentAdminAction,
    moment: ActivityMoment | null,
    fields?: MomentFields,
  ) {
    if (running.current) return;
    const momentId = moment?.id || editor?.momentId;
    if (!momentId) return;
    const expectedRevision =
      action === "save"
        ? (editor?.revision ?? null)
        : (moment?.revision ?? null);
    const existingRetry = retry.current;
    const payload: MomentAdminRequest =
      existingRetry &&
      existingRetry.action === action &&
      existingRetry.momentId === momentId
        ? existingRetry
        : {
            action,
            momentId,
            expectedRevision,
            requestId: crypto.randomUUID(),
            ...(fields ? { fields } : {}),
          };
    retry.current = payload;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await momentsService.adminMutate(stakeId, activityId, payload);
      if (!mounted.current) return;
      retry.current = null;
      setEditor(null);
      setPreview(null);
      setConfirmation(null);
      setConflict(false);
      setUncertain(false);
      try {
        await load();
      } catch {
        // The mutation has already succeeded. A failed read cannot undo it.
        if (mounted.current) setError(MOMENTI.salvatoDaRicaricare);
      }
    } catch (actionError) {
      if (!mounted.current) return;
      const code = String((actionError as { code?: string }).code || "");
      const timedOut = /deadline-exceeded|unavailable|internal|unknown/.test(
        code,
      );
      if (code.includes("aborted")) {
        setConflict(true);
        setError(editor ? MOMENTI.conflitto : MOMENTI.conflittoStato);
        retry.current = null;
      } else {
        setUncertain(timedOut);
        setError(
          timedOut
            ? MOMENTI.inCorso
            : getAdminActionError(actionError, MOMENTI.erroreAzione),
        );
        if (!timedOut) retry.current = null;
      }
      await load().catch(() => {});
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function reloadEditor() {
    if (running.current) return;
    setBusy(true);
    setError(null);
    const id = editor?.momentId || preview?.id;
    try {
      const fresh = await load();
      if (!mounted.current) return;
      const found = fresh.find((moment) => moment.id === id);
      setConfirmation(null);
      setConflict(false);
      setUncertain(false);
      retry.current = null;
      if (editor) {
        if (found) openEditor(found);
        else setEditor(null);
      } else {
        setPreview(found?.status === "draft" ? found : null);
      }
    } catch (loadError) {
      if (mounted.current)
        setError(getAdminActionError(loadError, MOMENTI.erroreCarica));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function openRoster(moment: ActivityMoment) {
    const request = ++rosterSequence.current;
    setRoster({ moment, rows: null, error: null });
    try {
      const rows = await momentsService.roster(stakeId, activityId, moment.id);
      if (mounted.current && request === rosterSequence.current)
        setRoster({ moment, rows, error: null });
    } catch (loadError) {
      if (mounted.current && request === rosterSequence.current)
        setRoster({
          moment,
          rows: [],
          error: getAdminActionError(loadError, MOMENTI.erroreCarica),
        });
    }
  }
  let previousDay = "";
  const currentEditorMoment = editor
    ? moments.find((moment) => moment.id === editor.momentId) || null
    : null;
  const form = editor?.form;
  return (
    <section className="moments-panel">
      <div className="moments-header">
        <h2>{MOMENTI.programma}</h2>
        <ProgramAgendaMark />
      </div>
      <p className="moments-hint">{MOMENTI.introduzione}</p>
      {activityDraft ? (
        <p className="moments-notice">{MOMENTI.attivitaBozza}</p>
      ) : null}
      {error && !editor && !preview && !confirmation ? (
        <p className="notice notice--warning" role="alert">
          {error}
        </p>
      ) : null}
      <div className="inline-actions">
        <button
          className="button button--primary"
          disabled={busy || loading || uncertain}
          onClick={() => openEditor(null)}
        >
          {MOMENTI.nuovo}
        </button>
        <button
          className="button button--ghost"
          disabled={busy}
          onClick={() => void reloadEditor()}
        >
          {MOMENTI.ricarica}
        </button>
      </div>
      {!loading && moments.length === 0 ? (
        <div className="surface-panel">
          <h3>{MOMENTI.vuoto}</h3>
          <p className="moments-hint">{MOMENTI.nuovoAiuto}</p>
        </div>
      ) : null}
      {moments.map((moment) => {
        const day = new Intl.DateTimeFormat("it-IT", {
          weekday: "long",
          day: "numeric",
          month: "long",
        }).format(new Date(moment.startsAt));
        const showDay = day !== previousDay;
        previousDay = day;
        const clock = new Intl.DateTimeFormat("it-IT", {
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(moment.startsAt));
        return (
          <div key={moment.id} className="moments-day">
            {showDay ? <h3>{day}</h3> : null}
            <article className="moment-card">
              <div className="moment-card__title">
                <span className="moment-card__time">{clock}</span>
                <div className="moment-card__body">
                  <span
                    className={`moment-pill${moment.status === "draft" ? " moment-pill--draft" : ""}`}
                  >
                    {moment.status === "draft"
                      ? MOMENTI.bozza
                      : moment.status === "published"
                        ? MOMENTI.pubblicato
                        : MOMENTI.nascosto}
                  </span>
                  <h4>{moment.title}</h4>
                  <p className="moments-hint">
                    {moment.place ? `${moment.place} · ` : ""}
                    {moment.type === "info"
                      ? MOMENTI.info
                      : `${moment.taken}/${moment.capacity} posti occupati`}
                  </p>
                </div>
              </div>
              <div className="moment-card__actions">
                <button
                  className="button button--secondary button--small"
                  disabled={busy || uncertain}
                  onClick={() => openEditor(moment)}
                >
                  {MOMENTI.modifica}
                </button>
                {moment.status === "draft" ? (
                  <button
                    className="button button--primary button--small"
                    disabled={busy || uncertain}
                    onClick={() => {
                      setPreview(moment);
                      setError(null);
                    }}
                  >
                    {MOMENTI.anteprima}
                  </button>
                ) : moment.status === "hidden" ? (
                  <button
                    className="button button--primary button--small"
                    disabled={busy || uncertain}
                    onClick={() => void mutate("show", moment)}
                  >
                    {MOMENTI.mostra}
                  </button>
                ) : (
                  <button
                    className="button button--ghost button--small"
                    disabled={busy || uncertain}
                    onClick={() => {
                      setConfirmation({
                        kind: "action",
                        action: "hide",
                        moment,
                      });
                      setError(null);
                    }}
                  >
                    {MOMENTI.nascondi}
                  </button>
                )}
                {moment.type === "turni" ? (
                  <button
                    className="button button--ghost button--small"
                    disabled={busy || uncertain}
                    onClick={() => void openRoster(moment)}
                  >
                    {MOMENTI.iscritti} ({moment.taken})
                  </button>
                ) : null}
                {!moment.hasEntries && moment.status === "draft" ? (
                  <button
                    className="button button--ghost button--small"
                    disabled={busy || uncertain}
                    onClick={() => {
                      setConfirmation({
                        kind: "action",
                        action: "delete",
                        moment,
                      });
                      setError(null);
                    }}
                  >
                    {MOMENTI.eliminaBozza}
                  </button>
                ) : null}
                {!moment.hasEntries && moment.status === "published" ? (
                  <button
                    className="button button--ghost button--small"
                    disabled={busy || uncertain}
                    onClick={() => {
                      setConfirmation({
                        kind: "action",
                        action: "draft",
                        moment,
                      });
                      setError(null);
                    }}
                  >
                    {MOMENTI.tornaBozza}
                  </button>
                ) : null}
              </div>
            </article>
          </div>
        );
      })}
      {editor && form ? (
        <AppModal
          title={
            editor.revision === null ? MOMENTI.titoloNuovo : MOMENTI.modifica
          }
          subtitle={MOMENTI.nuovoAiuto}
          onClose={closeEditor}
          footer={
            <>
              <button
                className="button button--ghost"
                disabled={busy}
                onClick={closeEditor}
              >
                {MOMENTI.annulla}
              </button>
              <button
                className="button button--primary"
                form={formId}
                type="submit"
                disabled={
                  busy ||
                  conflict ||
                  (editor.revision !== null && !dirty && !uncertain)
                }
              >
                {busy
                  ? MOMENTI.salvataggio
                  : editor.revision === null
                    ? MOMENTI.salvaBozza
                    : MOMENTI.salvaModifiche}
              </button>
            </>
          }
        >
          <form
            id={formId}
            onSubmit={(event) => {
              event.preventDefault();
              if (conflict) return;
              try {
                void mutate("save", currentEditorMoment, fieldsOf(form));
              } catch (formError) {
                setError(
                  formError instanceof RangeError
                    ? MOMENTI.erroreDate
                    : getAdminActionError(formError, MOMENTI.erroreSalva),
                );
              }
            }}
          >
            {error ? (
              <div className="notice notice--warning" role="alert">
                <p>{error}</p>
                {conflict || uncertain ? (
                  <button
                    type="button"
                    className="button button--secondary"
                    disabled={busy}
                    onClick={() => setConfirmation({ kind: "reload" })}
                  >
                    {MOMENTI.ricarica}
                  </button>
                ) : null}
              </div>
            ) : null}
            <fieldset className="moments-editor" disabled={busy || uncertain}>
              <div>
                <h3>{MOMENTI.tipoDomanda}</h3>
                <div className="moments-options">
                  {(["info", "turni"] as const).map((type) => (
                    <button
                      className="moments-choice"
                      key={type}
                      type="button"
                      aria-pressed={form.type === type}
                      disabled={editor.revision !== null}
                      onClick={() => update("type", type)}
                    >
                      <strong>
                        {type === "info" ? MOMENTI.info : MOMENTI.turni}
                      </strong>
                      <span>
                        {type === "info"
                          ? MOMENTI.infoAiuto
                          : MOMENTI.turniAiuto}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="moments-hint">{MOMENTI.tipoFisso}</p>
              </div>
              <label className="field">
                <span className="field__label">{MOMENTI.titolo}</span>
                <input
                  className="input"
                  value={form.title}
                  maxLength={80}
                  required
                  onChange={(event) => update("title", event.target.value)}
                />
              </label>
              <label className="field">
                <span className="field__label">{MOMENTI.inizio}</span>
                <input
                  className="input"
                  type="datetime-local"
                  value={form.startsAt}
                  required
                  onChange={(event) => update("startsAt", event.target.value)}
                />
              </label>
              {form.type === "turni" ? (
                <label className="field">
                  <span className="field__label">{MOMENTI.posti}</span>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={2000}
                    step={1}
                    value={form.capacity}
                    required
                    onChange={(event) => update("capacity", event.target.value)}
                  />
                  <span className="moments-hint">
                    {MOMENTI.finestraDefault}
                  </span>
                </label>
              ) : null}
              <details>
                <summary>{MOMENTI.dettagli}</summary>
                <div className="moments-options">
                  <label className="field">
                    <span className="field__label">{MOMENTI.luogo}</span>
                    <input
                      className="input"
                      value={form.place}
                      maxLength={80}
                      onChange={(event) => update("place", event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">{MOMENTI.descrizione}</span>
                    <textarea
                      className="input"
                      value={form.description}
                      maxLength={600}
                      onChange={(event) =>
                        update("description", event.target.value)
                      }
                    />
                  </label>
                  <label className="field">
                    <span className="field__label">{MOMENTI.fine}</span>
                    <input
                      className="input"
                      type="datetime-local"
                      value={form.endsAt}
                      onChange={(event) => update("endsAt", event.target.value)}
                    />
                  </label>
                  {form.type === "turni" ? (
                    <>
                      <label className="moments-checkbox">
                        <input
                          type="checkbox"
                          checked={form.customWindow}
                          onChange={(event) =>
                            setEditor((previous) =>
                              previous
                                ? {
                                    ...previous,
                                    form: {
                                      ...previous.form,
                                      customWindow: event.target.checked,
                                      opensAt:
                                        previous.form.opensAt ||
                                        toDatetimeLocalValue(
                                          new Date().toISOString(),
                                        ),
                                      closesAt:
                                        previous.form.closesAt ||
                                        previous.form.startsAt,
                                    },
                                  }
                                : previous,
                            )
                          }
                        />
                        {MOMENTI.finestra}
                      </label>
                      {form.customWindow ? (
                        <>
                          <label className="field">
                            <span className="field__label">
                              {MOMENTI.apertura}
                            </span>
                            <input
                              className="input"
                              type="datetime-local"
                              value={form.opensAt}
                              required
                              onChange={(event) =>
                                update("opensAt", event.target.value)
                              }
                            />
                          </label>
                          <label className="field">
                            <span className="field__label">
                              {MOMENTI.chiusura}
                            </span>
                            <input
                              className="input"
                              type="datetime-local"
                              value={form.closesAt}
                              required
                              onChange={(event) =>
                                update("closesAt", event.target.value)
                              }
                            />
                          </label>
                        </>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </details>
              {editor.revision === null ||
              currentEditorMoment?.status === "draft" ? (
                <p className="moments-notice">{MOMENTI.bozzaAiuto}</p>
              ) : null}
            </fieldset>
          </form>
        </AppModal>
      ) : null}
      {preview ? (
        <AppModal
          title={MOMENTI.anteprimaTitolo}
          subtitle={MOMENTI.anteprimaAiuto}
          onClose={() => {
            if (!busy) setPreview(null);
          }}
          footer={
            <>
              <button
                className="button button--ghost"
                disabled={busy || uncertain}
                onClick={() => {
                  const item = preview;
                  setPreview(null);
                  openEditor(item);
                }}
              >
                {MOMENTI.modifica}
              </button>
              <button
                className="button button--primary"
                disabled={busy || conflict}
                onClick={() => void mutate("publish", preview)}
              >
                {busy ? MOMENTI.salvataggio : MOMENTI.pubblica}
              </button>
            </>
          }
        >
          {error ? (
            <div className="notice notice--warning" role="alert">
              <p>{error}</p>
              {conflict || uncertain ? (
                <button
                  className="button button--secondary"
                  disabled={busy}
                  onClick={() => void reloadEditor()}
                >
                  {MOMENTI.ricarica}
                </button>
              ) : null}
            </div>
          ) : null}
          <article
            className={`moment-card${preview.type === "turni" ? " moment-card--signup" : ""}`}
          >
            <p className="moments-hint">{formatDateTime(preview.startsAt)}</p>
            <h3>{preview.title}</h3>
            {preview.place ? (
              <p className="moments-hint">{preview.place}</p>
            ) : null}
            {preview.description ? <p>{preview.description}</p> : null}
            {preview.type === "turni" ? (
              <>
                <p>
                  <strong>{preview.capacity} posti disponibili</strong>
                </p>
                <button className="button button--primary" disabled>
                  {MOMENTI.iscriviti}
                </button>
              </>
            ) : null}
          </article>
          <p className="moments-hint">{MOMENTI.nomiPrivati}</p>
        </AppModal>
      ) : null}
      {roster ? (
        <AppModal
          title={`${MOMENTI.iscritti} · ${roster.moment.title}`}
          onClose={() => {
            rosterSequence.current++;
            setRoster(null);
          }}
          footer={
            <button
              className="button button--secondary"
              onClick={() => {
                rosterSequence.current++;
                setRoster(null);
              }}
            >
              {MOMENTI.chiudi}
            </button>
          }
        >
          {roster.error ? (
            <p role="alert" className="notice notice--warning">
              {roster.error}
            </p>
          ) : roster.rows ? (
            roster.rows.length ? (
              <ul className="moments-roster">
                {roster.rows.map((row) => (
                  <li key={row.registrationId}>{row.displayName}</li>
                ))}
              </ul>
            ) : (
              <p>{MOMENTI.nessunIscritto}</p>
            )
          ) : (
            <p role="status">Caricamento...</p>
          )}
        </AppModal>
      ) : null}
      {confirmation ? (
        <ConfirmSheet
          title={
            confirmation.kind === "action"
              ? confirmation.action === "hide"
                ? MOMENTI.nascondiTitolo
                : confirmation.action === "draft"
                  ? MOMENTI.tornaBozza
                  : MOMENTI.eliminaTitolo
              : MOMENTI.scartaTitolo
          }
          body={
            confirmation.kind === "action"
              ? confirmation.action === "hide"
                ? MOMENTI.nascondiCorpo
                : confirmation.action === "draft"
                  ? MOMENTI.bozzaAiuto
                  : MOMENTI.eliminaCorpo
              : uncertain
                ? MOMENTI.uscitaInCorso
                : MOMENTI.scartaCorpo
          }
          cancelLabel={
            confirmation.kind === "action" ? MOMENTI.tieni : MOMENTI.continua
          }
          confirmLabel={
            confirmation.kind === "action"
              ? confirmation.action === "hide"
                ? MOMENTI.nascondi
                : confirmation.action === "draft"
                  ? MOMENTI.tornaBozza
                  : MOMENTI.elimina
              : confirmation.kind === "reload"
                ? MOMENTI.ricarica
                : uncertain
                  ? MOMENTI.esci
                  : MOMENTI.scarta
          }
          error={error}
          busy={busy}
          onCancel={() => {
            if (!busy) setConfirmation(null);
          }}
          onConfirm={() => {
            if (confirmation.kind === "action")
              void mutate(confirmation.action, confirmation.moment);
            else if (confirmation.kind === "reload") void reloadEditor();
            else {
              setEditor(null);
              setConfirmation(null);
              setConflict(false);
              setUncertain(false);
              setError(null);
              retry.current = null;
            }
          }}
        />
      ) : null}
    </section>
  );
}
