import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { AppIcon } from "@/components/AppIcon";
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
  return `${member.uid}:${member.version}`;
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
  const [toast, setToast] = useState<UndoToastState | null>(null);
  const [details, setDetails] = useState<Record<string, StaffDetails>>({});
  const toastId = useRef(0);
  // Un istante per apertura: etichette "da 3 giorni" e finestre di 30 giorni.
  const [nowMs] = useState(() => Date.now());

  const pendingRaw = useMemo(() => pendingQueue(queue.pending), [queue.pending]);
  const review = useMemo(() => reviewQueue(queue.review, nowMs, isAdmin), [queue.review, nowMs, isAdmin]);
  const declinedRaw = useMemo(() => recentDeclined(queue.declined, nowMs), [queue.declined, nowMs]);

  // Documenti dello staff di ogni richiesta e rifiutata: la nota "stesso nome e
  // data" e lo stato di prima (chi ha agito e come, per etichette e "Annulla
  // rifiuto"), mai leggibili dal richiedente. Due letture per persona; la chiave
  // comprende la versione, così una persona cambiata si rilegge.
  const detailMembers = useMemo(() => [...pendingRaw, ...declinedRaw], [pendingRaw, declinedRaw]);
  const detailKeys = detailMembers.map(detailKey).join(",");
  useEffect(() => {
    let active = true;
    const missing = detailMembers.filter((member) => !(detailKey(member) in details));
    if (!missing.length) return undefined;
    void Promise.all(
      missing.map(async (member) => {
        const [note, previous] = await Promise.all([
          member.status === "pending"
            ? stakeMembersService.getStaffNoteKind(stakeId, member.uid).catch(() => null)
            : Promise.resolve(null),
          stakeMembersService.getStaffPrevious(stakeId, member.uid).catch(() => null),
        ]);
        return [detailKey(member), { note, previous }] as const;
      }),
    ).then((entries) => {
      if (active) setDetails((current) => ({ ...current, ...Object.fromEntries(entries) }));
    });
    return () => {
      active = false;
    };
    // `details` resta fuori di proposito: la lettura parte solo quando cambia la coda.
  }, [detailKeys, stakeId]);

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
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuUid(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuUid]);

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
        <div className="mship-empty">
          <p>{PALO.senzaUnitaProfilo}</p>
        </div>
      </div>
    );
  }

  function head(member: StakeMember, meta: string) {
    return (
      <div className="mship-card__head">
        <span aria-hidden="true" className={`mship-avatar mship-avatar--${avatarTone(member.uid)}`}>
          {initialsOf(nameOf(member))}
        </span>
        <div>
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
          <AppIcon aria-hidden="true" name="calendar" />
          <span>{hints.length ? fillCopy(PALO.iscrizioni, { attivita: hints.join(", ") }) : PALO.nessunaIscrizione}</span>
          {isMigratedAccount(member) ? <span className="mship-tag">{PALO.accountEsistente}</span> : null}
          {unknown ? <span className="mship-tag">{PALO.nonLoConosceIlDirigente}</span> : null}
          {passed && !unknown ? <span className="mship-tag mship-tag--blue">{PALO.passataDalDirigente}</span> : null}
          {withoutUnit && !passed ? <span className="mship-tag mship-tag--blue">{PALO.senzaUnita}</span> : null}
        </div>
        {note === "same_name_birth" ? (
          <p className="mship-note">
            <AppIcon aria-hidden="true" name="alert" />
            {PALO.notaStessoNome}
          </p>
        ) : null}
        <div className="mship-card__actions" data-menu-for={member.uid}>
          <button className="mship-btn mship-btn--primary" disabled={busy} onClick={() => void act(member, "approve")} type="button">
            <AppIcon aria-hidden="true" name="check" />
            {PALO.approva}
          </button>
          <button className="mship-btn mship-btn--out" disabled={busy} onClick={() => void act(member, "decline")} type="button">
            {PALO.nonLoConosco}
          </button>
          <button
            aria-expanded={menuUid === member.uid}
            aria-haspopup="menu"
            aria-label={PALO.altreAzioni}
            className="mship-btn mship-btn--out mship-btn--icon"
            disabled={busy}
            onClick={() => setMenuUid((current) => (current === member.uid ? null : member.uid))}
            type="button"
          >
            <AppIcon aria-hidden="true" name="ellipsis" />
          </button>
          {menuUid === member.uid ? (
            <div className="mship-menu" role="menu">
              {!isAdmin ? (
                <button onClick={() => void act(member, "notMyUnit")} role="menuitem" type="button">
                  {PALO.nonDellaMiaUnita}
                </button>
              ) : null}
              <button onClick={() => void act(member, "hasAccount")} role="menuitem" type="button">
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
            {hints.length ? (
              <>
                <AppIcon aria-hidden="true" name="calendar" />
                <span>{fillCopy(PALO.iscrizioni, { attivita: hints.join(", ") })}</span>
              </>
            ) : null}
            {overdue ? <span className="mship-tag">{PALO.daConfermareDaTempo}</span> : null}
          </div>
        ) : null}
        <div className="mship-card__actions">
          <button className="mship-btn mship-btn--primary" disabled={busy} onClick={() => void act(member, "confirmKnown")} type="button">
            <AppIcon aria-hidden="true" name="check" />
            {PALO.loConosco}
          </button>
          <button className="mship-btn mship-btn--out" disabled={busy} onClick={() => void act(member, "markUnknown")} type="button">
            {PALO.nonLoConosco}
          </button>
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
            <button className="mship-btn mship-btn--out" disabled={busy} onClick={() => void undoDecline(member)} type="button">
              {PALO.annullaRifiuto}
            </button>
          </div>
        ) : null}
      </li>
    );
  }

  function empty(title: string, body: string) {
    return (
      <div className="mship-empty">
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
    );
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
    body = <p className="subtle-text">{PALO.caricamentoCoda}</p>;
  } else if (tab === "richieste") {
    body = pending.length ? (
      <ul className="mship-list">{pending.map(renderRequest)}</ul>
    ) : (
      empty(PALO.vuotoRichiesteTitolo, PALO.vuotoRichiesteCorpo)
    );
  } else if (tab === "da-confermare") {
    body = (
      <>
        <p className="mship-page__lead">{isAdmin ? PALO.daConfermareSpiega : PALO.daConfermareSpiegaDirigente}</p>
        {review.length ? (
          <ul className="mship-list">{review.map(renderReview)}</ul>
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
          <ul className="mship-list">{declined.map(renderDeclined)}</ul>
        ) : (
          empty(PALO.vuotoRifiutateTitolo, PALO.vuotoRifiutateCorpo)
        )}
      </>
    );
  }

  return (
    <div className="mship-page">
      <div aria-label={PALO.persone} className="mship-tabs" role="tablist">
        {TABS.map((item) => (
          <button
            aria-selected={tab === item}
            key={item}
            onClick={() => selectTab(item)}
            role="tab"
            type="button"
          >
            {labels[item]}
            {item !== "rifiutate" && counts[item] > 0 ? (
              <span className={item === "richieste" ? "mship-count mship-count--hot" : "mship-count"}>{counts[item]}</span>
            ) : null}
          </button>
        ))}
      </div>
      {queue.error ? (
        <p className="form-error" role="alert">
          {PALO.erroreCoda}
        </p>
      ) : null}
      {body}
      <UndoToast onDismiss={dismissToast} toast={toast} />
    </div>
  );
}
