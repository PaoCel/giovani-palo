import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import "@/styles/activityGallery.css";

import { AppIcon } from "@/components/AppIcon";
import { CampHighlightCard } from "@/components/camp/CampHighlightCard";
import { activityMediaPath } from "@/components/gallery/ActivityMediaCard";
import { MemberLockedNote } from "@/components/membership/MemberLockedNote";
import { useUploadApi } from "@/app/providers/UploadManagerProvider";
import { useActivityGallery, useGalleryAccess } from "@/hooks/useActivityGallery";
import { useAuth } from "@/hooks/useAuth";
import { useAsyncData } from "@/hooks/useAsyncData";
import { DEFAULT_STAKE_ID } from "@/config/app";
import { eventsService } from "@/services/firestore/eventsService";
import { galleriesService } from "@/services/firestore/galleriesService";
import type { Event, GalleryMedia } from "@/types";
import { isActivityLive, isGalleryUploadOpen } from "@/utils/galleryWindow";
import type { MemberAccess } from "@/utils/stakeMembership";

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
 * Card home dei membri del palo. Durante un'attività (e per 7 giorni dopo)
 * invita a caricare foto e video; altrimenti mostra la card dell'ultimo
 * campeggio. A chi aspetta la verifica o è fuori dal palo, durante
 * un'attività, mostra la card chiusa con il motivo; altrimenti niente.
 */
export function ActivityMediaHighlight({ excludeActivityId }: { excludeActivityId?: string } = {}) {
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId || DEFAULT_STAKE_ID;
  const { isMember, access } = useGalleryAccess(stakeId);
  const locked = access === "waiting" || access === "out";
  const sessionKey = session ? `${session.firebaseUser.uid}:${stakeId}` : "none";

  const { data: result } = useAsyncData<{ key: string; live: Event | null }>(
    // Le attività pubbliche le legge chiunque: la card chiusa non tocca la galleria.
    async () => ({ key: sessionKey, live: isMember || locked ? await resolveLiveActivity(stakeId) : null }),
    [sessionKey, isMember, locked],
    { key: "", live: null },
  );
  const live = result.key === sessionKey ? result.live : null;

  if (excludeActivityId && live?.id === excludeActivityId) return null;

  // Chi non è membro non legge la galleria: durante un'attività vede la card
  // chiusa con il motivo, altrimenti niente (il banner spiega il resto).
  if (locked) return live ? <LockedActivityCard access={access} event={live} /> : null;
  if (!isMember) return null;
  if (!live) return <CampHighlightCard key={sessionKey} />;
  return <LiveActivityCard key={`${sessionKey}:${live.id}`} stakeId={stakeId} event={live} />;
}

function LockedActivityCard({ access, event }: { access: MemberAccess; event: Event }) {
  return (
    <section className="dash-section">
      <article className="mship-locked-card">
        <div className="mship-locked-card__head">
          <strong>Foto e video</strong>
          <span>{event.title}</span>
        </div>
        <div aria-hidden="true" className="mship-locked-card__ph">
          <i />
          <i />
          <i />
        </div>
        <MemberLockedNote access={access} kind="foto" />
      </article>
    </section>
  );
}

function LiveActivityCard({ stakeId, event }: { stakeId: string; event: Event }) {
  const { canUpload, uid } = useGalleryAccess(stakeId);
  const navigate = useNavigate();
  const { pickMedia } = useUploadApi();
  const { gallery, uploadOpen } = useActivityGallery(stakeId, event, true);
  const [latest, setLatest] = useState<GalleryMedia[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const galleryId = gallery?.id ?? "";
  const uploadContext = `${uid}:${stakeId}:${event.id}:${galleryId}:${canUpload}:${uploadOpen}`;
  const uploadContextRef = useRef(uploadContext);
  uploadContextRef.current = uploadContext;
  const pickerContext = useRef<string | null>(null);

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
    if (!gallery || !canUpload || !isGalleryUploadOpen(event, gallery) || !navigator.onLine || pickerContext.current !== uploadContextRef.current || files.length === 0) return;
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
          {canUpload && uploadOpen ? (
            <button
              type="button"
              className="ag-btn ag-btn--amber"
              onClick={() => { pickerContext.current = uploadContext; inputRef.current?.click(); }}
            >
              <AppIcon name="camera" />
              Aggiungi foto o video
            </button>
          ) : null}
          <Link className="ag-btn ag-btn--glass" to={href} aria-label="Vedi tutte le foto e i video">
            {canUpload && uploadOpen ? <AppIcon name="eye" /> : "Vedi tutte"}
          </Link>
        </div>
      </article>
    </section>
  );
}
