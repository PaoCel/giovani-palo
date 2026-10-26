import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import "@/styles/activityGallery.css";

import { useAuth } from "@/hooks/useAuth";
import { AppIcon } from "@/components/AppIcon";
import { MemberLockedNote } from "@/components/membership/MemberLockedNote";
import { useUploadApi } from "@/app/providers/UploadManagerProvider";
import { useActivityGallery, useGalleryAccess } from "@/hooks/useActivityGallery";
import { galleriesService } from "@/services/firestore/galleriesService";
import type { Event, GalleryMedia } from "@/types";
import { computeActivityUploadWindow } from "@/utils/galleryWindow";

export function activityMediaPath(eventId: string) {
  return `/activities/${eventId}/foto`;
}

function countLabel(count: number) {
  if (count === 0) return "Ancora nessuna";
  return count === 1 ? "1 foto o video" : `${count} foto e video`;
}

function thumbOf(item: GalleryMedia) {
  return item.type === "image"
    ? item.thumbnailUrl ?? item.optimizedUrl ?? item.storageUrl ?? ""
    : item.posterUrl ?? item.thumbnailUrl ?? "";
}

function useLatestMedia(stakeId: string, galleryId: string, count: number) {
  const { session } = useAuth();
  const key = `${session?.firebaseUser.uid ?? ""}:${stakeId}:${galleryId}:${count}`;
  const [result, setResult] = useState<{ key: string; media: GalleryMedia[] }>({ key: "", media: [] });
  useEffect(() => {
    let active = true;
    if (!stakeId || !galleryId) {
      setResult({ key, media: [] });
      return () => { active = false; };
    }
    const unsubscribe = galleriesService.subscribeLatestMedia(stakeId, galleryId, count,
      media => { if (active) setResult({ key, media }); },
      () => { if (active) setResult({ key, media: [] }); });
    return () => { active = false; unsubscribe(); };
  }, [key, stakeId, galleryId, count]);
  return result.key === key ? result.media : [];
}

interface ActivityMediaCardProps {
  stakeId: string;
  event: Pick<Event, "id" | "startDate" | "endDate" | "title">;
  className?: string;
}

/**
 * Ingresso a foto e video nella pagina dell'attività, sotto il titolo.
 * Compare dall'apertura della finestra di caricamento in poi; da chiusa resta
 * solo se ci sono contenuti da guardare.
 */
export function ActivityMediaCard({ stakeId, event, className }: ActivityMediaCardProps) {
  const navigate = useNavigate();
  const { session } = useAuth();
  const { isMember, access } = useGalleryAccess(stakeId);
  const { pickMedia } = useUploadApi();
  const { gallery, loading, uploadOpen } = useActivityGallery(stakeId, event, isMember);
  const latest = useLatestMedia(stakeId, gallery?.id ?? "", 5);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const context = `${session?.firebaseUser.uid ?? ""}:${stakeId}:${event.id}:${access}:${gallery?.id ?? ""}:${uploadOpen}`;
  const contextRef = useRef(context);
  contextRef.current = context;
  const pickerContext = useRef("");

  const uploadWindow = computeActivityUploadWindow(event);
  const started = uploadWindow !== null && Date.now() >= uploadWindow.fromMs;
  if (!started) return null;

  const rootClass = `ag-card${className ? ` ${className}` : ""}`;
  const galleryHref = activityMediaPath(event.id);

  // Finché il documento members non arriva né contenuto né lucchetto.
  if (access === "loading") return null;

  if (!isMember) {
    return (
      <section className={rootClass}>
        <div className="ag-card__head">
          <h3>Foto e video</h3>
        </div>
        {access === "guest" ? (
          <Link
            className="ag-btn ag-btn--primary"
            to={`/login?redirect=${encodeURIComponent(galleryHref)}`}
          >
            Accedi per vedere foto e video
          </Link>
        ) : (
          <MemberLockedNote access={access} kind="foto" />
        )}
      </section>
    );
  }

  const mediaCount = gallery?.mediaCount ?? 0;
  if (!loading && !uploadOpen && mediaCount === 0) return null;

  function onPick(changeEvent: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(changeEvent.target.files ?? []);
    changeEvent.target.value = "";
    if (!gallery || !isMember || !uploadOpen || !navigator.onLine || pickerContext.current !== contextRef.current || files.length === 0) return;
    pickMedia(files, gallery, mediaCount);
    navigate(galleryHref);
  }

  // 4 anteprime lascerebbero un buco nella griglia: se ne mostrano 3.
  const shown = latest.length === 4 ? latest.slice(0, 3) : latest;
  const [big, ...rest] = shown;
  const extra = Math.max(0, mediaCount - shown.length);

  return (
    <section className={rootClass}>
      <input ref={inputRef} type="file" accept="image/*,video/*" multiple hidden onChange={onPick} />
      <div className="ag-card__head">
        <h3>Foto e video</h3>
        <span className="ag-card__count">{countLabel(mediaCount)}</span>
      </div>

      {big ? (
        <Link
          to={galleryHref}
          className={`ag-mosaic ag-mosaic--${shown.length}`}
          aria-label="Apri tutte le foto e i video"
        >
          <span className="ag-mosaic__big" style={{ backgroundImage: `url("${thumbOf(big)}")` }}>
            {big.type === "video" ? (
              <span className="ag-tile__play" aria-hidden="true">
                <AppIcon name="play" />
              </span>
            ) : null}
          </span>
          {rest.map((item, index) => (
            <span
              key={item.id}
              className="ag-mosaic__cell"
              style={{ backgroundImage: `url("${thumbOf(item)}")` }}
            >
              {index === rest.length - 1 && extra > 0 ? (
                <span className="ag-mosaic__more">+{extra}</span>
              ) : item.type === "video" ? (
                <span className="ag-tile__play" aria-hidden="true">
                  <AppIcon name="play" />
                </span>
              ) : null}
            </span>
          ))}
        </Link>
      ) : null}

      <div className="ag-card__actions">
        {uploadOpen ? (
          <button
            type="button"
            className="ag-btn ag-btn--primary"
            disabled={!navigator.onLine}
            onClick={() => { pickerContext.current = context; inputRef.current?.click(); }}
          >
            <AppIcon name="camera" />
            Aggiungi foto o video
          </button>
        ) : null}
        {mediaCount > 0 ? (
          <Link
            className={`ag-btn ${uploadOpen ? "ag-btn--soft" : "ag-btn--primary"}`}
            to={galleryHref}
          >
            Vedi tutte
          </Link>
        ) : null}
      </div>
      {uploadOpen ? (
        <p className="ag-card__hint">
          Le vedono solo gli iscritti al palo con un account. Carica solo foto in cui le
          persone sono d'accordo.
        </p>
      ) : null}
    </section>
  );
}
