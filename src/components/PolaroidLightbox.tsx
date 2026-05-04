import { useEffect, useState } from "react";

import { LikeButton } from "@/components/LikeButton";
import { useAuth } from "@/hooks/useAuth";
import {
  galleriesService,
  type GalleryMedia,
} from "@/services/firestore/galleriesService";

interface PolaroidLightboxProps {
  stakeId: string;
  galleryId: string;
  media: GalleryMedia[];
  initialIndex: number;
  onClose: () => void;
  onLikeChange?: (mediaId: string, liked: boolean, count: number) => void;
}

export function PolaroidLightbox({
  stakeId,
  galleryId,
  media,
  initialIndex,
  onClose,
  onLikeChange,
}: PolaroidLightboxProps) {
  const { session } = useAuth();
  const [index, setIndex] = useState(initialIndex);
  const [likedMap, setLikedMap] = useState<Record<string, boolean>>({});
  const [countMap, setCountMap] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setIndex(initialIndex);
  }, [initialIndex]);

  useEffect(() => {
    const counts: Record<string, number> = {};
    media.forEach((item) => {
      counts[item.id] = item.likeCount;
    });
    setCountMap(counts);
  }, [media]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    galleriesService
      .listLikedMediaIds(
        stakeId,
        galleryId,
        media.map((item) => item.id),
        session.firebaseUser.uid,
      )
      .then((set) => {
        if (cancelled) return;
        const next: Record<string, boolean> = {};
        set.forEach((id) => {
          next[id] = true;
        });
        setLikedMap(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [galleryId, media, session, stakeId]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") {
        setIndex((current) => Math.min(media.length - 1, current + 1));
      }
      if (event.key === "ArrowLeft") {
        setIndex((current) => Math.max(0, current - 1));
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [media.length, onClose]);

  if (media.length === 0) return null;

  const current = media[index];
  if (!current) return null;
  const liked = likedMap[current.id] === true;
  const count = countMap[current.id] ?? 0;
  const src =
    current.originalUrl ?? current.optimizedUrl ?? current.storageUrl ?? "";

  async function toggle() {
    if (!session || busy) return;
    setBusy(true);
    try {
      const result = await galleriesService.toggleMediaLike(
        stakeId,
        galleryId,
        current.id,
        session.firebaseUser.uid,
      );
      setLikedMap((map) => ({ ...map, [current.id]: result.liked }));
      setCountMap((map) => ({ ...map, [current.id]: result.likeCount }));
      onLikeChange?.(current.id, result.liked, result.likeCount);
    } catch {
      // silent
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="polaroid-lightbox"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <button
        type="button"
        className="polaroid-lightbox__close"
        aria-label="Chiudi"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
      >
        ×
      </button>

      <button
        type="button"
        className="polaroid-lightbox__nav polaroid-lightbox__nav--prev"
        aria-label="Precedente"
        disabled={index === 0}
        onClick={(event) => {
          event.stopPropagation();
          setIndex((current) => Math.max(0, current - 1));
        }}
      >
        ‹
      </button>

      <div
        className="polaroid"
        onClick={(event) => event.stopPropagation()}
        style={{ ["--polaroid-rotation" as string]: `${(index % 5) - 2}deg` }}
      >
        <div className="polaroid__photo">
          {current.type === "video" ? (
            <video src={src} controls autoPlay playsInline />
          ) : (
            <img src={src} alt={current.filename} />
          )}
        </div>
        <div className="polaroid__caption">
          <div className="polaroid__caption-text">
            {current.caption || current.filename}
          </div>
          <LikeButton
            liked={liked}
            count={count}
            busy={busy}
            size="small"
            onToggle={toggle}
          />
        </div>
        <div className="polaroid__counter">
          {index + 1} / {media.length}
        </div>
      </div>

      <button
        type="button"
        className="polaroid-lightbox__nav polaroid-lightbox__nav--next"
        aria-label="Successivo"
        disabled={index === media.length - 1}
        onClick={(event) => {
          event.stopPropagation();
          setIndex((current) => Math.min(media.length - 1, current + 1));
        }}
      >
        ›
      </button>
    </div>
  );
}
