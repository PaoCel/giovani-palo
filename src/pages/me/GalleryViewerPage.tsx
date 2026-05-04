import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { LikeButton } from "@/components/LikeButton";
import { PageHero } from "@/components/PageHero";
import { PolaroidLightbox } from "@/components/PolaroidLightbox";
import { SectionCard } from "@/components/SectionCard";
import { useAuth } from "@/hooks/useAuth";
import {
  galleriesService,
  type GalleryDoc,
  type GalleryMedia,
} from "@/services/firestore/galleriesService";

const STAKE_ID = "roma-est";

export function GalleryViewerPage() {
  const { galleryId } = useParams<{ galleryId: string }>();
  const { session } = useAuth();
  const [gallery, setGallery] = useState<GalleryDoc | null>(null);
  const [hasMembership, setHasMembership] = useState(false);
  const [media, setMedia] = useState<GalleryMedia[]>([]);
  const [likedSet, setLikedSet] = useState<Set<string>>(new Set());
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [busyMediaId, setBusyMediaId] = useState<string | null>(null);

  useEffect(() => {
    if (!galleryId || !session) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      galleriesService.getGallery(STAKE_ID, galleryId),
      galleriesService.hasMembership(STAKE_ID, galleryId, session.firebaseUser.uid),
    ])
      .then(async ([galleryData, membership]) => {
        if (cancelled) return;
        setGallery(galleryData);
        setHasMembership(membership);
        if (membership) {
          const list = await galleriesService.listMedia(STAKE_ID, galleryId);
          if (cancelled) return;
          setMedia(list);
          const liked = await galleriesService.listLikedMediaIds(
            STAKE_ID,
            galleryId,
            list.map((item) => item.id),
            session.firebaseUser.uid,
          );
          if (!cancelled) setLikedSet(liked);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Errore caricamento galleria.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [galleryId, session]);

  async function tryUnlock() {
    if (!galleryId || !session) return;
    if (!code.trim()) {
      setError("Inserisci il codice della galleria.");
      return;
    }
    setUnlocking(true);
    setError(null);
    try {
      await galleriesService.unlockWithCode(STAKE_ID, galleryId, code);
      setHasMembership(true);
      const list = await galleriesService.listMedia(STAKE_ID, galleryId);
      setMedia(list);
      const liked = await galleriesService.listLikedMediaIds(
        STAKE_ID,
        galleryId,
        list.map((item) => item.id),
        session.firebaseUser.uid,
      );
      setLikedSet(liked);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Codice non valido.");
    } finally {
      setUnlocking(false);
    }
  }

  async function toggleMediaLike(item: GalleryMedia) {
    if (!session || !galleryId) return;
    setBusyMediaId(item.id);
    try {
      const result = await galleriesService.toggleMediaLike(
        STAKE_ID,
        galleryId,
        item.id,
        session.firebaseUser.uid,
      );
      setMedia((current) =>
        current.map((entry) =>
          entry.id === item.id ? { ...entry, likeCount: result.likeCount } : entry,
        ),
      );
      setLikedSet((current) => {
        const next = new Set(current);
        if (result.liked) next.add(item.id);
        else next.delete(item.id);
        return next;
      });
    } catch {
      // silent
    } finally {
      setBusyMediaId(null);
    }
  }

  const sortedMedia = useMemo(
    () => [...media].sort((left, right) => left.order - right.order),
    [media],
  );

  return (
    <div className="page-content">
      <PageHero
        eyebrow="Galleria"
        title={gallery?.title ?? "Galleria foto e video"}
        description={gallery?.description ?? undefined}
      />

      {loading ? <p className="subtle-text">Caricamento...</p> : null}
      {error ? <p className="field-error">{error}</p> : null}

      {!loading && !gallery ? (
        <SectionCard title="Galleria non trovata">
          <Link className="button button--ghost" to="/me">
            Torna alla dashboard
          </Link>
        </SectionCard>
      ) : null}

      {!loading && gallery && !hasMembership ? (
        <SectionCard
          title="Inserisci il codice di accesso"
          description="Chiedi il codice all'organizzatore."
        >
          <div className="form-stack form-stack--compact">
            <label className="field">
              <span className="field__label">Codice</span>
              <input
                className="input"
                type="text"
                value={code}
                placeholder="Codice galleria"
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
            <button
              className="button button--primary"
              type="button"
              disabled={unlocking}
              onClick={tryUnlock}
            >
              {unlocking ? "Verifica..." : "Sblocca galleria"}
            </button>
          </div>
        </SectionCard>
      ) : null}

      {!loading && hasMembership ? (
        <SectionCard title={`${sortedMedia.length} elementi`}>
          {sortedMedia.length === 0 ? (
            <p className="subtle-text">Galleria vuota.</p>
          ) : (
            <div className="gallery-grid">
              {sortedMedia.map((item, index) => {
                const thumb =
                  item.thumbnailUrl ?? item.optimizedUrl ?? item.posterUrl ?? item.storageUrl ?? "";
                const liked = likedSet.has(item.id);
                return (
                  <div key={item.id} className="gallery-tile-wrapper">
                    <button
                      type="button"
                      className="gallery-tile gallery-tile--button"
                      onClick={() => setActiveIndex(index)}
                    >
                      {thumb ? <img src={thumb} alt={item.filename} loading="lazy" /> : null}
                      {item.type === "video" ? (
                        <span className="post-carousel__video-badge">▶</span>
                      ) : null}
                    </button>
                    <div className="gallery-tile__like">
                      <LikeButton
                        liked={liked}
                        count={item.likeCount}
                        busy={busyMediaId === item.id}
                        size="small"
                        onToggle={() => toggleMediaLike(item)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>
      ) : null}

      {activeIndex !== null && galleryId ? (
        <PolaroidLightbox
          stakeId={STAKE_ID}
          galleryId={galleryId}
          media={sortedMedia}
          initialIndex={activeIndex}
          onClose={() => setActiveIndex(null)}
          onLikeChange={(mediaId, liked, count) => {
            setMedia((current) =>
              current.map((entry) =>
                entry.id === mediaId ? { ...entry, likeCount: count } : entry,
              ),
            );
            setLikedSet((current) => {
              const next = new Set(current);
              if (liked) next.add(mediaId);
              else next.delete(mediaId);
              return next;
            });
          }}
        />
      ) : null}
    </div>
  );
}
