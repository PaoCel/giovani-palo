import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { ConfirmSheet } from "@/components/ConfirmSheet";
import { AdminListSkeleton } from "@/components/AdminListSkeleton";
import { Button, Card, EmptyState, Notice, PageHeader, Pill } from "@/components/ui";
import { ADMIN } from "@/copy/admin";
import { ADMIN_ELENCHI as COPY } from "@/copy/adminElenchi";
import { fillCopy } from "@/copy/parole";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useAuth } from "@/hooks/useAuth";
import { feedService } from "@/services/firestore/feedService";
import type { FeedPost, FeedPostType } from "@/types";
import { getAdminActionError } from "@/utils/adminErrors";
import { withWriteTimeout } from "@/utils/writeTimeout";
import "@/styles/adminPages.css";

export function AdminFeedPage() {
  const typeLabelId = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId ?? "";
  const uid = session?.firebaseUser.uid ?? "";

  const { data: posts, loading, error, setData } = useAsyncData<FeedPost[]>(
    () => feedService.listAllPosts(stakeId),
    [stakeId],
    [],
  );

  const [type, setType] = useState<FeedPostType>("announcement");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [activityId, setActivityId] = useState("");
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [pinned, setPinned] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  // Un errore di creazione è un avviso, il successo un'informazione.
  const [feedbackFailed, setFeedbackFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyPostId, setBusyPostId] = useState<string | null>(null);
  // "Elimina": prima il foglio di conferma, mai un dialogo del browser.
  const [deleteTarget, setDeleteTarget] = useState<FeedPost | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Numero del foglio: l'esito di una richiesta partita da un foglio chiuso
  // nel frattempo (o da un altro palo) non tocca quello aperto dopo.
  const deleteRunRef = useRef(0);

  function showDelete(post: FeedPost | null) {
    deleteRunRef.current += 1;
    setDeleteError(null);
    setDeleteTarget(post);
  }

  // Altro account o altro palo con il foglio aperto: si chiude.
  useEffect(() => {
    showDelete(null);
  }, [stakeId, uid]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const created = await feedService.createPost(stakeId, uid, {
        type,
        title: title.trim(),
        body: body.trim(),
        activityId: type === "activity_reminder" ? activityId.trim() || null : null,
        published: true,
        pinned,
        ctaLabel: ctaLabel.trim() || null,
        ctaUrl: ctaUrl.trim() || null,
      });
      setData((prev) => [created, ...prev]);
      setTitle("");
      setBody("");
      setActivityId("");
      setCtaLabel("");
      setCtaUrl("");
      setPinned(false);
      setFeedbackFailed(false);
      setFeedback("Post pubblicato.");
    } catch (caughtError) {
      setFeedbackFailed(true);
      setFeedback(
        caughtError instanceof Error ? caughtError.message : "Errore creazione post.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTogglePublish(post: FeedPost) {
    setBusyPostId(post.id);
    setActionError(null);
    try {
      await withWriteTimeout(feedService.setPublished(stakeId, post.id, !post.published));
      setData((prev) =>
        prev.map((entry) =>
          entry.id === post.id
            ? { ...entry, published: !entry.published }
            : entry,
        ),
      );
    } catch (caughtError) {
      setActionError(getAdminActionError(caughtError, ADMIN.errorePubblicaPost));
    } finally {
      setBusyPostId(null);
    }
  }

  async function handleDelete(post: FeedPost) {
    const run = deleteRunRef.current;
    setDeleting(true);
    setDeleteError(null);
    try {
      await withWriteTimeout(feedService.deletePost(stakeId, post.id));
      setData((prev) => prev.filter((entry) => entry.id !== post.id));
      if (run === deleteRunRef.current) {
        showDelete(null);
      }
    } catch (caughtError) {
      if (run === deleteRunRef.current) {
        setDeleteError(getAdminActionError(caughtError, ADMIN.erroreEliminaPost));
      }
    } finally {
      setDeleting(false);
    }
  }

  const typeLabel = (post: FeedPost) =>
    post.type === "gallery" ? COPY.tipoGalleria : post.type === "activity_reminder" ? COPY.tipoReminder : COPY.tipoAnnuncio;

  let list;
  if (loading) {
    list = <AdminListSkeleton label={COPY.caricamento} />;
  } else if (posts.length === 0 && !error) {
    list = (
      <EmptyState
        action={
          <Button onClick={() => titleRef.current?.focus()} variant="secondary">
            {COPY.scriviPost}
          </Button>
        }
        description={COPY.postVuotoCorpo}
        headingAs="h3"
        title={COPY.postVuotoTitolo}
      />
    );
  } else {
    list = (
      <ul className="admin-rows">
        {posts.map((post) => (
          <li key={post.id}>
            <div className="admin-row admin-row--plain">
              <div className="admin-row__info">
                <strong className="admin-row__title">{post.title}</strong>
                <span className="admin-row__pills">
                  <Pill>{typeLabel(post)}</Pill>
                  <Pill dot tone={post.published ? "success" : "warning"}>
                    {post.published ? COPY.pubblicato : COPY.bozza}
                  </Pill>
                  {post.pinned ? <Pill tone="sand">{COPY.fissato}</Pill> : null}
                </span>
                <div className="admin-row__actions">
                  <Button
                    busy={busyPostId === post.id}
                    onClick={() => void handleTogglePublish(post)}
                    variant="secondary"
                  >
                    {post.published ? COPY.mettiInBozza : COPY.pubblica}
                  </Button>
                  <Button onClick={() => showDelete(post)} variant="ghost">
                    {COPY.elimina}
                  </Button>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="page page--admin-list">
      <PageHeader
        description={COPY.feedPaginaDescrizione}
        eyebrow={COPY.feedOcchiello}
        title={COPY.feedPaginaTitolo}
      />

      {feedback ? (
        <Notice tone={feedbackFailed ? "warning" : "info"}>
          <p>{feedback}</p>
        </Notice>
      ) : null}
      {actionError ? (
        <Notice tone="warning">
          <p>{actionError}</p>
        </Notice>
      ) : null}

      <Card subtitle="Annunci e reminder attività." title="Nuovo post">
        <form className="admin-form" onSubmit={handleCreate}>
          <label className="field">
            <span id={typeLabelId}>Tipo</span>
            {/* The wrapping label would add the options to the accessible name. */}
            <select
              className="input"
              aria-labelledby={typeLabelId}
              value={type}
              onChange={(event) => setType(event.target.value as FeedPostType)}
              disabled={submitting}
            >
              <option value="announcement">Annuncio</option>
              <option value="activity_reminder">Reminder attività</option>
            </select>
          </label>
          <label className="field">
            <span>Titolo</span>
            <input
              className="input"
              ref={titleRef}
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              disabled={submitting}
            />
          </label>
          <label className="field">
            <span>Testo</span>
            <textarea
              className="input input--textarea"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={4}
              disabled={submitting}
            />
          </label>

          {type === "activity_reminder" ? (
            <label className="field">
              <span>ID attività</span>
              <input
                className="input"
                type="text"
                value={activityId}
                onChange={(event) => setActivityId(event.target.value)}
                placeholder="ID dell'attività esistente"
                disabled={submitting}
              />
            </label>
          ) : null}

          {type === "announcement" ? (
            <>
              <label className="field">
                <span>Etichetta CTA (opzionale)</span>
                <input
                  className="input"
                  type="text"
                  value={ctaLabel}
                  onChange={(event) => setCtaLabel(event.target.value)}
                  disabled={submitting}
                />
              </label>
              <label className="field">
                <span>URL CTA (opzionale)</span>
                <input
                  className="input"
                  type="url"
                  value={ctaUrl}
                  onChange={(event) => setCtaUrl(event.target.value)}
                  disabled={submitting}
                />
              </label>
            </>
          ) : null}

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(event) => setPinned(event.target.checked)}
              disabled={submitting}
            />
            <span>Fissa in cima al feed</span>
          </label>

          <div className="admin-form__actions">
            <Button busy={submitting} type="submit">
              {submitting ? "Pubblico…" : "Pubblica post"}
            </Button>
          </div>
        </form>
      </Card>

      <Card subtitle={COPY.tuttiIPostDescrizione} title={COPY.tuttiIPost}>
        {error ? (
          <Notice tone="warning">
            <p>{error}</p>
          </Notice>
        ) : null}
        {list}
      </Card>

      {deleteTarget ? (
        <ConfirmSheet
          body={ADMIN.eliminaPostCorpo}
          busy={deleting}
          busyLabel={ADMIN.eliminazione}
          cancelLabel={ADMIN.tieniPost}
          confirmLabel={ADMIN.confermaEliminaPost}
          error={deleteError}
          onCancel={() => showDelete(null)}
          onConfirm={() => void handleDelete(deleteTarget)}
          title={fillCopy(ADMIN.eliminaPostTitolo, { titolo: deleteTarget.title })}
          tone="danger"
        />
      ) : null}
    </div>
  );
}
