import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";

import { Button, EmptyState, Icon, Notice, Pill } from "@/components/ui";
import { UndoToast, type UndoToastState } from "@/components/membership/UndoToast";
import { PALO } from "@/copy/palo";
import { fillCopy } from "@/copy/parole";
import { useMemberQueue } from "@/hooks/useStakeMembership";
import { stakeMembersService, type StakeMembershipAction } from "@/services/firestore/stakeMembersService";
import {
  canUndoDecline,
  initialsOf,
  isMigratedAccount,
  membershipErrorMessage,
  onDateLabel,
  pendingQueue,
  recentDeclined,
  reviewQueue,
  waitingLabel,
  wasPassedByUnitLeader,
  wasUnknownToUnitLeader,
  type StakeMember,
  type StakeMemberPrevious,
} from "@/utils/stakeMembership";

import giovaniUrl from "@/assets/flusso-genitore/giovani.webp";

import "@/styles/membership.css";

type Tab = "richieste" | "da-confermare" | "rifiutate";
const TABS: Tab[] = ["richieste", "da-confermare", "rifiutate"];

interface StakePeoplePanelProps {
  stakeId: string;
  /** Unità del dirigente; null per l'admin, che vede tutto il palo. */
  unitId: string | null;
  isAdmin: boolean;
  viewerUid: string;
}

// Azione dello staff → testo del toast (con "Annulla").
const TOAST_BY_ACTION: Partial<Record<StakeMembershipAction, string>> = {
  approve: PALO.toastApprovato,
  decline: PALO.toastRifiutato,
  hasAccount: PALO.toastRifiutato,
  notMyUnit: PALO.toastPassata,
  confirmKnown: PALO.toastConfermato,
  markUnknown: PALO.toastInCoda,
};

interface StaffDetails {
  note: string | null;
  previous: StakeMemberPrevious | null;
}

function detailKey(member: StakeMember) {
  return `${member.stakeId}:${member.uid}:${member.version}`;
}

function avatarTone(uid: string) {
  let hash = 0;
  for (const char of uid) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 6;
}

function nameOf(member: StakeMember) {
  return member.displayName || PALO.senzaNome;
}

/**
 * Pagina "Persone" dello staff (docs/APPARTENENZA_AL_PALO.md, «Client della
 * fase 3»): richieste di accesso, membri da confermare, rifiutate. Ogni
 * azione ha il toast "Annulla" (callable `undo` con la `version` vista).
 */
export function StakePeoplePanel({ stakeId, unitId, isAdmin, viewerUid }: StakePeoplePanelProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("scheda") as Tab | null;
  const tab: Tab = requestedTab && TABS.includes(requestedTab) ? requestedTab : "richieste";
  const enabled = Boolean(stakeId) && (isAdmin || Boolean(unitId));
  const queue = useMemberQueue(stakeId, isAdmin ? null : unitId, enabled);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [menuUid, setMenuUid] = useState<string | null>(null);
  // Il menu si apre verso il basso; verso l'alto se lì finirebbe sotto la barra
  // in basso o fuori dallo schermo.
  const [menuUp, setMenuUp] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const ids = useId();
  const [toast, setToast] = useState<UndoToastState | null>(null);
  const [details, setDetails] = useState<Record<string, StaffDetails>>({});
  const [detailsError, setDetailsError] = useState(false);
  const [detailsRetry, setDetailsRetry] = useState(0);
  const toastId = useRef(0);
  // Un istante per apertura: etichette "da 3 giorni" e finestre di 30 giorni.
  const [nowMs] = useState(() => Date.now());

  // Al cambio palo l'ascolto si riallinea in un effetto: fino a quel momento
  // non mostrare né caricare dettagli delle righe rimaste dal palo precedente.
  const pendingRaw = useMemo(() => pendingQueue(queue.pending.filter((member) => member.stakeId === stakeId)), [queue.pending, stakeId]);
  const review = useMemo(() => reviewQueue(queue.review.filter((member) => member.stakeId === stakeId), nowMs, isAdmin), [queue.review, nowMs, isAdmin, stakeId]);
  const declinedRaw = useMemo(() => recentDeclined(queue.declined.filter((member) => member.stakeId === stakeId), nowMs), [queue.declined, nowMs, stakeId]);

  // Documenti dello staff di ogni richiesta e rifiutata: la nota "stesso nome e
  // data" e lo stato di prima (chi ha agito e come, per etichette e "Annulla
  // rifiuto"), mai leggibili dal richiedente. Due letture per persona; la chiave
  // comprende la versione, così una persona cambiata si rilegge.
  const detailMembers = useMemo(() => [...pendingRaw, ...declinedRaw], [pendingRaw, declinedRaw]);
  const detailKeys = detailMembers.map(detailKey).join(",");
  useEffect(() => {
    let active = true;
    setDetailsError(false);
    const missing = detailMembers.filter((member) => !(detailKey(member) in details));
    if (!missing.length) return undefined;
    void Promise.allSettled(
      missing.map(async (member) => {
        const [note, previous] = await Promise.all([
          member.status === "pending"
            ? stakeMembersService.getStaffNoteKind(stakeId, member.uid)
            : Promise.resolve(null),
          stakeMembersService.getStaffPrevious(stakeId, member.uid),
        ]);
        return [detailKey(member), { note, previous }] as const;
      }),
    ).then((results) => {
      if (!active) return;
      const entries = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      setDetails((current) => ({ ...current, ...Object.fromEntries(entries) }));
      // Un errore non è un documento assente: non entra in cache e il nuovo
      // tentativo rilegge soltanto i dettagli mancanti.
      setDetailsError(results.some((result) => result.status === "rejected"));
    });
    return () => {
      active = false;
    };
    // `details` resta fuori di proposito: la lettura parte solo quando cambia la coda.
  }, [detailKeys, stakeId, detailsRetry]);

  const withDetails = useCallback(
    (member: StakeMember): StakeMember => {
      const found = details[detailKey(member)];
      return found ? { ...member, previous: found.previous ?? member.previous } : member;
    },
    [details],
  );
  const pending = useMemo(() => pendingRaw.map(withDetails), [pendingRaw, withDetails]);
  const declined = useMemo(() => declinedRaw.map(withDetails), [declinedRaw, withDetails]);

  // Il menu "Altre azioni" si chiude toccando fuori o con Esc.
  useEffect(() => {
    if (!menuUid) return undefined;
    const close = (event: Event) => {
      const inside = event.composedPath().some(
        (node) => node instanceof HTMLElement && node.dataset.menuFor === menuUid,
      );
      if (!inside) setMenuUid(null);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Il focus torna al tondo che ha aperto il menu, non sul corpo della pagina.
      document.querySelector<HTMLElement>(`[data-menu-for="${CSS.escape(menuUid)}"] .mship-more`)?.focus();
      setMenuUid(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuUid]);

  // La lista è un contenitore (container query) e quindi un contesto di
  // impilamento: lo z-index del menu non lo porta sopra la barra in basso.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menuUid || !menu) return;
    const nav = document.querySelector(".bottom-nav")?.getBoundingClientRect();
    const limit = Math.min(window.innerHeight, nav && nav.height > 0 ? nav.top : window.innerHeight);
    if (menu.getBoundingClientRect().bottom > limit - 8) setMenuUp(true);
  }, [menuUid]);

  // La scheda scelta (anche da un link con ?scheda=) resta visibile quando le
  // schede scorrono.
  useEffect(() => {
    tabsRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);

  const showToast = useCallback((next: Omit<UndoToastState, "id">) => {
    toastId.current += 1;
    setToast({ ...next, id: toastId.current });
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);

  async function undo(member: StakeMember, version: number) {
    try {
      await stakeMembersService.run({ action: "undo", stakeId, uid: member.uid, version });
      showToast({ kind: "info", message: PALO.toastAnnullato });
    } catch (caught) {
      showToast({ kind: "error", message: membershipErrorMessage(caught) });
    }
  }

  async function act(member: StakeMember, action: StakeMembershipAction) {
    setMenuUid(null);
    setBusyUid(member.uid);
    try {
      const result = await stakeMembersService.run({ action, stakeId, uid: member.uid });
      // "Non lo conosco" del dirigente passa la richiesta agli admin (S2-3).
      const template = action === "markUnknown" && !isAdmin ? PALO.toastPassata : TOAST_BY_ACTION[action];
      if (template) {
        showToast({
          kind: "undo",
          message: fillCopy(template, { nome: nameOf(member) }),
          onUndo: result.changed ? () => undo(member, result.version) : undefined,
        });
      }
    } catch (caught) {
      showToast({ kind: "error", message: membershipErrorMessage(caught) });
    } finally {
      setBusyUid(null);
    }
  }

  async function undoDecline(member: StakeMember) {
    setBusyUid(member.uid);
    try {
      await stakeMembersService.run({ action: "undo", stakeId, uid: member.uid, version: member.version });
      showToast({ kind: "info", message: fillCopy(PALO.toastInCoda, { nome: nameOf(member) }) });
    } catch (caught) {
      showToast({ kind: "error", message: membershipErrorMessage(caught) });
    } finally {
      setBusyUid(null);
    }
  }

  function selectTab(next: Tab) {
    const params = new URLSearchParams(searchParams);
    if (next === "richieste") params.delete("scheda");
    else params.set("scheda", next);
    setSearchParams(params, { replace: true });
  }

  if (!isAdmin && !unitId) {
    return (
      <div className="mship-page">
        <Notice live="none" tone="info">
          <p>{PALO.senzaUnitaProfilo}</p>
        </Notice>
      </div>
    );
  }

  function head(member: StakeMember, meta: string) {
    return (
      <div className="mship-card__head">
        <span aria-hidden="true" className={`mship-avatar mship-avatar--${avatarTone(member.uid)}`}>
          {initialsOf(nameOf(member))}
        </span>
        <div className="mship-card__who">
          <span className="mship-card__name">{nameOf(member)}</span>
          <span className="mship-card__meta">{meta}</span>
        </div>
      </div>
    );
  }

  function metaOf(member: StakeMember, tail: string) {
    return [member.claimedUnitName || PALO.senzaUnita, member.birthYear ? String(member.birthYear) : "", tail]
      .filter(Boolean)
      .join(" · ");
  }

  function renderRequest(member: StakeMember) {
    const busy = busyUid === member.uid;
    const hints = member.registrationHints.map((hint) => hint.title).filter(Boolean);
    const note = details[detailKey(member)]?.note;
    const unknown = wasUnknownToUnitLeader(member);
    const passed = wasPassedByUnitLeader(member) || unknown;
    const withoutUnit = isAdmin && !member.claimedUnitId;
    return (
      <li className="mship-card" key={member.uid}>
        {head(member, metaOf(member, waitingLabel(member.requestedAtMs, nowMs)))}
        <div className="mship-card__ctx">
          <Pill icon="calendar">
            {hints.length ? fillCopy(PALO.iscrizioni, { attivita: hints.join(", ") }) : PALO.nessunaIscrizione}
          </Pill>
          {isMigratedAccount(member) ? <Pill tone="sand">{PALO.accountEsistente}</Pill> : null}
          {unknown ? <Pill tone="warning">{PALO.nonLoConosceIlDirigente}</Pill> : null}
          {passed && !unknown ? <Pill tone="success">{PALO.passataDalDirigente}</Pill> : null}
          {withoutUnit && !passed ? <Pill tone="info">{PALO.senzaUnita}</Pill> : null}
        </div>
        {note === "same_name_birth" ? (
          <p className="mship-note">
            <Icon name="alert" />
            {PALO.notaStessoNome}
          </p>
        ) : null}
        <div className="mship-card__actions" data-menu-for={member.uid}>
          <Button disabled={busy} icon="check" onClick={() => void act(member, "approve")}>
            {PALO.approva}
          </Button>
          <Button disabled={busy} onClick={() => void act(member, "decline")} variant="secondary">
            {PALO.nonLoConosco}
          </Button>
          {/* Disclosure, non un menu ARIA: due pulsanti che si raggiungono con Tab. */}
          <button
            aria-controls={`${ids}-menu-${member.uid}`}
            aria-expanded={menuUid === member.uid}
            aria-label={PALO.altreAzioni}
            className="mship-more"
            disabled={busy}
            onClick={() => {
              setMenuUp(false);
              setMenuUid((current) => (current === member.uid ? null : member.uid));
            }}
            type="button"
          >
            <Icon name="ellipsis" />
          </button>
          {menuUid === member.uid ? (
            <div
              className={menuUp ? "mship-menu mship-menu--up" : "mship-menu"}
              id={`${ids}-menu-${member.uid}`}
              ref={menuRef}
            >
              {!isAdmin ? (
                <button onClick={() => void act(member, "notMyUnit")} type="button">
                  {PALO.nonDellaMiaUnita}
                </button>
              ) : null}
              <button onClick={() => void act(member, "hasAccount")} type="button">
                {PALO.haGiaUnAccount}
              </button>
            </div>
          ) : null}
        </div>
      </li>
    );
  }

  function renderReview({ member, overdue }: { member: StakeMember; overdue: boolean }) {
    const busy = busyUid === member.uid;
    const hints = member.registrationHints.map((hint) => hint.title).filter(Boolean);
    return (
      <li className={overdue ? "mship-card mship-card--overdue" : "mship-card"} key={member.uid}>
        {head(member, metaOf(member, ""))}
        {hints.length || overdue ? (
          <div className="mship-card__ctx">
            {hints.length ? <Pill icon="calendar">{fillCopy(PALO.iscrizioni, { attivita: hints.join(", ") })}</Pill> : null}
            {overdue ? <Pill tone="warning">{PALO.daConfermareDaTempo}</Pill> : null}
          </div>
        ) : null}
        <div className="mship-card__actions">
          <Button disabled={busy} icon="check" onClick={() => void act(member, "confirmKnown")}>
            {PALO.loConosco}
          </Button>
          <Button disabled={busy} onClick={() => void act(member, "markUnknown")} variant="secondary">
            {PALO.nonLoConosco}
          </Button>
        </div>
      </li>
    );
  }

  function renderDeclined(member: StakeMember) {
    const busy = busyUid === member.uid;
    const when = member.decidedAtMs === null ? "" : fillCopy(PALO.rifiutataIl, { il: onDateLabel(member.decidedAtMs) });
    return (
      <li className="mship-card" key={member.uid}>
        {head(member, metaOf(member, when))}
        {canUndoDecline(member, { isAdmin, uid: viewerUid }) ? (
          <div className="mship-card__actions">
            <Button disabled={busy} onClick={() => void undoDecline(member)} variant="secondary">
              {PALO.annullaRifiuto}
            </Button>
          </div>
        ) : null}
      </li>
    );
  }

  // Vuoti senza azione: le richieste arrivano da sole, lo staff non deve fare niente.
  function empty(title: string, body: string) {
    return <EmptyState action={null} description={body} headingAs="h2" illustration={giovaniUrl} title={title} />;
  }

  const counts: Record<Tab, number> = {
    richieste: pending.length,
    "da-confermare": review.length,
    rifiutate: declined.length,
  };
  const labels: Record<Tab, string> = {
    richieste: PALO.schedaRichieste,
    "da-confermare": PALO.schedaDaConfermare,
    rifiutate: PALO.schedaRifiutate,
  };

  let body;
  if (queue.loading) {
    body = (
      <div aria-busy="true" className="mship-skeleton">
        <span className="sr-only" role="status">{PALO.caricamentoCoda}</span>
        {[0, 1, 2].map((item) => (
          <span aria-hidden="true" className="mship-skeleton__card" key={item} />
        ))}
      </div>
    );
  } else if (tab === "richieste") {
    body = pending.length ? (
      <div className="mship-queue"><ul className="mship-list">{pending.map(renderRequest)}</ul></div>
    ) : (
      empty(PALO.vuotoRichiesteTitolo, PALO.vuotoRichiesteCorpo)
    );
  } else if (tab === "da-confermare") {
    body = (
      <>
        <p className="mship-page__lead">{isAdmin ? PALO.daConfermareSpiega : PALO.daConfermareSpiegaDirigente}</p>
        {review.length ? (
          <div className="mship-queue"><ul className="mship-list">{review.map(renderReview)}</ul></div>
        ) : (
          empty(PALO.vuotoDaConfermareTitolo, PALO.vuotoDaConfermareCorpo)
        )}
      </>
    );
  } else {
    body = (
      <>
        <p className="mship-page__lead">{PALO.rifiutateSpiega}</p>
        {declined.length ? (
          <div className="mship-queue"><ul className="mship-list">{declined.map(renderDeclined)}</ul></div>
        ) : (
          empty(PALO.vuotoRifiutateTitolo, PALO.vuotoRifiutateCorpo)
        )}
      </>
    );
  }

  // Schede ARIA: frecce, Home e Fine spostano la scelta; nel Tab c'è solo la
  // scheda scelta, poi il pannello.
  function onTabsKey(event: KeyboardEvent<HTMLDivElement>) {
    const index = TABS.indexOf(tab);
    const next =
      event.key === "ArrowRight" ? TABS[(index + 1) % TABS.length]
        : event.key === "ArrowLeft" ? TABS[(index - 1 + TABS.length) % TABS.length]
          : event.key === "Home" ? TABS[0]
            : event.key === "End" ? TABS[TABS.length - 1]
              : null;
    if (!next) return;
    event.preventDefault();
    selectTab(next);
    document.getElementById(`${ids}-tab-${next}`)?.focus();
  }

  return (
    <div className="mship-page">
      <div aria-label={PALO.persone} className="mship-tabs" onKeyDown={onTabsKey} ref={tabsRef} role="tablist">
        {TABS.map((item) => (
          <button
            aria-controls={`${ids}-panel`}
            aria-selected={tab === item}
            id={`${ids}-tab-${item}`}
            key={item}
            onClick={() => selectTab(item)}
            role="tab"
            tabIndex={tab === item ? 0 : -1}
            type="button"
          >
            <span>{labels[item]}</span>
            {item !== "rifiutate" && counts[item] > 0 ? (
              <span className={item === "richieste" ? "mship-count mship-count--hot" : "mship-count"}>{counts[item]}</span>
            ) : null}
          </button>
        ))}
      </div>
      {queue.error || detailsError ? (
        <Notice
          action={
            detailsError ? (
              <Button onClick={() => setDetailsRetry((current) => current + 1)} variant="secondary">
                {PALO.riprova}
              </Button>
            ) : null
          }
          tone="danger"
        >
          <p>{PALO.erroreCoda}</p>
        </Notice>
      ) : null}
      <div aria-labelledby={`${ids}-tab-${tab}`} className="mship-panel" id={`${ids}-panel`} role="tabpanel">
        {body}
      </div>
      <UndoToast onDismiss={dismissToast} toast={toast} />
    </div>
  );
}
