import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBlocker } from "react-router-dom";

import { AppIcon } from "@/components/AppIcon";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { LikeButton } from "@/components/feed/LikeButton";
import { GalleryConfirmSheet, getDeleteMediaCopy } from "@/components/gallery/GalleryConfirmSheet";
import { GALLERIA } from "@/copy/galleria";
import { useGalleryAccess } from "@/hooks/useActivityGallery";
import { useAuth } from "@/hooks/useAuth";
import { isTopLayer, keepTabInside, useInertBackground } from "@/hooks/useModalLayer";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { galleryCommentsService } from "@/services/firestore/galleryCommentsService";
import type { GalleryComment, GalleryMedia } from "@/types";
import { isConnectionError, isOffline } from "@/utils/writeTimeout";
import "@/styles/mediaLightbox.css";

interface MediaLightboxProps {
  media: GalleryMedia[];
  initialIndex: number;
  isMediaLiked: (mediaId: string) => boolean;
  onClose: () => void;
  onToggleMediaLike: (media: GalleryMedia) => Promise<void>;
  canDeleteMedia?: (media: GalleryMedia) => boolean;
  onDeleteMedia?: (media: GalleryMedia) => Promise<void>;
  renderExtraActions?: (media: GalleryMedia) => ReactNode;
  /** Return true when a parent-owned sheet consumed Back (for example Report). */
  onDismissOverlay?: () => boolean;
  readOnly?: boolean;
}

const COMMENT_ERROR = "Non sono riuscito a inviare il commento. Riprova.";
const COMMENT_READ_ERROR = "Non sono riuscito a caricare i commenti. Riprova.";
const SWIPE_THRESHOLD = 50;
const SWIPE_VERTICAL_TOLERANCE = 80;
const mediaKey = (item: GalleryMedia) => JSON.stringify([item.stakeId, item.galleryId, item.id]);
type CommentLoad = { status: "loading" | "ready" | "error"; items: GalleryComment[]; error?: string };
type DeleteChoice = { item: GalleryMedia } & ({ kind: "media" } | { kind: "comment"; comment: GalleryComment });
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

export function MediaLightbox(props: MediaLightboxProps) {
  const { session } = useAuth();
  const stakeId = props.media[props.initialIndex]?.stakeId ?? props.media[0]?.stakeId ?? "";
  const { isMember, access } = useGalleryAccess(stakeId);
  const context = JSON.stringify([session?.firebaseUser.uid ?? "", session?.profile.stakeId ?? "", stakeId]);
  const original = useRef(context).current;
  useEffect(() => {
    if (context !== original || (access !== "loading" && !isMember)) props.onClose();
  }, [context, original, access, isMember, props.onClose]);
  // Mount the actual layer only after access is known. Its focus and inert
  // effects therefore always receive a real portal node, including StrictMode.
  return context === original && isMember ? <MediaLightboxContent {...props} /> : null;
}

function MediaLightboxContent({ media, initialIndex, isMediaLiked, onClose, onToggleMediaLike,
  canDeleteMedia, onDeleteMedia, renderExtraActions, onDismissOverlay, readOnly = false }: MediaLightboxProps) {
  const { session } = useAuth();
  const online = useNetworkStatus();
  const [selectedKey, setSelectedKey] = useState(() => media[initialIndex] ? mediaKey(media[initialIndex]) : "");
  const current = media.find((item) => mediaKey(item) === selectedKey);
  const index = current ? media.indexOf(current) : -1;
  const stakeId = current?.stakeId ?? media[0]?.stakeId ?? "";
  const uid = session?.firebaseUser.uid ?? "";
  const scope = JSON.stringify([uid, session?.profile.stakeId ?? "", stakeId]);
  const bound = useRef({ scope, uid, stakeId }).current;
  const { isMember: canComment, access } = useGalleryAccess(stakeId);
  const scopeValid = scope === bound.scope;
  const viewRef = useRef({ scope, selectedKey });
  viewRef.current = { scope, selectedKey };
  const mounted = useRef(false);
  const normalClose = useRef(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const drafts = useRef(new Map<string, string>());
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  const loadsRef = useRef<Record<string, CommentLoad>>({});
  const confirmed = useRef(new Map<string, { added: Map<string, GalleryComment>; removed: Set<string> }>());
  const [loads, setLoads] = useState<Record<string, CommentLoad>>({});
  const [retry, setRetry] = useState(0);
  const [confirm, setConfirm] = useState<DeleteChoice | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const confirmInFlight = useRef(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const confirmGeneration = useRef(0);
  const [closeChoice, setCloseChoice] = useState<"draft" | "pending" | null>(null);
  const [slideDirection, setSlideDirection] = useState<"left" | "right" | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const closeCallback = useRef(onClose);
  closeCallback.current = onClose;
  useInertBackground(dialogRef);

  const contextOf = (item: GalleryMedia) => ({ uid: bound.uid, stakeId: item.stakeId, galleryId: item.galleryId, mediaId: item.id });
  const submission = current ? galleryCommentsService.getSubmission(contextOf(current)) : undefined;
  const pending = submission?.status === "pending";
  const commentInput = pending ? submission.comment.body
    : drafts.current.get(selectedKey) ?? (submission?.status === "failed" ? submission.comment.body : "");
  const currentLoad = loads[selectedKey];
  const currentComments = currentLoad?.items ?? [];

  function storeLoad(key: string, value: CommentLoad) {
    loadsRef.current = { ...loadsRef.current, [key]: value };
    setLoads(loadsRef.current);
  }
  function confirmedFor(key: string) {
    let edits = confirmed.current.get(key);
    if (!edits) {
      edits = { added: new Map(), removed: new Set() };
      confirmed.current.set(key, edits);
    }
    return edits;
  }
  function mergeServerComments(key: string, items: GalleryComment[]) {
    const edits = confirmedFor(key);
    const merged = new Map(items.filter((item) => !edits.removed.has(item.id)).map((item) => [item.id, item]));
    for (const [id, item] of edits.added) {
      if (merged.has(id)) edits.added.delete(id);
      else if (!edits.removed.has(id)) merged.set(id, item);
    }
    for (const id of edits.removed) {
      if (!items.some((item) => item.id === id)) edits.removed.delete(id);
    }
    return [...merged.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  function showConfirm(value: DeleteChoice | null) {
    confirmGeneration.current += 1;
    setConfirm(value);
    setConfirmError(null);
    setConfirmBusy(false);
  }
  function finishClose(discard: boolean) {
    if (discard) {
      drafts.current.clear();
      media.forEach((item) => galleryCommentsService.discardSubmission(contextOf(item)));
    }
    normalClose.current = true;
    closeCallback.current();
  }
  function requestClose() {
    if (media.some((item) => {
      const state = galleryCommentsService.getSubmission(contextOf(item));
      return state?.status === "failed" || (drafts.current.get(mediaKey(item))?.trim() && state?.status !== "pending" && state?.status !== "sent");
    })) setCloseChoice("draft");
    else if (media.some((item) => galleryCommentsService.getSubmission(contextOf(item))?.status === "pending")) setCloseChoice("pending");
    else finishClose(false);
  }
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  useEffect(() => galleryCommentsService.subscribeSubmissions(refresh), [refresh]);
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }));
    return () => {
      mounted.current = false;
      cancelAnimationFrame(frame);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
      // StrictMode immediately mounts again. Only a real forced unmount discards
      // context; a normal close keeps the outcome of an already-started request.
      queueMicrotask(() => {
        if (!mounted.current && !normalClose.current) galleryCommentsService.clearContext(bound.uid, bound.stakeId);
      });
    };
  }, [bound]);

  useEffect(() => {
    if (!scopeValid || (access !== "loading" && !canComment)) {
      drafts.current.clear();
      galleryCommentsService.clearContext(bound.uid, bound.stakeId);
      closeCallback.current();
    }
  }, [scopeValid, canComment, access, bound]);

  useEffect(() => {
    if (!confirm) return;
    if (!scopeValid || !media.some((item) => mediaKey(item) === mediaKey(confirm.item))) showConfirm(null);
  }, [media, confirm, scopeValid]);

  const blocker = useBlocker(({ historyAction }) => historyAction === "POP" && scopeValid);
  const handledBlock = useRef<string | null>(null);
  useEffect(() => {
    if (blocker.state !== "blocked") { handledBlock.current = null; return; }
    if (handledBlock.current === blocker.location.key) return;
    handledBlock.current = blocker.location.key;
    blocker.reset();
    if (confirm) { if (!confirmBusy) showConfirm(null); }
    else if (closeChoice) setCloseChoice(null);
    else if (!onDismissOverlay?.()) requestCloseRef.current();
  }, [blocker, confirm, confirmBusy, closeChoice, onDismissOverlay]);

  const navigatePhoto = useCallback((direction: number) => {
    if (!isTopLayer(dialogRef.current)) return;
    const next = media[index + direction];
    if (!next) return;
    setSlideDirection(direction > 0 ? "left" : "right");
    setSelectedKey(mediaKey(next));
  }, [media, index]);
  useEffect(() => {
    if (!slideDirection) return;
    const timer = window.setTimeout(() => setSlideDirection(null), 220);
    return () => window.clearTimeout(timer);
  }, [slideDirection]);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!isTopLayer(dialogRef.current)) return;
      const editing = event.target instanceof HTMLElement && Boolean(event.target.closest("input, textarea, [contenteditable='true']"));
      if (event.key === "Escape") { event.preventDefault(); requestCloseRef.current(); }
      else if (!editing && event.key === "ArrowRight") { event.preventDefault(); navigatePhoto(1); }
      else if (!editing && event.key === "ArrowLeft") { event.preventDefault(); navigatePhoto(-1); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigatePhoto]);

  useEffect(() => {
    if (!current || readOnly || !canComment || !scopeValid) return;
    const key = mediaKey(current);
    if (loadsRef.current[key]?.status === "ready") return;
    let active = true;
    storeLoad(key, { status: "loading", items: loadsRef.current[key]?.items ?? [] });
    galleryCommentsService.list(current.stakeId, current.galleryId, current.id).then((items) => {
      if (active && viewRef.current.scope === bound.scope) storeLoad(key, { status: "ready", items: mergeServerComments(key, items) });
    }).catch((error: unknown) => {
      if (!active || viewRef.current.scope !== bound.scope) return;
      const edits = confirmedFor(key);
      storeLoad(key, { status: "error", items: [...edits.added.values()].filter((item) => !edits.removed.has(item.id)),
        error: isConnectionError(error) ? GALLERIA.erroreRete : COMMENT_READ_ERROR });
    });
    return () => { active = false; };
  }, [selectedKey, retry, readOnly, canComment, scopeValid, bound]);

  useEffect(() => {
    if (!current || submission?.status !== "sent" || !scopeValid) return;
    const key = mediaKey(current);
    const items = loadsRef.current[key]?.items ?? [];
    confirmedFor(key).added.set(submission.comment.id, submission.comment);
    storeLoad(key, { status: "ready", items: [...items.filter((item) => item.id !== submission.comment.id), submission.comment]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)) });
    drafts.current.delete(key);
    galleryCommentsService.discardSubmission(contextOf(current));
    refresh();
  }, [selectedKey, submission?.status, submission?.comment.id, version, scopeValid]);

  function handleSubmitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current || !session || readOnly || !canComment || !scopeValid || isOffline() || pending) return;
    const text = commentInput.trim();
    if (!text) return;
    drafts.current.set(selectedKey, text);
    void galleryCommentsService.add({ ...contextOf(current), displayName: getDisplayName(session), body: text })
      .catch(() => undefined); // The real outcome is kept by the service for this photo.
  }
  async function handleConfirmDelete() {
    if (!confirm || confirmInFlight.current || readOnly || !scopeValid) return;
    if (isOffline()) { setConfirmError(GALLERIA.erroreRete); return; }
    const choice = confirm;
    const generation = confirmGeneration.current;
    const stillHere = () => mounted.current && viewRef.current.scope === bound.scope && generation === confirmGeneration.current;
    confirmInFlight.current = true;
    setConfirmBusy(true);
    setConfirmError(null);
    try {
      if (choice.kind === "comment") {
        await galleryCommentsService.remove(choice.item.stakeId, choice.item.galleryId, choice.item.id, choice.comment.id);
        if (!stillHere()) return;
        const key = mediaKey(choice.item);
        confirmedFor(key).added.delete(choice.comment.id);
        confirmedFor(key).removed.add(choice.comment.id);
        storeLoad(key, { status: "ready", items: (loadsRef.current[key]?.items ?? []).filter((item) => item.id !== choice.comment.id) });
        showConfirm(null);
      } else if (onDeleteMedia) {
        await onDeleteMedia(choice.item);
        if (stillHere()) finishClose(false);
      }
    } catch (error) {
      if (stillHere()) { setConfirmBusy(false); setConfirmError(isConnectionError(error) ? GALLERIA.erroreRete : GALLERIA.erroreElimina); }
    } finally { confirmInFlight.current = false; }
  }
  async function handleDownload() {
    if (!current || isOffline()) return;
    const captured = current;
    const url = captured.type === "image" ? captured.storageUrl ?? captured.optimizedUrl ?? captured.thumbnailUrl
      : captured.storageUrl ?? captured.originalUrl ?? captured.optimizedUrl;
    if (!url) return;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("download-failed");
      const blob = await response.blob();
      if (!mounted.current || viewRef.current.scope !== bound.scope) return;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = captured.filename || `galleria-${captured.id}.${captured.type === "image" ? "jpg" : "mp4"}`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
    } catch {
      if (mounted.current && viewRef.current.scope === bound.scope) window.open(url, "_blank", "noopener");
    }
  }

  if (!scopeValid || !canComment || typeof document === "undefined") return null;
  const showDelete = current && Boolean(onDeleteMedia && canDeleteMedia?.(current));
  return createPortal(
    <div className="media-lightbox" role="dialog" aria-modal="true" aria-label="Foto e commenti" ref={dialogRef}
      onKeyDown={(event) => keepTabInside(event, dialogRef.current)} tabIndex={-1}>
      <button type="button" className="media-lightbox__close" onClick={requestClose} aria-label="Chiudi" ref={closeRef}>×</button>
      <div className="media-lightbox__scroll" onTouchStart={(event) => {
        const touch = event.touches[0]; touchStart.current = { x: touch.clientX, y: touch.clientY };
      }} onTouchEnd={(event) => {
        const start = touchStart.current; touchStart.current = null;
        if (!start || (event.target instanceof HTMLElement && event.target.closest("input, textarea, button, video"))) return;
        const touch = event.changedTouches[0];
        if (Math.abs(touch.clientX - start.x) > SWIPE_THRESHOLD && Math.abs(touch.clientY - start.y) < SWIPE_VERTICAL_TOLERANCE) navigatePhoto(touch.clientX < start.x ? 1 : -1);
      }}>
        {!current ? <p className="media-lightbox__notice" role="status">Questa foto non è più disponibile.</p> : <>
          <article className={`polaroid${slideDirection ? ` polaroid--slide-${slideDirection}` : ""}`} key={selectedKey}>
            <div className="polaroid__media">{current.type === "image"
              ? <img src={current.optimizedUrl ?? current.storageUrl ?? current.thumbnailUrl ?? ""} alt={current.caption || "Foto"} draggable={false} />
              : <video controls preload="none" poster={current.posterUrl ?? current.thumbnailUrl ?? undefined} src={current.storageUrl ?? current.optimizedUrl ?? ""} />}</div>
            <div className="polaroid__caption">{current.caption ? <span>{current.caption}</span>
              : <span className="polaroid__caption-meta">{index + 1} / {media.length}</span>}</div>
          </article>
          {!online ? <p className="media-lightbox__notice" role="status">Sei offline. Le nuove azioni saranno disponibili quando torna la connessione.</p> : null}
          <div className="media-lightbox__bar">
            {!readOnly ? <LikeButton key={selectedKey} liked={isMediaLiked(current.id)} count={current.likeCount}
              onToggle={() => isOffline() ? Promise.reject(new Error("offline")) : onToggleMediaLike(current)} ariaLabel="Like alla foto/video" /> : null}
            <span className="media-lightbox__counter">{index + 1} / {media.length}</span>
            <button type="button" className="media-lightbox__download" onClick={() => void handleDownload()} disabled={!online} aria-label="Scarica"><AppIcon name="download" /> Scarica</button>
            {showDelete ? <button type="button" className="media-lightbox__delete" disabled={confirmBusy || !online}
              onClick={() => showConfirm({ kind: "media", item: current })}>Elimina</button> : null}
            {renderExtraActions?.(current)}
          </div>
          {!readOnly ? <section className="media-comments" aria-label="Commenti della foto">
            <header className="media-comments__head"><h4>Commenti</h4>{currentLoad?.status === "ready" ? <span className="subtle-text">{currentComments.length}</span> : null}</header>
            {!currentLoad || currentLoad.status === "loading" ? <p className="subtle-text" role="status">Sto caricando…</p> : null}
            {currentLoad?.status === "error" ? <div role="alert"><p className="form-error">{currentLoad.error}</p><button type="button" className="button button--ghost" disabled={!online} onClick={() => setRetry((value) => value + 1)}>Riprova</button></div> : null}
            {currentLoad?.status === "ready" && currentComments.length === 0 ? <p className="subtle-text">Nessun commento ancora. Scrivi tu il primo!</p> : null}
            {currentComments.length ? <ul className="media-comments__list">{currentComments.map((comment) => <li key={comment.id} className="media-comment">
              <div className="media-comment__head"><strong className="media-comment__author">{comment.displayName}</strong><time className="media-comment__time">{formatCommentTime(comment.createdAt)}</time></div>
              <p className="media-comment__body">{comment.body}</p>
              {session && (comment.uid === uid || session.isAdmin) ? <button type="button" className="media-comment__delete" disabled={!online}
                onClick={() => showConfirm({ kind: "comment", item: current, comment })} aria-label="Elimina commento">Elimina</button> : null}
            </li>)}</ul> : null}
            <form className="media-comments__form" onSubmit={handleSubmitComment}>
              <input type="text" value={commentInput} aria-label="Scrivi un commento" placeholder="Scrivi un commento…" maxLength={2000} disabled={pending}
                onChange={(event) => { drafts.current.set(selectedKey, event.target.value); refresh(); }} />
              <button type="submit" className="button button--primary button--small" disabled={pending || !online || !commentInput.trim()}>{pending ? "Invio…" : submission?.status === "failed" ? "Riprova" : "Invia"}</button>
            </form>
            {pending ? <p className="subtle-text" role="status">Invio in corso. Puoi cambiare foto: il commento resta collegato a questa.</p> : null}
            {submission?.status === "failed" ? <p className="form-error" role="alert">{isConnectionError(submission.error) ? GALLERIA.erroreRete : COMMENT_ERROR}</p> : null}
          </section> : null}
        </>}
      </div>
      <button type="button" className="media-lightbox__nav media-lightbox__nav--prev" onClick={() => navigatePhoto(-1)} disabled={index <= 0} aria-label="Precedente">‹</button>
      <button type="button" className="media-lightbox__nav media-lightbox__nav--next" onClick={() => navigatePhoto(1)} disabled={index < 0 || index >= media.length - 1} aria-label="Successivo">›</button>
      {confirm ? <GalleryConfirmSheet {...(confirm.kind === "comment"
        ? { title: GALLERIA.eliminaCommentoTitolo, body: GALLERIA.eliminaCorpo, cancelLabel: GALLERIA.tieniCommento, confirmLabel: GALLERIA.confermaEliminaCommento }
        : { ...getDeleteMediaCopy(confirm.item.type), body: GALLERIA.eliminaCorpo })} busy={confirmBusy} error={confirmError}
        onCancel={() => showConfirm(null)} onConfirm={() => void handleConfirmDelete()} /> : null}
      {closeChoice ? <ConfirmSheet title={closeChoice === "draft" ? "Hai un commento non inviato" : "Invio in corso"}
        body={closeChoice === "draft" ? "Puoi continuare a scrivere o scartare le bozze dei commenti. Le richieste già partite continuano l’invio." : "La richiesta è già partita. Puoi chiudere la foto: ritroverai l’esito nei suoi commenti."}
        cancelLabel={closeChoice === "draft" ? "Continua a scrivere" : "Resta qui"} confirmLabel={closeChoice === "draft" ? "Scarta bozza" : "Chiudi foto"}
        tone={closeChoice === "draft" ? "danger" : "neutral"} onCancel={() => setCloseChoice(null)} onConfirm={() => finishClose(closeChoice === "draft")} /> : null}
    </div>, document.body,
  );
}
