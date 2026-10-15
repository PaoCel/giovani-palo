import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import "@/styles/activityGallery.css";

import { AppIcon } from "@/components/AppIcon";
import { CampHighlightCard } from "@/components/camp/CampHighlightCard";
import { activityMediaPath } from "@/components/gallery/ActivityMediaCard";
import { useUploadApi } from "@/app/providers/UploadManagerProvider";
import { useActivityGallery, useGalleryAccess } from "@/hooks/useActivityGallery";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncData } from "@/hooks/useAsyncData";
import { DEFAULT_STAKE_ID } from "@/config/app";
import { eventsService } from "@/services/firestore/eventsService";
import { galleriesService } from "@/services/firestore/galleriesService";
import type { Event, GalleryMedia } from "@/types";
import { isActivityLive, isGalleryUploadOpen } from "@/utils/galleryWindow";

async function resolveLiveActivity(stakeId: string): Promise<Event | null> {
  if (!stakeId) return null;
  const events = await eventsService.listPublicEvents(stakeId);
  const now = Date.now();
  return (
    events
      .filter((event) => isGalleryUploadOpen(event, null, now))
      // La più recente per inizio: è quella di cui si stanno facendo le foto.
      .sort((left, right) => right.startDate.localeCompare(left.startDate))[0] ?? null
  );
}

/**
 * Card home di tutti i ruoli. Durante un'attività (e per 7 giorni dopo) invita
 * a caricare foto e video; altrimenti mostra la card dell'ultimo campeggio.
 */
export function ActivityMediaHighlight() {
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId || DEFAULT_STAKE_ID;
  const { isMember } = useGalleryAccess(stakeId);
  const sessionKey = session ? `${session.firebaseUser.uid}:${stakeId}` : "none";

  const { data: live } = useAsyncData<Event | null>(
    () => (isMember ? resolveLiveActivity(stakeId) : Promise.resolve(null)),
    [sessionKey, isMember],
    null,
  );

  if (!live) return <CampHighlightCard />;
  return <LiveActivityCard stakeId={stakeId} event={live} />;
}

function LiveActivityCard({ stakeId, event }: { stakeId: string; event: Event }) {
  const navigate = useNavigate();
  const { pickMedia } = useUploadApi();
  const { gallery, uploadOpen } = useActivityGallery(stakeId, event, true);
  const [latest, setLatest] = useState<GalleryMedia[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const galleryId = gallery?.id ?? "";

  useEffect(() => {
    if (!galleryId) {
      setLatest([]);
      return undefined;
    }
    return galleriesService.subscribeLatestMedia(stakeId, galleryId, 3, setLatest, () =>
      setLatest([]),
    );
  }, [stakeId, galleryId]);

  const mediaCount = gallery?.mediaCount ?? 0;
  const live = isActivityLive(event);
  const href = activityMediaPath(event.id);

  function onPick(changeEvent: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(changeEvent.target.files ?? []);
    changeEvent.target.value = "";
    if (!gallery || files.length === 0) return;
    pickMedia(files, gallery, mediaCount);
    navigate(href);
  }

  return (
    <section className="dash-section">
      <article className="ag-live">
        <input ref={inputRef} type="file" accept="image/*,video/*" multiple hidden onChange={onPick} />
        <div className="ag-live__top">
          <span className="ag-live__pill">
            <i aria-hidden="true" />
            {live ? "In corso" : "Appena concluso"}
          </span>
          <h3>{event.title}</h3>
          <p>
            {mediaCount === 0
              ? live
                ? "Scatta e carica le prime foto del gruppo."
                : "Carica le foto e i video rimasti sul telefono."
              : `${mediaCount === 1 ? "1 foto o video caricato" : `${mediaCount} foto e video caricati`} dal gruppo`}
          </p>
        </div>
        {latest.length > 0 ? (
          <Link to={href} className="ag-live__strip" aria-label="Apri foto e video">
            {latest.map((item) => (
              <span
                key={item.id}
                className="ag-live__thumb"
                style={{
                  backgroundImage: `url("${
                    item.type === "image"
                      ? item.thumbnailUrl ?? item.optimizedUrl ?? ""
                      : item.posterUrl ?? item.thumbnailUrl ?? ""
                  }")`,
                }}
              />
            ))}
            {mediaCount > latest.length ? (
              <span className="ag-live__more">+{mediaCount - latest.length}</span>
            ) : null}
          </Link>
        ) : null}
        <div className="ag-live__actions">
          {uploadOpen ? (
            <button
              type="button"
              className="ag-btn ag-btn--amber"
              onClick={() => inputRef.current?.click()}
            >
              <AppIcon name="camera" />
              Aggiungi foto o video
            </button>
          ) : null}
          <Link className="ag-btn ag-btn--glass" to={href} aria-label="Vedi tutte le foto e i video">
            {uploadOpen ? <AppIcon name="eye" /> : "Vedi tutte"}
          </Link>
        </div>
      </article>
    </section>
  );
}
