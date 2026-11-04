import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { ActivityScene } from "@/components/activities/ActivityScene";
import { AdminListSkeleton } from "@/components/AdminListSkeleton";
import { Button, Card, EmptyState, Icon, Notice, PageHeader, Pill } from "@/components/ui";
import { ADMIN_ELENCHI as COPY } from "@/copy/adminElenchi";
import { fillCopy } from "@/copy/parole";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useAuth } from "@/hooks/useAuth";
import { galleriesService } from "@/services/firestore/galleriesService";
import type { Gallery } from "@/types";
import giovaniUrl from "@/assets/flusso-genitore/giovani.webp";
import "@/styles/adminPages.css";

export function AdminGalleriesPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const stakeId = session?.profile.stakeId ?? "";

  const { data: galleries, loading, error, setData } = useAsyncData<Gallery[]>(
    () => galleriesService.listGalleries(stakeId),
    [stakeId],
    [],
  );

  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  // Un errore di creazione è un avviso, il successo un'informazione.
  const [feedbackFailed, setFeedbackFailed] = useState(false);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    if (!title.trim()) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const gallery = await galleriesService.createGallery(
        stakeId,
        session.firebaseUser.uid,
        { title: title.trim(), description: description.trim() },
      );
      setData((prev) => [gallery, ...prev]);
      setCreating(false);
      setTitle("");
      setDescription("");
      setFeedbackFailed(false);
      setFeedback("Galleria creata. È accessibile a tutti gli utenti registrati.");
      navigate(`/admin/galleries/${gallery.id}`);
    } catch (caughtError) {
      setFeedbackFailed(true);
      setFeedback(
        caughtError instanceof Error
          ? caughtError.message
          : "Errore durante la creazione della galleria.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const openCreate = () => {
    setFeedback(null);
    setCreating(true);
  };

  let list;
  if (loading) {
    list = <AdminListSkeleton label={COPY.caricamento} />;
  } else if (galleries.length === 0 && !error) {
    list = (
      <EmptyState
        action={
          creating ? null : (
            <Button icon="plus" onClick={openCreate}>
              {COPY.nuovaGalleria}
            </Button>
          )
        }
        description={COPY.gallerieVuotoCorpo}
        headingAs="h3"
        illustration={giovaniUrl}
        title={COPY.gallerieVuotoTitolo}
      />
    );
  } else {
    list = (
      <ul className="admin-rows">
        {galleries.map((gallery) => (
          <li key={gallery.id}>
            <Link className="admin-row" to={`/admin/galleries/${gallery.id}`}>
              <span
                className="admin-row__thumb"
                style={gallery.coverImageUrl ? { backgroundImage: `url(${gallery.coverImageUrl})` } : undefined}
              >
                {gallery.coverImageUrl ? null : <ActivityScene className="admin-row__scene" />}
              </span>
              <span className="admin-row__info">
                <strong className="admin-row__title">{gallery.title}</strong>
                <span className="admin-row__pills">
                  <Pill dot tone={gallery.published ? "success" : "warning"}>
                    {gallery.published ? COPY.pubblicata : COPY.bozza}
                  </Pill>
                  <Pill>
                    {gallery.mediaCount === 1
                      ? COPY.elementoUno
                      : fillCopy(COPY.elementi, { n: String(gallery.mediaCount) })}
                  </Pill>
                </span>
              </span>
              <Icon name="arrow-right" className="admin-row__arrow" />
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="page page--admin-list">
      <PageHeader
        actions={
          <Button
            icon={creating ? undefined : "plus"}
            onClick={() => (creating ? setCreating(false) : openCreate())}
            variant={creating ? "secondary" : "primary"}
          >
            {creating ? COPY.annulla : COPY.nuovaGalleria}
          </Button>
        }
        description={COPY.gallerieDescrizione}
        eyebrow={COPY.gallerieOcchiello}
        title={COPY.gallerieTitolo}
      />

      {feedback ? (
        <Notice tone={feedbackFailed ? "warning" : "info"}>
          <p>{feedback}</p>
        </Notice>
      ) : null}

      {creating ? (
        <Card
          subtitle="Inserisci titolo e descrizione. La galleria sarà visibile a tutti gli utenti registrati."
          title={COPY.nuovaGalleria}
        >
          <form className="admin-form" onSubmit={handleCreate}>
            <label className="field">
              <span>Titolo</span>
              <input
                className="input"
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Es. Viaggio al Tempio 2026"
                required
                disabled={submitting}
              />
            </label>
            <label className="field">
              <span>Descrizione</span>
              <textarea
                className="input input--textarea"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Breve descrizione (opzionale)"
                rows={3}
                disabled={submitting}
              />
            </label>
            <div className="admin-form__actions">
              <Button busy={submitting} type="submit">
                {submitting ? "Creo…" : "Crea galleria"}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card subtitle={COPY.gallerieElencoDescrizione} title={COPY.tutteLeGallerie}>
        {error ? (
          <Notice tone="warning">
            <p>{error}</p>
          </Notice>
        ) : null}
        {list}
      </Card>
    </div>
  );
}
