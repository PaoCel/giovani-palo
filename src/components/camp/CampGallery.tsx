import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import { MediaLightbox } from "@/components/feed/MediaLightbox";
import { useAuth } from "@/hooks/useAuth";
import { useGalleryUploader } from "@/components/admin/gallery/useGalleryUploader";
import { deleteMediaPath } from "@/services/firebase/galleryUploadService";
import { feedService } from "@/services/firestore/feedService";
import { galleriesService } from "@/services/firestore/galleriesService";
import type { Gallery, GalleryMedia } from "@/types";

interface CampGalleryProps {
  stakeId: string;
  eventId: string;
}

type MediaFilter = "all" | "image" | "video";

export function CampGallery({ stakeId, eventId }: CampGalleryProps) {
  const { session } = useAuth();
  const uid = session?.firebaseUser.uid ?? "";
  const isAdmin = Boolean(session?.isAdmin);

  const [gallery, setGallery] = useState<Gallery | null>(null);
  const [media, setMedia] = useState<GalleryMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mediaLikes, setMediaLikes] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<MediaFilter>("all");
  const [lightboxId, setLightboxId] = useState<string | null>(null);

  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  // Sottoscrizione cache-first alla galleria dell'attività: prima emissione
  // istantanea dalla cache, poi il server aggiorna. Niente più attese infinite.
  useEffect(() => {
    if (!stakeId || !eventId) {
      setLoading(false);
      return;
    }
    setError(null);
    const unsubscribe = galleriesService.subscribeGalleryByActivity(
      stakeId,
      eventId,
      (found) => {
        setGallery(found);
        if (!found) {
          setMedia([]);
          setLoading(false);
        }
      },
      (subError) => {
        setError(subError.message || "Impossibile caricare la galleria.");
        setLoading(false);
      },
    );
    return unsubscribe;
  }, [stakeId, eventId]);

  const galleryId = gallery?.id ?? "";

  // Sottoscrizione cache-first ai media: live per tutti (i nuovi upload
  // compaiono da soli) e istantanea dalla cache.
  useEffect(() => {
    if (!stakeId || !galleryId) return;
    const unsubscribe = galleriesService.subscribeMedia(
      stakeId,
      galleryId,
      (list) => {
        setMedia(list);
        setLoading(false);
      },
      (subError) => {
        setError(subError.message || "Impossibile caricare i contenuti.");
        setLoading(false);
      },
    );
    return unsubscribe;
  }, [stakeId, galleryId]);

  const handleUploaded = useCallback((created: GalleryMedia) => {
    // Feedback immediato; la sottoscrizione riconcilia subito dopo.
    setMedia((prev) => {
      if (prev.some((entry) => entry.id === created.id)) return prev;
      return [...prev, created];
    });
  }, []);

  const {
    queue,
    pickerError,
    pickPhotos,
    pickVideo,
    cancel,
    retry,
    remove,
  } = useGalleryUploader({
    gallery,
    uploadedBy: uid,
    startOrder: media.length,
    onUploaded: handleUploaded,
  });

  const counts = useMemo(() => {
    let images = 0;
    let videos = 0;
    for (const item of media) {
      if (item.type === "video") videos += 1;
      else images += 1;
    }
    return { all: media.length, image: images, video: videos };
  }, [media]);

  const sortedMedia = media; // già ordinati dalla sottoscrizione

  const filteredMedia = useMemo(
    () =>
      filter === "all"
        ? sortedMedia
        : sortedMedia.filter((item) => item.type === filter),
    [sortedMedia, filter],
  );

  const lightboxIndex = useMemo(() => {
    if (lightboxId === null) return null;
    const idx = filteredMedia.findIndex((item) => item.id === lightboxId);
    return idx >= 0 ? idx : null;
  }, [filteredMedia, lightboxId]);

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
    (item: GalleryMedia) => isAdmin || (Boolean(uid) && item.uploadedBy === uid),
    [isAdmin, uid],
  );

  const handleDeleteMedia = useCallback(
    async (item: GalleryMedia) => {
      await galleriesService.deleteMedia(stakeId, item.galleryId, item.id);
      await deleteMediaPath(
        `protected/stakes/${stakeId}/galleries/${item.galleryId}/media/${item.id}/`,
      ).catch(() => undefined);
      // La sottoscrizione aggiornerà la lista; togliamo subito per reattività.
      setMedia((prev) => prev.filter((entry) => entry.id !== item.id));
    },
    [stakeId],
  );

  function onPhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    pickPhotos(files);
  }

  function onVideoChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    pickVideo(files);
  }

  const activeQueue = queue.filter((item) => item.status !== "done");

  const filters: { key: MediaFilter; label: string; count: number }[] = [
    { key: "all", label: "Tutti", count: counts.all },
    { key: "image", label: "Foto", count: counts.image },
    { key: "video", label: "Video", count: counts.video },
  ];

  return (
    <div className="camp-gallery">
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={onPhotoChange}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        multiple
        hidden
        onChange={onVideoChange}
      />

      <div className="camp-gallery__toolbar">
        <div className="camp-filter-scroll" role="tablist" aria-label="Filtro galleria">
          {filters.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={filter === tab.key}
              className={`camp-chip${filter === tab.key ? " camp-chip--active" : ""}`}
              onClick={() => setFilter(tab.key)}
            >
              {tab.label}
              <span className="camp-chip__count">{tab.count}</span>
            </button>
          ))}
        </div>

        <div className="camp-gallery__upload">
          <button
            type="button"
            className="camp-upload-btn"
            onClick={() => photoInputRef.current?.click()}
          >
            <span aria-hidden="true">＋</span> Foto
          </button>
          <button
            type="button"
            className="camp-upload-btn camp-upload-btn--ghost"
            onClick={() => videoInputRef.current?.click()}
          >
            <span aria-hidden="true">＋</span> Video
          </button>
        </div>
      </div>

      {pickerError ? <p className="field-error">{pickerError}</p> : null}
      {error ? (
        <div className="notice notice--warning">
          <div>
            <h3>Qualcosa non ha caricato</h3>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="camp-masonry" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className="camp-skeleton"
              style={{ height: `${8 + (index % 3) * 4}rem` }}
            />
          ))}
        </div>
      ) : !gallery ? (
        <div className="camp-empty">
          <span className="camp-empty__emoji" aria-hidden="true">📷</span>
          <p>
            La galleria del campeggio non è ancora stata aperta. Appena un
            responsabile la crea, potrai caricare qui le tue foto e i tuoi video.
          </p>
        </div>
      ) : activeQueue.length === 0 && filteredMedia.length === 0 ? (
        <div className="camp-empty">
          <span className="camp-empty__emoji" aria-hidden="true">🏕️</span>
          <p>
            {counts.all === 0
              ? "Ancora nessun ricordo. Carica tu la prima foto o il primo video del campeggio!"
              : "Nessun contenuto per questo filtro."}
          </p>
        </div>
      ) : (
        <div className="camp-masonry">
          {activeQueue.map((item) => (
            <div
              key={item.id}
              className={`camp-masonry__item camp-masonry__item--upload is-${item.status}`}
            >
              {item.previewUrl ? (
                <img src={item.previewUrl} alt="" />
              ) : (
                <div className="camp-masonry__ph">{item.mode === "video" ? "▶" : "◇"}</div>
              )}
              <div className="camp-upload-overlay">
                {item.status === "error" || item.status === "cancelled" ? (
                  <div className="camp-upload-overlay__error">
                    <span>{item.status === "error" ? "Errore" : "Annullato"}</span>
                    <div className="camp-upload-overlay__actions">
                      <button type="button" onClick={() => retry(item.id)} aria-label="Riprova">↻</button>
                      <button type="button" onClick={() => remove(item.id)} aria-label="Rimuovi">×</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="camp-upload-overlay__ring">{item.progress}%</div>
                    <button
                      type="button"
                      className="camp-upload-overlay__cancel"
                      onClick={() => cancel(item.id)}
                      aria-label="Annulla upload"
                    >
                      ×
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}

          {filteredMedia.map((item, index) => {
            const previewUrl =
              item.type === "image"
                ? item.thumbnailUrl ?? item.optimizedUrl ?? item.storageUrl ?? ""
                : item.posterUrl ?? item.thumbnailUrl ?? "";
            const ratio =
              item.width && item.height ? `${item.width} / ${item.height}` : undefined;
            return (
              <button
                key={item.id}
                type="button"
                className="camp-masonry__item"
                onClick={() => setLightboxId(item.id)}
                aria-label={`Apri ${item.type === "video" ? "video" : "foto"} ${index + 1}`}
              >
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={item.caption || item.filename || "Ricordo del campeggio"}
                    loading="lazy"
                    decoding="async"
                    style={ratio ? { aspectRatio: ratio } : undefined}
                  />
                ) : (
                  <div className="camp-masonry__ph">{item.type === "video" ? "▶" : "◇"}</div>
                )}
                {item.type === "video" ? (
                  <span className="camp-masonry__play" aria-hidden="true">▶</span>
                ) : null}
                {item.likeCount > 0 ? (
                  <span className="camp-masonry__likes" aria-hidden="true">♥ {item.likeCount}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {lightboxIndex !== null ? (
        <MediaLightbox
          media={filteredMedia}
          initialIndex={lightboxIndex}
          isMediaLiked={isMediaLiked}
          onClose={() => setLightboxId(null)}
          onToggleMediaLike={handleToggleMediaLike}
          canDeleteMedia={canDeleteMedia}
          onDeleteMedia={handleDeleteMedia}
        />
      ) : null}
    </div>
  );
}
