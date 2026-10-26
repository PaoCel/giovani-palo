import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { Link, useLocation } from "react-router-dom";

import "@/styles/activityGallery.css";

import { AppIcon } from "@/components/AppIcon";
import { MediaLightbox } from "@/components/feed/MediaLightbox";
import { GalleryConfirmSheet, getDeleteMediaCopy } from "@/components/gallery/GalleryConfirmSheet";
import { ReportMediaSheet } from "@/components/gallery/ReportMediaSheet";
import { GALLERIA } from "@/copy/galleria";
import { PALO } from "@/copy/palo";
import { PAROLE } from "@/copy/parole";
import { useUploadApi } from "@/app/providers/UploadManagerProvider";
import { useActivityGallery, useGalleryAccess } from "@/hooks/useActivityGallery";
import { deleteMediaFolder } from "@/services/firebase/galleryUploadService";
import { isGalleryUploadOpen } from "@/utils/galleryWindow";
import { feedService } from "@/services/firestore/feedService";
import { galleriesService } from "@/services/firestore/galleriesService";
import type { Event, GalleryMedia, HiddenGalleryMedia } from "@/types";
import { lockedMessageOf } from "@/utils/stakeMembership";
import { isConnectionError, withWriteTimeout } from "@/utils/writeTimeout";

interface ActivityGalleryProps {
  stakeId: string;
  event: Pick<Event, "id" | "startDate" | "endDate"> | null;
  /** Apre direttamente la vista dei contenuti nascosti (link della notifica). */
  initialView?: "hidden";
}

type MediaFilter = "all" | "image" | "video" | "mine" | "hidden";

const HIDDEN_REASON_LABEL: Record<HiddenGalleryMedia["hiddenReason"], string> = {
  mine: "Chi è nella foto non vuole che si veda",
  inappropriate: "Segnalato come non adatto",
  off_topic: "Segnalato come fuori tema",
};

// Gli errori dell'SDK sono in inglese: al diniego di un membro appena uscito si
// risponde con la frase del palo, agli altri con quella di rete.
function isPermissionMessage(message: string) {
  return /insufficient permissions|permission[- ]denied/iu.test(message);
}

function previewOf(item: GalleryMedia) {
  return item.type === "image"
    ? item.thumbnailUrl ?? item.optimizedUrl ?? item.storageUrl ?? ""
    : item.posterUrl ?? item.thumbnailUrl ?? "";
}

export function ActivityGallery({ stakeId, event, initialView }: ActivityGalleryProps) {
  const { isMember, canUpload, isStaff, uid, access } = useGalleryAccess(stakeId);
  const location = useLocation();
  const { pickMedia } = useUploadApi();
  const { gallery, loading: galleryLoading, error: galleryError, uploadOpen } =
    useActivityGallery(stakeId, event, isMember);

  const [media, setMedia] = useState<GalleryMedia[]>([]);
  const [mediaLoading, setMediaLoading] = useState(true);
  const [hidden, setHidden] = useState<HiddenGalleryMedia[]>([]);
  const [hiddenLoaded, setHiddenLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mediaLikes, setMediaLikes] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<MediaFilter>(initialView === "hidden" ? "hidden" : "all");
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [reporting, setReporting] = useState<GalleryMedia | null>(null);
  // "Elimina" di un contenuto nascosto: prima il foglio, mai un dialogo del browser.
  const [deletingHidden, setDeletingHidden] = useState<GalleryMedia | null>(null);
  const [deleteHiddenBusy, setDeleteHiddenBusy] = useState(false);
  const [deleteHiddenError, setDeleteHiddenError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const deletingHiddenId = deletingHidden?.id ?? null;
  // Numero del foglio: l'esito di una richiesta partita da un foglio
  // precedente non tocca quello di adesso.
  const deleteHiddenRunRef = useRef(0);

  function showDeleteHidden(item: GalleryMedia | null) {
    deleteHiddenRunRef.current += 1;
    setDeleteHiddenBusy(false);
    setDeleteHiddenError(null);
    setDeletingHidden(item);
  }

  // Il foglio "Elimina" di un nascosto vale finché quel contenuto è fra i
  // nascosti (un altro responsabile può rimetterlo o eliminarlo) e per
  // l'account che l'ha aperto.
  useEffect(() => {
    if (deletingHiddenId && !hidden.some((item) => item.id === deletingHiddenId)) {
      showDeleteHidden(null);
    }
  }, [hidden, deletingHiddenId]);

  useEffect(() => {
    showDeleteHidden(null);
  }, [uid]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const galleryId = gallery?.id ?? "";
  const uploadContext = `${uid}:${stakeId}:${event?.id ?? ""}:${galleryId}:${canUpload}:${uploadOpen}`;
  const uploadContextRef = useRef(uploadContext);
  uploadContextRef.current = uploadContext;
  const pickerContext = useRef<string | null>(null);

  useEffect(() => {
    if (!stakeId || !galleryId) {
      setMedia([]);
      setMediaLoading(false);
      return undefined;
    }
    setMedia([]);
    setMediaLoading(true);
    setError(null);
    return galleriesService.subscribeMedia(
      stakeId,
      galleryId,
      (list) => {
        setMedia(list);
        setMediaLoading(false);
      },
      (subError) => {
        const denied = (subError as { code?: string }).code === "permission-denied";
        setError(denied ? PALO.soloMembriFoto : PAROLE.erroreRete);
        // Un diniego (rimosso mentre guardava) toglie anche quello già a schermo.
        if (denied) setMedia([]);
        setMediaLoading(false);
      },
    );
  }, [stakeId, galleryId]);

  useEffect(() => {
    setHiddenLoaded(false);
    if (!stakeId || !galleryId || !uid) {
      setHidden([]);
      return undefined;
    }
    return galleriesService.subscribeHiddenMedia(
      stakeId,
      galleryId,
      isStaff ? { staff: true } : { uploadedBy: uid },
      (list) => {
        setHidden(list);
        setHiddenLoaded(true);
      },
      () => {
        setHidden([]);
        setHiddenLoaded(true);
      },
    );
  }, [stakeId, galleryId, uid, isStaff]);

  const counts = useMemo(() => {
    let images = 0;
    let videos = 0;
    let mine = 0;
    for (const item of media) {
      if (item.type === "video") videos += 1;
      else images += 1;
      if (item.uploadedBy === uid) mine += 1;
    }
    return { all: media.length, image: images, video: videos, mine, hidden: hidden.length };
  }, [media, hidden, uid]);

  // Se la vista nascosti si svuota (tutto rimesso o eliminato) si torna a Tutti.
  useEffect(() => {
    if (filter === "hidden" && hiddenLoaded && hidden.length === 0) setFilter("all");
  }, [filter, hidden.length, hiddenLoaded]);

  const visibleMedia: GalleryMedia[] = useMemo(() => {
    if (filter === "hidden") return hidden;
    if (filter === "mine") return media.filter((item) => item.uploadedBy === uid);
    if (filter === "all") return media;
    return media.filter((item) => item.type === filter);
  }, [filter, media, hidden, uid]);

  const lightboxIndex = useMemo(() => {
    if (lightboxId === null) return null;
    const index = visibleMedia.findIndex((item) => item.id === lightboxId);
    return index >= 0 ? index : null;
  }, [visibleMedia, lightboxId]);

  const isMediaLiked = useCallback(
    (mediaId: string) => mediaLikes[mediaId] === true,
    [mediaLikes],
  );

  const handleToggleMediaLike = useCallback(
    async (item: GalleryMedia) => {
      if (!stakeId || !uid) return;
      const wasLiked = mediaLikes[item.id] === true;
      try {
        if (wasLiked) {
          await feedService.unlikeMedia(stakeId, item.galleryId, item.id, uid);
        } else {
          await feedService.likeMedia(stakeId, item.galleryId, item.id, uid);
        }
        setMediaLikes((prev) => ({ ...prev, [item.id]: !wasLiked }));
      } catch (likeError) {
        console.error("Like media fallito", likeError);
      }
    },
    [stakeId, uid, mediaLikes],
  );

  const canDeleteMedia = useCallback(
    (item: GalleryMedia) => isStaff || (Boolean(uid) && item.uploadedBy === uid),
    [isStaff, uid],
  );

  const handleDeleteMedia = useCallback(
    async (item: GalleryMedia) => {
      // Il lightbox si chiude appena il contenuto sparisce dalla lista (cache
      // locale, prima del server): l'esito lo dice la galleria. Il lightbox
      // si chiude solo se mostra ancora questo contenuto, e un rifiuto del
      // server che lo rimette in lista non lo riapre sopra l'avviso.
      const closeIfShowing = () =>
        setLightboxId((current) => (current === item.id ? null : current));
      const deletion = galleriesService.deleteMedia(stakeId, item.galleryId, item.id);
      try {
        await withWriteTimeout(deletion);
      } catch (caughtError) {
        closeIfShowing();
        setNotice(isConnectionError(caughtError) ? GALLERIA.erroreRete : GALLERIA.erroreElimina);
        if (isConnectionError(caughtError)) {
          // La transazione può ancora arrivare al server dopo il timeout: i
          // file si tolgono solo quando l'ha confermata.
          void deletion
            .then(() => deleteMediaFolder(stakeId, item.galleryId, item.id))
            .catch(() => undefined);
        }
        throw caughtError;
      }
      closeIfShowing();
      await deleteMediaFolder(stakeId, item.galleryId, item.id);
    },
    [stakeId],
  );

  async function handleReport(reason: HiddenGalleryMedia["hiddenReason"]) {
    if (!reporting) return;
    await galleriesService.reportMedia(stakeId, reporting.galleryId, reporting.id, reason);
    setReporting(null);
    setLightboxId(null);
    setNotice("Grazie. L'abbiamo nascosta e un responsabile la controllerà.");
  }

  async function handleRestore(item: GalleryMedia) {
    await galleriesService.restoreHiddenMedia(stakeId, item.galleryId, item.id);
    setLightboxId(null);
  }

  async function handleConfirmDeleteHidden() {
    const item = deletingHidden;
    if (!item || deleteHiddenBusy) return;
    const run = deleteHiddenRunRef.current;
    setDeleteHiddenBusy(true);
    setDeleteHiddenError(null);
    try {
      await galleriesService.deleteHiddenMedia(stakeId, item.galleryId, item.id);
      setLightboxId((current) => (current === item.id ? null : current));
      if (run === deleteHiddenRunRef.current) showDeleteHidden(null);
    } catch (caughtError) {
      if (run === deleteHiddenRunRef.current) {
        setDeleteHiddenBusy(false);
        setDeleteHiddenError(
          isConnectionError(caughtError) ? GALLERIA.erroreRete : GALLERIA.erroreElimina,
        );
      }
    }
  }

  function onPick(changeEvent: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(changeEvent.target.files ?? []);
    changeEvent.target.value = "";
    if (gallery && canUpload && isGalleryUploadOpen(event, gallery) && navigator.onLine && pickerContext.current === uploadContextRef.current && files.length > 0) {
      pickMedia(files, gallery, media.length);
      setNotice(null);
    }
  }

  const filters: { key: MediaFilter; label: string; count: number }[] = [
    { key: "all", label: "Tutti", count: counts.all },
    { key: "image", label: "Foto", count: counts.image },
    { key: "video", label: "Video", count: counts.video },
    { key: "mine", label: "I tuoi", count: counts.mine },
  ];
  if (counts.hidden > 0) {
    filters.push({ key: "hidden", label: "Nascosti", count: counts.hidden });
  }

  const loading = galleryLoading || (Boolean(galleryId) && mediaLoading);
  const shownError =
    error ?? (galleryError && isPermissionMessage(galleryError) ? PALO.soloMembriFoto : galleryError);
  const viewingHidden = filter === "hidden";

  // Finché il documento members non arriva né contenuto né lucchetto.
  if (access === "loading") {
    return (
      <div className="ag">
        <div className="ag-masonry" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className="ag-skeleton"
              style={{ height: `${8 + (index % 3) * 4}rem` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (!isMember) {
    // Ospiti: il lucchetto più l'invito ad accedere; chi è in coda o fuori dal
    // palo ha la sua frase e nessuna lettura è partita.
    const lockedText = lockedMessageOf(access, "foto") ?? PALO.soloMembriFoto;
    return (
      <div className="ag">
        <div className="ag-empty">
          <AppIcon name="lock" />
          <p>{lockedText}</p>
          {access === "guest" ? (
            <Link
              className="ag-btn ag-btn--primary"
              to={`/login?redirect=${encodeURIComponent(`${location.pathname}${location.search}`)}`}
            >
              Accedi per vedere foto e video
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="ag">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={onPick}
      />

      <div className="ag-chips" role="tablist" aria-label="Filtro galleria">
        {filters.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={filter === tab.key}
            className={`ag-chip${filter === tab.key ? " ag-chip--on" : ""}${
              tab.key === "hidden" ? " ag-chip--warn" : ""
            }`}
            onClick={() => setFilter(tab.key)}
          >
            {tab.label}
            <small>{tab.count}</small>
          </button>
        ))}
      </div>

      {notice ? (
        <p className="ag-notice" role="status">
          {notice}
        </p>
      ) : null}

      {shownError ? (
        <div className="notice notice--warning">
          <div>
            <h3>Qualcosa non ha caricato</h3>
            <p>{shownError}</p>
          </div>
        </div>
      ) : null}

      {viewingHidden ? (
        <p className="ag-hidden-note">
          {isStaff
            ? "Nascosti dopo una segnalazione: li vedi solo tu e gli altri responsabili. Rimettili o eliminali."
            : "Questi tuoi contenuti sono stati nascosti dopo una segnalazione. Un responsabile li sta controllando."}
        </p>
      ) : null}

      {loading ? (
        <div className="ag-masonry" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className="ag-skeleton"
              style={{ height: `${8 + (index % 3) * 4}rem` }}
            />
          ))}
        </div>
      ) : !gallery && galleryError ? null : !gallery ? (
        <div className="ag-empty">
          <AppIcon name="camera" />
          <p>
            La galleria si apre all'inizio dell'attività. Da quel momento potrai
            caricare qui le tue foto e i tuoi video.
          </p>
        </div>
      ) : visibleMedia.length === 0 ? (
        <div className="ag-empty">
          <AppIcon name="camera" />
          <p>
            {counts.all === 0
              ? canUpload && uploadOpen
                ? "Ancora nessuna foto. Carica tu la prima."
                : "Nessuna foto o video in questa galleria."
              : filter === "mine"
                ? "Non hai ancora caricato niente."
                : "Nessun contenuto per questo filtro."}
          </p>
        </div>
      ) : (
        <div className="ag-masonry">
          {visibleMedia.map((item, index) => {
            const previewUrl = previewOf(item);
            const ratio =
              item.width && item.height ? `${item.width} / ${item.height}` : undefined;
            return (
              <button
                key={item.id}
                type="button"
                className="ag-tile"
                onClick={() => setLightboxId(item.id)}
                aria-label={`Apri ${item.type === "video" ? "video" : "foto"} ${index + 1}`}
              >
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={item.caption || "Foto dell'attività"}
                    loading="lazy"
                    decoding="async"
                    style={ratio ? { aspectRatio: ratio } : undefined}
                  />
                ) : (
                  <span className="ag-tile__ph" />
                )}
                {item.uploadedBy === uid && !viewingHidden ? (
                  <span className="ag-tile__mine">Tua</span>
                ) : null}
                {item.type === "video" ? (
                  <span className="ag-tile__play" aria-hidden="true">
                    <AppIcon name="play" />
                  </span>
                ) : null}
                {item.likeCount > 0 && !viewingHidden ? (
                  <span className="ag-tile__likes" aria-hidden="true">
                    <AppIcon name="heart" /> {item.likeCount}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {gallery && !viewingHidden ? (
        canUpload && uploadOpen ? (
          <button
            type="button"
            className="ag-fab"
            onClick={() => { pickerContext.current = uploadContext; inputRef.current?.click(); }}
          >
            <AppIcon name="plus" />
            Aggiungi
          </button>
        ) : (
          <p className="ag-closed">{uploadOpen ? GALLERIA.appartenenzaCaricamento : "Caricamenti chiusi per questa attività."}</p>
        )
      ) : null}

      {lightboxIndex !== null ? (
        <MediaLightbox
          media={visibleMedia}
          initialIndex={lightboxIndex}
          isMediaLiked={isMediaLiked}
          onClose={() => setLightboxId(null)}
          onToggleMediaLike={handleToggleMediaLike}
          canDeleteMedia={viewingHidden ? undefined : canDeleteMedia}
          onDeleteMedia={viewingHidden ? undefined : handleDeleteMedia}
          readOnly={viewingHidden}
          renderExtraActions={(item) => {
            if (viewingHidden) {
              const hiddenItem = item as HiddenGalleryMedia;
              return (
                <>
                  <span className="ag-hidden-reason">
                    {HIDDEN_REASON_LABEL[hiddenItem.hiddenReason]}
                  </span>
                  {isStaff ? (
                    <>
                      <button
                        type="button"
                        className="media-lightbox__download"
                        onClick={() => void handleRestore(item)}
                      >
                        Rimetti
                      </button>
                      <button
                        type="button"
                        className="media-lightbox__delete"
                        onClick={() => {
                          showDeleteHidden(item);
                        }}
                      >
                        Elimina
                      </button>
                    </>
                  ) : null}
                </>
              );
            }
            if (item.uploadedBy === uid) return null;
            return (
              <button
                type="button"
                className="media-lightbox__report"
                onClick={() => setReporting(item)}
              >
                <AppIcon name="flag" /> Segnala
              </button>
            );
          }}
        />
      ) : null}

      {deletingHidden ? (
        <GalleryConfirmSheet
          {...getDeleteMediaCopy(deletingHidden.type)}
          body={GALLERIA.eliminaCorpo}
          busy={deleteHiddenBusy}
          error={deleteHiddenError}
          onCancel={() => showDeleteHidden(null)}
          onConfirm={() => void handleConfirmDeleteHidden()}
        />
      ) : null}

      {reporting ? (
        <ReportMediaSheet
          mediaType={reporting.type}
          onCancel={() => setReporting(null)}
          onConfirm={handleReport}
        />
      ) : null}
    </div>
  );
}
