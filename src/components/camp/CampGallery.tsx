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

  const refresh = useCallback(async () => {
    if (!stakeId || !eventId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const found = await galleriesService.getGalleryByActivity(stakeId, eventId);
      if (!found) {
        setGallery(null);
        setMedia([]);
        return;
      }
      setGallery(found);
      const list = await galleriesService.listMedia(stakeId, found.id);
      setMedia(list);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile caricare la galleria.",
      );
    } finally {
      setLoading(false);
    }
  }, [stakeId, eventId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleUploaded = useCallback((created: GalleryMedia) => {
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

  const sortedMedia = useMemo(
    () => [...media].sort((a, b) => a.order - b.order),
    [media],
  );

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
        setMedia((prev) =>
          prev.map((entry) =>
            entry.id === item.id
              ? {
                  ...entry,
                  likeCount: Math.max(0, entry.likeCount + (wasLiked ? -1 : 1)),
                }
              : entry,
          ),
        );
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
      // Pulizia binari best-effort (per i non-admin le rules storage negano la
      // delete: eventuali orfani li rimuove poi l'admin). Non blocca la UI.
      await deleteMediaPath(
        `protected/stakes/${stakeId}/galleries/${item.galleryId}/media/${item.id}/`,
      ).catch(() => undefined);
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

  if (loading) {
    return <p className="subtle-text">Carico la galleria…</p>;
  }

  if (error) {
    return (
      <div className="notice notice--warning">
        <div>
          <h3>Impossibile caricare la galleria</h3>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!gallery) {
    return (
      <div className="camp-gallery">
        <p className="subtle-text">
          La galleria del campeggio non è ancora stata aperta. Appena un
          responsabile la crea, potrai caricare qui foto e video.
        </p>
      </div>
    );
  }

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
        <div className="camp-gallery__upload">
          <button
            type="button"
            className="button button--primary button--small"
            onClick={() => photoInputRef.current?.click()}
          >
            + Foto
          </button>
          <button
            type="button"
            className="button button--soft button--small"
            onClick={() => videoInputRef.current?.click()}
          >
            + Video
          </button>
          <span className="subtle-text camp-gallery__upload-hint">
            Tutti possono aggiungere i propri ricordi.
          </span>
        </div>

        <div className="camp-filter-row" role="tablist" aria-label="Filtro galleria">
          {(
            [
              { key: "all", label: "Tutti", count: counts.all },
              { key: "image", label: "Foto", count: counts.image },
              { key: "video", label: "Video", count: counts.video },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={filter === tab.key}
              className={`camp-filter-chip${filter === tab.key ? " camp-filter-chip--active" : ""}`}
              onClick={() => setFilter(tab.key)}
            >
              {tab.label} {tab.count > 0 ? <span>({tab.count})</span> : null}
            </button>
          ))}
        </div>
      </div>

      {pickerError ? <p className="field-error">{pickerError}</p> : null}

      {activeQueue.length === 0 && filteredMedia.length === 0 ? (
        <p className="subtle-text">
          {counts.all === 0
            ? "Ancora nessun contenuto. Carica tu la prima foto o il primo video!"
            : "Nessun contenuto per questo filtro."}
        </p>
      ) : (
        <div className="gallery-tiles">
          {activeQueue.map((item) => (
            <div
              key={item.id}
              className={`gallery-tile gallery-tile--upload gallery-tile--upload-${item.status}`}
            >
              {item.previewUrl ? (
                <img src={item.previewUrl} alt="" />
              ) : (
                <div className="gallery-tile__placeholder">
                  {item.mode === "video" ? "▶" : "◇"}
                </div>
              )}
              <div className="gallery-tile__overlay">
                {item.status === "error" || item.status === "cancelled" ? (
                  <div className="gallery-tile__error">
                    <span>{item.status === "error" ? "Errore" : "Annullato"}</span>
                    <div className="gallery-tile__error-actions">
                      <button
                        type="button"
                        className="gallery-tile__icon-btn"
                        onClick={() => retry(item.id)}
                        aria-label="Riprova"
                      >
                        ↻
                      </button>
                      <button
                        type="button"
                        className="gallery-tile__icon-btn"
                        onClick={() => remove(item.id)}
                        aria-label="Rimuovi"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="gallery-tile__progress-ring">
                      <span>{item.progress}%</span>
                    </div>
                    <button
                      type="button"
                      className="gallery-tile__icon-btn gallery-tile__icon-btn--top-right"
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
            return (
              <button
                key={item.id}
                type="button"
                className="gallery-tile"
                onClick={() => setLightboxId(item.id)}
                aria-label={`Apri ${item.type === "video" ? "video" : "foto"} ${index + 1}`}
              >
                {previewUrl ? (
                  <img src={previewUrl} alt={item.caption || item.filename || "Media"} loading="lazy" />
                ) : (
                  <div className="gallery-tile__placeholder">
                    {item.type === "video" ? "▶" : "◇"}
                  </div>
                )}
                {item.type === "video" ? (
                  <span className="gallery-tile__badge">▶</span>
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
