import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { useStakeMembership } from "@/hooks/useStakeMembership";
import { galleriesService } from "@/services/firestore/galleriesService";
import type { Event, Gallery } from "@/types";
import { computeActivityUploadWindow, isGalleryUploadOpen } from "@/utils/galleryWindow";
import { getAdminActionError } from "@/utils/adminErrors";
import type { MemberAccess } from "@/utils/stakeMembership";
import { PALO } from "@/copy/palo";
import { PAROLE } from "@/copy/parole";

const GALLERY_DENIED = PALO.soloMembriFoto;

export interface ActivityGalleryAccess {
  /** Membro attivo del palo (o staff): vede e, a finestra aperta, carica. */
  isMember: boolean;
  /** Admin o dirigente di unità del palo: toglie e modera. */
  isStaff: boolean;
  uid: string;
  /** Perché non è membro: `waiting` e `out` hanno il loro testo, `loading` nessuno. */
  access: MemberAccess;
}

// "Membro" viene da `stakes/{s}/members/{uid}` (docs/APPARTENENZA_AL_PALO.md,
// «Client della fase 3»), mai da `users.stakeId`: stessa regola delle rules.
export function useGalleryAccess(stakeId: string): ActivityGalleryAccess {
  const { access, isStaff, uid } = useStakeMembership(stakeId);
  return { isMember: access === "member", isStaff, uid, access };
}

interface ActivityGalleryState {
  gallery: Gallery | null;
  loading: boolean;
  error: string | null;
  uploadOpen: boolean;
}

/**
 * Galleria dell'attività, in tempo reale. Se la finestra di caricamento è
 * aperta e la galleria non c'è ancora (o non ha la finestra), chiede alla
 * callable di aprirla: così il bottone "Aggiungi" funziona al primo tocco.
 */
export function useActivityGallery(
  stakeId: string,
  event: Pick<Event, "id" | "startDate" | "endDate"> | null,
  enabled: boolean,
): ActivityGalleryState {
  const { session } = useAuth();
  const eventId = event?.id ?? "";
  const context = `${session?.firebaseUser.uid ?? ""}:${stakeId}:${eventId}:${enabled}`;
  const [state, setState] = useState<ActivityGalleryState & { key: string }>(() => ({
    key: context, gallery: null, loading: enabled, error: null, uploadOpen: false,
  }));
  const ensuredRef = useRef<string | null>(null);
  const current = state.key === context ? state : { gallery: null, loading: enabled, error: null };
  const { gallery, loading, error } = current;

  useEffect(() => {
    let active = true;
    setState({ key: context, gallery: null, loading: enabled, error: null, uploadOpen: false });
    if (!enabled || !stakeId || !eventId) {
      setState({ key: context, gallery: null, loading: false, error: null, uploadOpen: false });
      return () => { active = false; };
    }
    const unsubscribe = galleriesService.subscribeGalleryByActivity(
      stakeId, eventId,
      (found) => {
        if (active) setState({ key: context, gallery: found, loading: false, error: null, uploadOpen: false });
      },
      (subError) => {
        if (!active) return;
        setState({ key: context, gallery: null, loading: false, uploadOpen: false,
          error: (subError as { code?: string }).code === "permission-denied" ? GALLERY_DENIED : PAROLE.erroreRete });
      },
    );
    return () => { active = false; unsubscribe(); };
  }, [context, enabled, stakeId, eventId]);

  const windowOpenByDates = event ? isGalleryUploadOpen(event, null) : false;
  const expected = event ? computeActivityUploadWindow(event) : null;
  // Attività spostata dopo l'apertura della galleria: la callable riallinea la
  // finestra alle date nuove, salvo riapertura manuale di un admin.
  const windowStale =
    Boolean(gallery && expected) &&
    gallery!.uploadsWindowSource !== "manual" &&
    (gallery!.uploadsOpenFrom !== expected!.fromMs || gallery!.uploadsOpenUntil !== expected!.untilMs);
  // Dopo una lettura fallita non si sa se la galleria c'è: niente `ensure`.
  const needsEnsure =
    enabled &&
    !loading &&
    !error &&
    ((windowOpenByDates && (!gallery || gallery.uploadsOpenUntil === null)) || windowStale);

  useEffect(() => {
    if (!needsEnsure || !stakeId || !eventId) return;
    const key = context;
    if (ensuredRef.current === key) return;
    ensuredRef.current = key;
    let active = true;
    galleriesService.ensureActivityGallery(stakeId, eventId).catch((ensureError: unknown) => {
      // La callable risponde in italiano; i codici generici dell'SDK no.
      if (active) setState(previous => previous.key === context ? { ...previous, error: getAdminActionError(ensureError, "Impossibile aprire la galleria.") } : previous);
    });
    return () => { active = false; };
  }, [needsEnsure, stakeId, eventId, context]);

  const uploadOpen = Boolean(event && gallery && isGalleryUploadOpen(event, gallery));
  return { gallery, loading, error, uploadOpen };
}
