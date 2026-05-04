import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { LikeButton } from "@/components/feed/LikeButton";
import { useAuth } from "@/hooks/useAuth";
import { galleryCommentsService } from "@/services/firestore/galleryCommentsService";
import type { GalleryComment, GalleryMedia } from "@/types";

interface MediaLightboxProps {
  media: GalleryMedia[];
  initialIndex: number;
  isMediaLiked: (mediaId: string) => boolean;
  onClose: () => void;
  onToggleMediaLike: (media: GalleryMedia) => Promise<void>;
}

const SWIPE_THRESHOLD = 50;
const SWIPE_VERTICAL_TOLERANCE = 80;

function getDisplayName(
  session: ReturnType<typeof useAuth>["session"],
): string {
  if (!session) return "Utente";
  const fullName = session.profile.fullName?.trim();
  if (fullName && fullName !== "Partecipante" && fullName !== "Ospite anonimo") {
    return fullName;
  }
  const displayName = session.firebaseUser.displayName?.trim();
  if (displayName) return displayName;
  const email = session.firebaseUser.email || session.profile.email;
  if (email) return email.split("@")[0];
  return "Utente";
}

function formatCommentTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("it-IT", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function MediaLightbox({
  media,
  initialIndex,
  isMediaLiked,
  onClose,
  onToggleMediaLike,
}: MediaLightboxProps) {
  const { session } = useAuth();
  const [index, setIndex] = useState(initialIndex);
  const [comments, setComments] = useState<Record<string, GalleryComment[]>>({});
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentInput, setCommentInput] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [slideDirection, setSlideDirection] = useState<"left" | "right" | null>(null);

  const current = media[index];

  const goNext = useCallback(() => {
    setIndex((value) => {
      if (value >= media.length - 1) return value;
      setSlideDirection("left");
      window.setTimeout(() => setSlideDirection(null), 220);
      return value + 1;
    });
  }, [media.length]);

  const goPrev = useCallback(() => {
    setIndex((value) => {
      if (value <= 0) return value;
      setSlideDirection("right");
      window.setTimeout(() => setSlideDirection(null), 220);
      return value - 1;
    });
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") goNext();
      if (event.key === "ArrowLeft") goPrev();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [goNext, goPrev, onClose]);

  useEffect(() => {
    if (!current) return;
    if (comments[current.id]) return;
    let active = true;
    setLoadingComments(true);
    galleryCommentsService
      .list(current.stakeId, current.galleryId, current.id)
      .then((list) => {
        if (!active) return;
        setComments((prev) => ({ ...prev, [current.id]: list }));
      })
      .catch(() => {
        if (!active) return;
        setComments((prev) => ({ ...prev, [current.id]: [] }));
      })
      .finally(() => {
        if (active) setLoadingComments(false);
      });
    return () => {
      active = false;
    };
  }, [current, comments]);

  const touchStart = useRef<{ x: number; y: number } | null>(null);

  function handleTouchStart(event: React.TouchEvent) {
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  }

  function handleTouchEnd(event: React.TouchEvent) {
    const start = touchStart.current;
    if (!start) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_VERTICAL_TOLERANCE) {
      if (dx < 0) goNext();
      else goPrev();
    }
    touchStart.current = null;
  }

  async function handleSubmitComment(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    if (!current || !session) return;
    const text = commentInput.trim();
    if (!text) return;
    setSubmittingComment(true);
    setCommentError(null);
    try {
      const created = await galleryCommentsService.add({
        stakeId: current.stakeId,
        galleryId: current.galleryId,
        mediaId: current.id,
        uid: session.firebaseUser.uid,
        displayName: getDisplayName(session),
        body: text,
      });
      setComments((prev) => ({
        ...prev,
        [current.id]: [...(prev[current.id] ?? []), created],
      }));
      setCommentInput("");
    } catch (caughtError) {
      setCommentError(
        caughtError instanceof Error ? caughtError.message : "Errore invio commento.",
      );
    } finally {
      setSubmittingComment(false);
    }
  }

  async function handleDeleteComment(comment: GalleryComment) {
    if (!current) return;
    if (!session) return;
    if (comment.uid !== session.firebaseUser.uid && !session.isAdmin) return;
    if (!window.confirm("Eliminare questo commento?")) return;
    try {
      await galleryCommentsService.remove(
        current.stakeId,
        current.galleryId,
        current.id,
        comment.id,
      );
      setComments((prev) => ({
        ...prev,
        [current.id]: (prev[current.id] ?? []).filter((entry) => entry.id !== comment.id),
      }));
    } catch (caughtError) {
      setCommentError(
        caughtError instanceof Error ? caughtError.message : "Errore eliminazione.",
      );
    }
  }

  if (!current) return null;

  const currentComments = comments[current.id] ?? [];
  const isLast = index === media.length - 1;
  const isFirst = index === 0;

  return (
    <div className="media-lightbox" role="dialog" aria-modal="true">
      <button
        type="button"
        className="media-lightbox__close"
        onClick={onClose}
        aria-label="Chiudi"
      >
        ×
      </button>

      <div
        className="media-lightbox__scroll"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <article
          className={`polaroid${slideDirection ? ` polaroid--slide-${slideDirection}` : ""}`}
          key={current.id}
        >
          <div className="polaroid__media">
            {current.type === "image" ? (
              <img
                src={
                  current.optimizedUrl ??
                  current.storageUrl ??
                  current.thumbnailUrl ??
                  ""
                }
                alt={current.caption || "Foto"}
                draggable={false}
              />
            ) : (
              <video
                controls
                preload="none"
                poster={current.posterUrl ?? current.thumbnailUrl ?? undefined}
                src={current.storageUrl ?? current.optimizedUrl ?? ""}
              />
            )}
          </div>
          <div className="polaroid__caption">
            {current.caption ? (
              <span>{current.caption}</span>
            ) : (
              <span className="polaroid__caption-meta">
                {index + 1} / {media.length}
              </span>
            )}
          </div>
        </article>

        <div className="media-lightbox__bar">
          <LikeButton
            liked={isMediaLiked(current.id)}
            count={current.likeCount}
            onToggle={() => onToggleMediaLike(current)}
            ariaLabel="Like alla foto/video"
          />
          <span className="media-lightbox__counter">
            {index + 1} / {media.length}
          </span>
        </div>

        <section className="media-comments">
          <header className="media-comments__head">
            <h4>Commenti</h4>
            <span className="subtle-text">{currentComments.length}</span>
          </header>

          {loadingComments && currentComments.length === 0 ? (
            <p className="subtle-text">Sto caricando…</p>
          ) : currentComments.length === 0 ? (
            <p className="subtle-text">Nessun commento ancora. Scrivi tu il primo!</p>
          ) : (
            <ul className="media-comments__list">
              {currentComments.map((comment) => {
                const canDelete =
                  session &&
                  (comment.uid === session.firebaseUser.uid || session.isAdmin);
                return (
                  <li key={comment.id} className="media-comment">
                    <div className="media-comment__head">
                      <strong className="media-comment__author">
                        {comment.displayName}
                      </strong>
                      <time className="media-comment__time">
                        {formatCommentTime(comment.createdAt)}
                      </time>
                    </div>
                    <p className="media-comment__body">{comment.body}</p>
                    {canDelete ? (
                      <button
                        type="button"
                        className="media-comment__delete"
                        onClick={() => handleDeleteComment(comment)}
                        aria-label="Elimina commento"
                      >
                        Elimina
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          {session ? (
            <form className="media-comments__form" onSubmit={handleSubmitComment}>
              <input
                type="text"
                value={commentInput}
                onChange={(submitEvent) => setCommentInput(submitEvent.target.value)}
                placeholder="Scrivi un commento…"
                maxLength={2000}
                disabled={submittingComment}
              />
              <button
                type="submit"
                className="button button--primary button--small"
                disabled={submittingComment || commentInput.trim().length === 0}
              >
                {submittingComment ? "Invio…" : "Invia"}
              </button>
            </form>
          ) : (
            <p className="subtle-text">Accedi per scrivere un commento.</p>
          )}

          {commentError ? <p className="form-error">{commentError}</p> : null}
        </section>
      </div>

      <button
        type="button"
        className="media-lightbox__nav media-lightbox__nav--prev"
        onClick={goPrev}
        disabled={isFirst}
        aria-label="Precedente"
      >
        ‹
      </button>
      <button
        type="button"
        className="media-lightbox__nav media-lightbox__nav--next"
        onClick={goNext}
        disabled={isLast}
        aria-label="Successivo"
      >
        ›
      </button>
    </div>
  );
}
