import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { EmptyState } from "@/components/EmptyState";
import { PageHero } from "@/components/PageHero";
import { GalleryUnlockForm } from "@/components/feed/GalleryUnlockForm";
import { MediaLightbox } from "@/components/feed/MediaLightbox";
import { useAuth } from "@/hooks/useAuth";
import { feedService } from "@/services/firestore/feedService";
import { galleriesService } from "@/services/firestore/galleriesService";
import { galleryUnlockService } from "@/services/firestore/galleryUnlockService";
import type { Gallery, GalleryMedia } from "@/types";

export function MyActivityGalleryPage() {
  const { eventId } = useParams();
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId ?? "";
  const uid = session?.firebaseUser.uid ?? "";

  const [gallery, setGallery] = useState<Gallery | null>(null);
  const [media, setMedia] = useState<GalleryMedia[]>([]);
  const [unlocked, setUnlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mediaLikes, setMediaLikes] = useState<Record<string, boolean>>({});
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!stakeId || !uid || !eventId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const found = await galleriesService.getGalleryByActivity(stakeId, eventId);
      if (!found) {
        setGallery(null);
        setUnlocked(false);
        setMedia([]);
        return;
      }
      setGallery(found);
      const unlockedRefs = await galleriesService.listUnlockedForUser(uid);
      const isUnlocked = unlockedRefs.some(
        (entry) => entry.stakeId === stakeId && entry.galleryId === found.id,
      );
      setUnlocked(isUnlocked);
      if (isUnlocked) {
        const list = await galleriesService.listMedia(stakeId, found.id);
        setMedia(list);
      } else {
        setMedia([]);
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossibile caricare la galleria.",
      );
    } finally {
      setLoading(false);
    }
  }, [stakeId, uid, eventId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleUnlock = useCallback(
    async (code: string) => {
      if (!stakeId || !gallery) {
        return { success: false, message: "Galleria non disponibile." };
      }
      const result = await galleryUnlockService.unlock({
        stakeId,
        galleryId: gallery.id,
        code,
      });
      if (!result.success) {
        return { success: false, message: result.message ?? "Codice non valido." };
      }
      setUnlocked(true);
      const list = await galleriesService.listMedia(stakeId, gallery.id).catch(() => []);
      setMedia(list);
      return { success: true };
    },
    [stakeId, gallery],
  );

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

  const heroTitle = useMemo(() => {
    if (gallery?.title) return gallery.title;
    return "Galleria attività";
  }, [gallery]);

  if (loading) {
    return (
      <div className="page">
        <PageHero className="hero--compact" eyebrow="Galleria" title="Caricamento..." />
        <p className="subtle-text">Carico la galleria…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <PageHero className="hero--compact" eyebrow="Galleria" title="Errore" />
        <div className="notice notice--warning">
          <div>
            <h3>Impossibile caricare la galleria</h3>
            <p>{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!gallery) {
    return (
      <div className="page">
        <EmptyState
          title="Nessuna galleria disponibile"
          description="Per questa attività non è ancora stata pubblicata una galleria."
          action={
            <Link className="button button--primary" to={`/me/activities/${eventId}`}>
              Torna all'attività
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHero
        className="hero--compact"
        eyebrow="Galleria"
        title={heroTitle}
        description={gallery.description || undefined}
        actions={
          <Link className="button button--ghost" to={`/me/activities/${eventId}`}>
            Torna all'attività
          </Link>
        }
      />

      {!unlocked ? (
        <div className="card">
          <p className="subtle-text">
            Inserisci il codice ricevuto dai responsabili per vedere foto e video.
          </p>
          <GalleryUnlockForm onUnlock={handleUnlock} />
        </div>
      ) : media.length === 0 ? (
        <p className="subtle-text">
          La galleria è stata sbloccata, ma non ci sono ancora media pubblicati.
        </p>
      ) : (
        <div className="gallery-carousel" role="list">
          {media.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className="gallery-carousel__item"
              onClick={() => setLightboxIndex(index)}
              role="listitem"
              aria-label={`Apri ${item.type === "video" ? "video" : "foto"} ${index + 1} di ${media.length}`}
            >
              {item.type === "image" ? (
                <img
                  src={item.thumbnailUrl ?? item.optimizedUrl ?? item.storageUrl ?? ""}
                  alt={item.caption || `Foto ${index + 1}`}
                  loading="lazy"
                />
              ) : (
                <>
                  <img
                    src={item.posterUrl ?? item.thumbnailUrl ?? ""}
                    alt={item.caption || `Video ${index + 1}`}
                    loading="lazy"
                  />
                  <span className="gallery-carousel__play" aria-hidden="true">▶</span>
                </>
              )}
            </button>
          ))}
        </div>
      )}

      {lightboxIndex !== null ? (
        <MediaLightbox
          media={media}
          initialIndex={lightboxIndex}
          isMediaLiked={isMediaLiked}
          onClose={() => setLightboxIndex(null)}
          onToggleMediaLike={handleToggleMediaLike}
        />
      ) : null}
    </div>
  );
}
