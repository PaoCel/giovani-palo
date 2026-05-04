import { useState, type FormEvent } from "react";

import { EmptyState } from "@/components/EmptyState";
import { PageHero } from "@/components/PageHero";
import { SectionCard } from "@/components/SectionCard";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useAuth } from "@/hooks/useAuth";
import { feedService } from "@/services/firestore/feedService";
import type { FeedPost, FeedPostType } from "@/types";

export function AdminFeedPage() {
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
      setFeedback("Post pubblicato.");
    } catch (caughtError) {
      setFeedback(
        caughtError instanceof Error ? caughtError.message : "Errore creazione post.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTogglePublish(post: FeedPost) {
    await feedService.setPublished(stakeId, post.id, !post.published);
    setData((prev) =>
      prev.map((entry) =>
        entry.id === post.id
          ? { ...entry, published: !entry.published }
          : entry,
      ),
    );
  }

  async function handleDelete(post: FeedPost) {
    if (!window.confirm("Eliminare il post?")) return;
    await feedService.deletePost(stakeId, post.id);
    setData((prev) => prev.filter((entry) => entry.id !== post.id));
  }

  return (
    <div className="page">
      <PageHero
        eyebrow="Feed"
        title="Annunci e reminder"
        description="Crea annunci e reminder che appariranno nella home dei giovani. I post di tipo galleria vengono creati automaticamente quando pubblichi una galleria."
      />

      {feedback ? (
        <div className="notice notice--info">
          <p>{feedback}</p>
        </div>
      ) : null}

      <SectionCard title="Nuovo post" description="Annunci e reminder attività.">
        <form className="stack" onSubmit={handleCreate}>
          <label className="field">
            <span>Tipo</span>
            <select
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
                  type="text"
                  value={ctaLabel}
                  onChange={(event) => setCtaLabel(event.target.value)}
                  disabled={submitting}
                />
              </label>
              <label className="field">
                <span>URL CTA (opzionale)</span>
                <input
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

          <div className="form-actions">
            <button type="submit" className="button button--primary" disabled={submitting}>
              {submitting ? "Pubblico…" : "Pubblica post"}
            </button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Tutti i post" description="Inclusi quelli generati automaticamente dalle gallerie.">
        {error ? (
          <div className="notice notice--warning">
            <p>{error}</p>
          </div>
        ) : null}
        {loading ? (
          <p className="subtle-text">Sto caricando…</p>
        ) : posts.length === 0 ? (
          <EmptyState title="Nessun post" description="Crea il primo annuncio." />
        ) : (
          <ul className="admin-list">
            {posts.map((post) => (
              <li key={post.id} className="admin-list__item">
                <div>
                  <h4>{post.title}</h4>
                  <p className="subtle-text">
                    {post.type === "gallery"
                      ? "Galleria"
                      : post.type === "activity_reminder"
                        ? "Reminder"
                        : "Annuncio"}
                    {" · "}
                    {post.published ? "Pubblicato" : "Bozza"}
                    {post.pinned ? " · Fissato" : ""}
                  </p>
                </div>
                <div className="admin-list__actions">
                  <button
                    type="button"
                    className="button button--ghost button--small"
                    onClick={() => handleTogglePublish(post)}
                  >
                    {post.published ? "Metti in bozza" : "Pubblica"}
                  </button>
                  <button
                    type="button"
                    className="button button--ghost button--small"
                    onClick={() => handleDelete(post)}
                  >
                    Elimina
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
