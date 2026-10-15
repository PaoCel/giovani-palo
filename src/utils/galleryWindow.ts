import type { Event, Gallery } from "@/types";

// Stessi valori di functions/lib/activityGallery.js (computeUploadWindow): la
// callable scrive la finestra sulla galleria e le rules la applicano; qui serve
// solo a decidere cosa mostrare prima che la galleria esista.
export const GALLERY_OPEN_BEFORE_START_MS = 2 * 60 * 60 * 1000;
export const GALLERY_OPEN_AFTER_END_MS = 7 * 24 * 60 * 60 * 1000;

export interface GalleryUploadWindow {
  fromMs: number;
  untilMs: number;
}

function parseIsoMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function computeActivityUploadWindow(
  event: Pick<Event, "startDate" | "endDate">,
): GalleryUploadWindow | null {
  const startMs = parseIsoMs(event.startDate);
  if (startMs === null) return null;
  const endMs = parseIsoMs(event.endDate);
  const lastMs = endMs !== null && endMs > startMs ? endMs : startMs;
  return {
    fromMs: startMs - GALLERY_OPEN_BEFORE_START_MS,
    untilMs: lastMs + GALLERY_OPEN_AFTER_END_MS,
  };
}

/**
 * La galleria accetta caricamenti dai membri? Se esiste vale la finestra
 * scritta sulla galleria (può averla cambiata un admin), altrimenti quella
 * calcolata dalle date dell'attività.
 */
export function isGalleryUploadOpen(
  event: Pick<Event, "startDate" | "endDate">,
  gallery: Pick<Gallery, "uploadsClosed" | "uploadsOpenFrom" | "uploadsOpenUntil"> | null,
  nowMs: number = Date.now(),
): boolean {
  if (gallery) {
    if (gallery.uploadsClosed) return false;
    if (gallery.uploadsOpenFrom === null || gallery.uploadsOpenUntil === null) return false;
    return nowMs >= gallery.uploadsOpenFrom && nowMs < gallery.uploadsOpenUntil;
  }
  const uploadWindow = computeActivityUploadWindow(event);
  return uploadWindow !== null && nowMs >= uploadWindow.fromMs && nowMs < uploadWindow.untilMs;
}

/** L'attività è in corso: dal ritrovo (2 ore prima dell'inizio) alla fine. */
export function isActivityLive(
  event: Pick<Event, "startDate" | "endDate">,
  nowMs: number = Date.now(),
): boolean {
  const startMs = parseIsoMs(event.startDate);
  if (startMs === null) return false;
  const endMs = parseIsoMs(event.endDate) ?? startMs;
  return nowMs >= startMs - GALLERY_OPEN_BEFORE_START_MS && nowMs <= Math.max(endMs, startMs);
}
