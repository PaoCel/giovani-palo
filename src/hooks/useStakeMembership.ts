import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { useAuth } from "@/hooks/useAuth";
import { stakeMembersService, type MemberQueueKind } from "@/services/firestore/stakeMembersService";
import { needsProfileCompletion } from "@/utils/profileCompletion";
import {
  memberAccessOf,
  type MemberAccess,
  type OwnMembership,
  type StakeMember,
} from "@/utils/stakeMembership";

// Un solo ascolto per palo e utente, condiviso da tutte le superfici (banner,
// galleria, record, sondaggi, profilo): si apre col primo componente e si
// chiude con l'ultimo.

interface Entry {
  state: OwnMembership & { fromServer: boolean };
  listeners: Set<() => void>;
  unsubscribe: (() => void) | null;
}

const LOADING: Entry["state"] = { loading: true, member: null, fromServer: false };
const entries = new Map<string, Entry>();
// Richieste già chieste in questa sessione: il client chiama `request` una
// volta sola quando il server dice che il documento non c'è (di solito l'ha
// già creato il trigger su users).
const requested = new Set<string>();

function entryFor(key: string) {
  let entry = entries.get(key);
  if (!entry) {
    entry = { state: LOADING, listeners: new Set(), unsubscribe: null };
    entries.set(key, entry);
  }
  return entry;
}

function subscribeEntry(stakeId: string, uid: string, listener: () => void) {
  const key = `${stakeId}/${uid}`;
  const entry = entryFor(key);
  entry.listeners.add(listener);
  if (!entry.unsubscribe) {
    const emit = (state: Entry["state"]) => {
      entry.state = state;
      entry.listeners.forEach((notify) => notify());
    };
    entry.unsubscribe = stakeMembersService.subscribeOwn(
      stakeId,
      uid,
      (member, fromServer) => {
        // Dalla cache vuota non si conclude "nessun documento": si aspetta il server.
        if (!member && !fromServer && entry.state.loading) return;
        emit({ loading: false, member, fromServer });
      },
      () => {
        // La rule apre sempre il proprio documento: un errore è rete o
        // sessione scaduta. Senza dati certi la superficie resta chiusa.
        emit({ loading: false, member: null, fromServer: false });
      },
    );
  }
  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size === 0) {
      entry.unsubscribe?.();
      entries.delete(key);
    }
  };
}

const NO_STAKE: Entry["state"] = { loading: false, member: null, fromServer: false };

/** Il proprio documento members del palo, condiviso; `loading` finché non arriva. */
export function useOwnMembership(stakeId: string) {
  const { session } = useAuth();
  const uid = session && session.isAuthenticated && !session.isAnonymous ? session.firebaseUser.uid : "";
  const enabled = Boolean(uid && stakeId);
  const subscribe = useMemo(
    () => (listener: () => void) => (enabled ? subscribeEntry(stakeId, uid, listener) : () => undefined),
    [enabled, stakeId, uid],
  );
  const getSnapshot = () => (enabled ? entryFor(`${stakeId}/${uid}`).state : NO_STAKE);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export interface StakeMembershipView {
  access: MemberAccess;
  member: StakeMember | null;
  isStaff: boolean;
  uid: string;
}

/** Chi è membro del palo (docs/APPARTENENZA_AL_PALO.md, «Client della fase 3»). */
export function useStakeMembership(stakeId: string): StakeMembershipView {
  const { session } = useAuth();
  const membership = useOwnMembership(stakeId);
  const uid = session?.firebaseUser.uid ?? "";
  const role = session?.profile.role ?? "";
  const profileStakeId = session?.profile.stakeId ?? "";
  const access = memberAccessOf({
    signedIn: Boolean(session?.isAuthenticated),
    anonymous: Boolean(session?.isAnonymous),
    role,
    profileStakeId,
    stakeId,
    membership,
  });
  const isStaff =
    access !== "guest" && (role === "super_admin" || ((role === "admin" || role === "unit_leader") && profileStakeId === stakeId));
  return { access, member: membership.member, isStaff, uid };
}

/**
 * Se il server dice che il proprio documento non c'è e il profilo è completo,
 * chiede di entrare nel palo scelto (una volta per sessione). Copre il trigger
 * in ritardo o fallito.
 */
export function useEnsureMembershipRequest() {
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId ?? "";
  const membership = useOwnMembership(stakeId);
  const uid = session?.firebaseUser.uid ?? "";
  const complete = session ? !needsProfileCompletion(session.profile) : false;
  const role = session?.profile.role ?? "";
  const staff = role === "admin" || role === "unit_leader" || role === "super_admin";
  const fromServer = "fromServer" in membership ? membership.fromServer : false;
  const missing = !membership.loading && !membership.member && fromServer;

  useEffect(() => {
    if (!missing || !complete || staff || !uid || !stakeId || session?.isAnonymous) return;
    const key = `${stakeId}/${uid}`;
    if (requested.has(key)) return;
    requested.add(key);
    stakeMembersService.run({ action: "request", stakeId }).catch(() => {
      // Il banner resta "in attesa": il trigger o il prossimo accesso riprovano.
      requested.delete(key);
    });
  }, [missing, complete, staff, uid, stakeId, session?.isAnonymous]);
}

export interface MemberQueueState {
  pending: StakeMember[];
  declined: StakeMember[];
  review: StakeMember[];
  loading: boolean;
  error: boolean;
}

/**
 * Coda dello staff in tempo reale: l'admin vede il palo intero (`unitId`
 * null), il dirigente solo la sua unità dichiarata.
 */
export function useMemberQueue(stakeId: string, unitId: string | null, enabled: boolean): MemberQueueState {
  const [state, setState] = useState<Record<MemberQueueKind, StakeMember[] | null>>({
    pending: null,
    declined: null,
    review: null,
  });
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!enabled || !stakeId) return undefined;
    setState({ pending: null, declined: null, review: null });
    setError(false);
    const kinds: MemberQueueKind[] = ["pending", "declined", "review"];
    const unsubscribes = kinds.map((kind) =>
      stakeMembersService.subscribeQueue(
        stakeId,
        kind,
        unitId,
        (members) => setState((current) => ({ ...current, [kind]: members })),
        () => {
          // Un diniego è definitivo: via anche quello che la cache aveva già dato.
          setError(true);
          setState((current) => ({ ...current, [kind]: [] }));
        },
      ),
    );
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [enabled, stakeId, unitId]);

  return {
    pending: state.pending ?? [],
    declined: state.declined ?? [],
    review: state.review ?? [],
    loading: enabled && (state.pending === null || state.declined === null || state.review === null),
    error,
  };
}

/**
 * Quante persone in una coda dello staff, in tempo reale (menu e dashboard).
 * Per "da confermare" contano solo i membri ancora attivi.
 */
export function useMemberQueueCount(stakeId: string, kind: MemberQueueKind, unitId: string | null, enabled: boolean) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled || !stakeId) {
      setCount(0);
      return undefined;
    }
    return stakeMembersService.subscribeQueue(
      stakeId,
      kind,
      unitId,
      (members) => setCount(kind === "review" ? members.filter((member) => member.status === "active").length : members.length),
      () => setCount(0),
    );
  }, [enabled, stakeId, kind, unitId]);
  return count;
}

/** Numero delle richieste in attesa, per il menu dello staff. */
export function usePendingRequestCount(stakeId: string, unitId: string | null, enabled: boolean) {
  return useMemberQueueCount(stakeId, "pending", unitId, enabled);
}
