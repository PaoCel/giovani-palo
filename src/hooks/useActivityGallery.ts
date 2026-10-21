import { useEffect, useRef, useState } from "react";

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
  const [gallery, setGallery] = useState<Gallery | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const ensuredRef = useRef<string | null>(null);
  const eventId = event?.id ?? "";

  useEffect(() => {
    if (!enabled || !stakeId || !eventId) {
      setGallery(null);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    setError(null);
    return galleriesService.subscribeGalleryByActivity(
      stakeId,
      eventId,
      (found) => {
        setGallery(found);
        setLoading(false);
      },
      (subError) => {
        // Mai il messaggio dell'SDK (in inglese): il diniego lo traduce la
        // galleria, il resto è la frase di rete.
        setError((subError as { code?: string }).code === "permission-denied" ? GALLERY_DENIED : PAROLE.erroreRete);
        setGallery(null);
        setLoading(false);
      },
    );
  }, [enabled, stakeId, eventId]);

  const windowOpenByDates = event ? isGalleryUploadOpen(event, null) : false;
  const expected = event ? computeActivityUploadWindow(event) : null;
  // Attività spostata dopo l'apertura della galleria: la callable riallinea la
  // finestra alle date nuove, salvo riapertura manuale di un admin.
  const windowStale =
    Boolean(gallery && expected) &&
    gallery!.uploadsWindowSource !== "manual" &&
    (gallery!.uploadsOpenFrom !== expected!.fromMs || gallery!.uploadsOpenUntil !== expected!.untilMs);
  const needsEnsure =
    enabled &&
    !loading &&
    ((windowOpenByDates && (!gallery || gallery.uploadsOpenUntil === null)) || windowStale);

  useEffect(() => {
    if (!needsEnsure || !stakeId || !eventId) return;
    const key = `${stakeId}:${eventId}`;
    if (ensuredRef.current === key) return;
    ensuredRef.current = key;
    galleriesService.ensureActivityGallery(stakeId, eventId).catch((ensureError: unknown) => {
      // La callable risponde in italiano; i codici generici dell'SDK no.
      setError(getAdminActionError(ensureError, "Impossibile aprire la galleria."));
    });
  }, [needsEnsure, stakeId, eventId]);

  const uploadOpen = Boolean(event && gallery && isGalleryUploadOpen(event, gallery));
  return { gallery, loading, error, uploadOpen };
}
