import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { AppIcon } from "@/components/AppIcon";
import { LikeButton } from "@/components/feed/LikeButton";
import { GalleryConfirmSheet, getDeleteMediaCopy } from "@/components/gallery/GalleryConfirmSheet";
import { GALLERIA } from "@/copy/galleria";
import { useAuth } from "@/hooks/useAuth";
import { galleryCommentsService } from "@/services/firestore/galleryCommentsService";
import type { GalleryComment, GalleryMedia } from "@/types";
import { isConnectionError, withWriteTimeout } from "@/utils/writeTimeout";

interface MediaLightboxProps {
  media: GalleryMedia[];
  initialIndex: number;
  isMediaLiked: (mediaId: string) => boolean;
  onClose: () => void;
  onToggleMediaLike: (media: GalleryMedia) => Promise<void>;
  /** Se passato e true per il media corrente, mostra il pulsante elimina. */
  canDeleteMedia?: (media: GalleryMedia) => boolean;
  /** Elimina il media corrente. Il chiamante aggiorna la lista e chiude. */
  onDeleteMedia?: (media: GalleryMedia) => Promise<void>;
  /** Azioni in più nella barra per il media corrente (es. Segnala). */
  renderExtraActions?: (media: GalleryMedia) => ReactNode;
  /** Like e commenti spenti (contenuti nascosti visti dallo staff). */
  readOnly?: boolean;
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
  canDeleteMedia,
  onDeleteMedia,
  renderExtraActions,
  readOnly = false,
}: MediaLightboxProps) {
  const { session } = useAuth();
  const [index, setIndex] = useState(initialIndex);
  const [deleting, setDeleting] = useState(false);
  const [comments, setComments] = useState<Record<string, GalleryComment[]>>({});
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentInput, setCommentInput] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [slideDirection, setSlideDirection] = useState<"left" | "right" | null>(null);
  // "Elimina" (foto, video o commento): prima il foglio, mai un dialogo del
  // browser. Il foglio tiene l'elemento scelto anche se la foto sotto cambia.
  const [confirm, setConfirm] = useState<
    | { kind: "media"; item: GalleryMedia }
    | { kind: "comment"; item: GalleryMedia; comment: GalleryComment }
    | null
  >(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // Ogni foglio aperto o chiuso ha il suo numero: l'esito di una richiesta
  // partita da un foglio precedente non tocca quello di adesso.
  const confirmRunRef = useRef(0);
  const sessionUid = session?.firebaseUser.uid ?? "";
  const confirmMediaId = confirm?.item.id ?? null;

  function showConfirm(next: typeof confirm) {
    confirmRunRef.current += 1;
    setConfirmBusy(false);
    setConfirmError(null);
    setConfirm(next);
  }

  // Il foglio vale per l'account e il contenuto con cui è stato aperto: se il
  // contenuto sparisce dalla lista (eliminato, anche da qui in attesa del
  // server, o nascosto da un altro) o l'account cambia, si chiude.
  useEffect(() => {
    if (confirmMediaId && !media.some((item) => item.id === confirmMediaId)) {
      showConfirm(null);
    }
  }, [media, confirmMediaId]);

  useEffect(() => {
    showConfirm(null);
  }, [sessionUid]);

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
    if (!current || readOnly) return;
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
  }, [current, comments, readOnly]);

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

  function handleDeleteComment(comment: GalleryComment) {
    if (!current) return;
    if (!session) return;
    if (comment.uid !== session.firebaseUser.uid && !session.isAdmin) return;
    showConfirm({ kind: "comment", item: current, comment });
  }

  function handleDeleteMedia() {
    if (!current || !onDeleteMedia) return;
    showConfirm({ kind: "media", item: current });
  }

  async function handleConfirmDelete() {
    if (!confirm || confirmBusy) return;
    const { item } = confirm;
    const run = confirmRunRef.current;
    const stillOpen = () => run === confirmRunRef.current;
    setConfirmBusy(true);
    setConfirmError(null);

    if (confirm.kind === "comment") {
      const { comment } = confirm;
      try {
        await withWriteTimeout(
          galleryCommentsService.remove(item.stakeId, item.galleryId, item.id, comment.id),
        );
        setComments((prev) => ({
          ...prev,
          [item.id]: (prev[item.id] ?? []).filter((entry) => entry.id !== comment.id),
        }));
        if (stillOpen()) showConfirm(null);
      } catch (caughtError) {
        if (stillOpen()) {
          setConfirmBusy(false);
          setConfirmError(isConnectionError(caughtError) ? GALLERIA.erroreRete : GALLERIA.erroreElimina);
        }
      }
      return;
    }

    if (!onDeleteMedia) return;
    setDeleting(true);
    try {
      await withWriteTimeout(onDeleteMedia(item));
      // Il chiamante rimuove il media dalla lista; chiudiamo il lightbox.
      onClose();
    } catch (caughtError) {
      setDeleting(false);
      // Se il foglio si è già chiuso (contenuto tolto dalla lista in attesa
      // del server) l'errore lo mostra la galleria, che resta aperta.
      if (stillOpen()) {
        setConfirmBusy(false);
        setConfirmError(isConnectionError(caughtError) ? GALLERIA.erroreRete : GALLERIA.erroreElimina);
      }
    }
  }

  async function handleDownload() {
    if (!current) return;
    const url =
      current.type === "image"
        ? current.storageUrl ?? current.optimizedUrl ?? current.thumbnailUrl
        : current.storageUrl ?? current.originalUrl ?? current.optimizedUrl;
    if (!url) return;
    const ext = current.type === "image" ? "jpg" : "mp4";
    const name = current.filename || `galleria-${current.id}.${ext}`;
    try {
      // Fetch → blob → download: forza il salvataggio anche su URL cross-origin
      // (l'attributo download da solo verrebbe ignorato). Firebase Storage
      // espone gli URL di download con CORS permissivo.
      const response = await fetch(url);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
    } catch {
      // Fallback: apri in una nuova scheda, l'utente salva con tap lungo.
      window.open(url, "_blank", "noopener");
    }
  }

  if (!current) return null;

  const currentComments = comments[current.id] ?? [];
  const showDelete = Boolean(onDeleteMedia && canDeleteMedia?.(current));
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
          {readOnly ? null : (
            <LikeButton
              liked={isMediaLiked(current.id)}
              count={current.likeCount}
              onToggle={() => onToggleMediaLike(current)}
              ariaLabel="Like alla foto/video"
            />
          )}
          <span className="media-lightbox__counter">
            {index + 1} / {media.length}
          </span>
          <button
            type="button"
            className="media-lightbox__download"
            onClick={handleDownload}
            aria-label="Scarica"
          >
            <AppIcon name="download" /> Scarica
          </button>
          {showDelete ? (
            <button
              type="button"
              className="media-lightbox__delete"
              onClick={handleDeleteMedia}
              disabled={deleting}
              aria-label="Elimina contenuto"
            >
              {deleting ? GALLERIA.eliminazione : "Elimina"}
            </button>
          ) : null}
          {renderExtraActions ? renderExtraActions(current) : null}
        </div>

        {readOnly ? null : (
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
        )}
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

      {confirm ? (
        <GalleryConfirmSheet
          {...(confirm.kind === "comment"
            ? {
                title: GALLERIA.eliminaCommentoTitolo,
                body: GALLERIA.eliminaCommentoCorpo,
                cancelLabel: GALLERIA.tieniCommento,
                confirmLabel: GALLERIA.confermaEliminaCommento,
              }
            : { ...getDeleteMediaCopy(confirm.item.type), body: GALLERIA.eliminaContenutoCorpo })}
          busy={confirmBusy}
          error={confirmError}
          onCancel={() => showConfirm(null)}
          onConfirm={() => void handleConfirmDelete()}
        />
      ) : null}
    </div>
  );
}
