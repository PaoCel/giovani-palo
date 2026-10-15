import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { galleriesService } from "@/services/firestore/galleriesService";
import type { Event, Gallery } from "@/types";
import { computeActivityUploadWindow, isGalleryUploadOpen } from "@/utils/galleryWindow";

export interface ActivityGalleryAccess {
  /** Utente con account nel palo: può vedere e (a finestra aperta) caricare. */
  isMember: boolean;
  /** Admin o dirigente di unità del palo: toglie e modera. */
  isStaff: boolean;
  uid: string;
}

export function useGalleryAccess(stakeId: string): ActivityGalleryAccess {
  const { session } = useAuth();
  const uid = session?.firebaseUser.uid ?? "";
  if (!session?.isAuthenticated || session.isAnonymous || !stakeId) {
    return { isMember: false, isStaff: false, uid };
  }
  const isSuperAdmin = session.profile.role === "super_admin";
  const sameStake = session.profile.stakeId === stakeId;
  const isMember = isSuperAdmin || sameStake;
  const isStaff = isSuperAdmin || (sameStake && (session.isAdmin || session.isUnitLeader));
  return { isMember, isStaff, uid };
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
        setError(subError.message || "Impossibile caricare la galleria.");
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
      setError(
        ensureError instanceof Error && ensureError.message
          ? ensureError.message
          : "Impossibile aprire la galleria.",
      );
    });
  }, [needsEnsure, stakeId, eventId]);

  const uploadOpen = Boolean(event && gallery && isGalleryUploadOpen(event, gallery));
  return { gallery, loading, error, uploadOpen };
}
