import { useEffect, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import {
  feedPostsService,
  type FeedComment,
} from "@/services/firestore/feedPostsService";

interface CommentSectionProps {
  stakeId: string;
  postId: string;
  initiallyOpen?: boolean;
}

export function CommentSection({
  stakeId,
  postId,
  initiallyOpen = false,
}: CommentSectionProps) {
  const { session } = useAuth();
  const [open, setOpen] = useState(initiallyOpen);
  const [loaded, setLoaded] = useState(initiallyOpen);
  const [loading, setLoading] = useState(false);
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    setLoading(true);
    feedPostsService
      .listComments(stakeId, postId)
      .then((list) => {
        if (!cancelled) {
          setComments(list);
          setLoaded(true);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Errore caricamento commenti.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, loaded, stakeId, postId]);

  async function handlePost() {
    if (!session) return;
    if (!body.trim()) return;
    setPosting(true);
    setError(null);
    try {
      const created = await feedPostsService.addComment(stakeId, postId, {
        uid: session.firebaseUser.uid,
        displayName: session.profile.fullName || "Utente",
        body,
      });
      setComments((current) => [created, ...current]);
      setBody("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Errore invio commento.");
    } finally {
      setPosting(false);
    }
  }

  async function handleDelete(comment: FeedComment) {
    if (!confirm("Eliminare il commento?")) return;
    try {
      await feedPostsService.deleteComment(stakeId, postId, comment.id);
      setComments((current) => current.filter((item) => item.id !== comment.id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Errore eliminazione.");
    }
  }

  return (
    <div className="comment-section">
      <button
        type="button"
        className="button button--ghost button--small"
        onClick={() => setOpen((current) => !current)}
      >
        💬 {open ? "Nascondi commenti" : "Mostra commenti"}
        {comments.length > 0 ? ` (${comments.length})` : ""}
      </button>

      {open ? (
        <>
          {error ? <p className="field-error">{error}</p> : null}

          {session ? (
            <div className="comment-form">
              <textarea
                className="input input--textarea"
                rows={2}
                placeholder="Scrivi un commento..."
                value={body}
                maxLength={1000}
                onChange={(event) => setBody(event.target.value)}
              />
              <button
                type="button"
                className="button button--primary button--small"
                onClick={handlePost}
                disabled={posting || !body.trim()}
              >
                {posting ? "Invio..." : "Pubblica"}
              </button>
            </div>
          ) : (
            <p className="subtle-text">Accedi per commentare.</p>
          )}

          {loading ? <p className="subtle-text">Caricamento commenti...</p> : null}

          <div className="comment-list">
            {comments.length === 0 && !loading ? (
              <p className="subtle-text">Nessun commento. Sii il primo!</p>
            ) : null}
            {comments.map((comment) => {
              const canDelete =
                session &&
                (session.isAdmin || session.firebaseUser.uid === comment.uid);
              return (
                <article key={comment.id} className="polaroid-comment">
                  <div className="polaroid-comment__head">
                    <strong>{comment.displayName}</strong>
                    <span className="polaroid-comment__date">
                      {new Date(comment.createdAt).toLocaleDateString("it-IT", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <p className="polaroid-comment__body">{comment.body}</p>
                  {canDelete ? (
                    <button
                      type="button"
                      className="polaroid-comment__delete"
                      onClick={() => handleDelete(comment)}
                      aria-label="Elimina commento"
                    >
                      ×
                    </button>
                  ) : null}
                </article>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
