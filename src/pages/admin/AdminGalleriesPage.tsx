import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { EmptyState } from "@/components/EmptyState";
import { PageHero } from "@/components/PageHero";
import { SectionCard } from "@/components/SectionCard";
import { useAsyncData } from "@/hooks/useAsyncData";
import { useAuth } from "@/hooks/useAuth";
import { galleriesService } from "@/services/firestore/galleriesService";
import { gallerySecretsService } from "@/services/firestore/gallerySecretsService";
import type { Gallery } from "@/types";

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
  const [code, setCode] = useState(() => gallerySecretsService.generateReadableCode());
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  function regenerateCode() {
    setCode(gallerySecretsService.generateReadableCode());
  }

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
      await gallerySecretsService.setGalleryCode({
        stakeId,
        galleryId: gallery.id,
        code: code.trim(),
      });
      setData((prev) => [gallery, ...prev]);
      setCreating(false);
      setTitle("");
      setDescription("");
      regenerateCode();
      setFeedback(`Galleria creata. Codice impostato: ${code.trim().toUpperCase()}`);
      navigate(`/admin/galleries/${gallery.id}`);
    } catch (caughtError) {
      setFeedback(
        caughtError instanceof Error
          ? caughtError.message
          : "Errore durante la creazione della galleria.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <PageHero
        eyebrow="Gallerie"
        title="Gallerie foto e video"
        description="Crea gallerie protette da codice. Quando le pubblichi appariranno nel feed dei giovani."
        actions={
          <button
            type="button"
            className="button button--primary"
            onClick={() => setCreating((value) => !value)}
          >
            {creating ? "Annulla" : "Nuova galleria"}
          </button>
        }
      />

      {feedback ? (
        <div className="notice notice--info">
          <p>{feedback}</p>
        </div>
      ) : null}

      {creating ? (
        <SectionCard
          title="Nuova galleria"
          description="Inserisci titolo, descrizione e il codice di accesso. Il codice viene mostrato in chiaro solo ora: salvalo nei tuoi appunti."
        >
          <form className="stack" onSubmit={handleCreate}>
            <label className="field">
              <span>Titolo</span>
              <input
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
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Breve descrizione (opzionale)"
                rows={3}
                disabled={submitting}
              />
            </label>
            <label className="field">
              <span>Codice di accesso</span>
              <div className="inline-row">
                <input
                  type="text"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  required
                  minLength={4}
                  disabled={submitting}
                />
                <button
                  type="button"
                  className="button button--ghost button--small"
                  onClick={regenerateCode}
                  disabled={submitting}
                >
                  Genera nuovo
                </button>
              </div>
              <small className="subtle-text">
                Salva subito il codice: per sicurezza non sarà più mostrato in chiaro.
              </small>
            </label>
            <div className="form-actions">
              <button type="submit" className="button button--primary" disabled={submitting}>
                {submitting ? "Creo…" : "Crea galleria"}
              </button>
            </div>
          </form>
        </SectionCard>
      ) : null}

      <SectionCard
        title="Tutte le gallerie"
        description="Elenco delle gallerie configurate per il tuo palo."
      >
        {error ? (
          <div className="notice notice--warning">
            <p>{error}</p>
          </div>
        ) : null}
        {loading ? (
          <p className="subtle-text">Sto caricando…</p>
        ) : galleries.length === 0 ? (
          <EmptyState
            title="Nessuna galleria"
            description="Crea la prima galleria per condividere foto e video con i giovani."
          />
        ) : (
          <ul className="admin-list">
            {galleries.map((gallery) => (
              <li key={gallery.id} className="admin-list__item">
                <div>
                  <h4>{gallery.title}</h4>
                  <p className="subtle-text">
                    {gallery.mediaCount} elementi · {gallery.published ? "Pubblicata" : "Bozza"}
                  </p>
                </div>
                <Link
                  className="button button--ghost button--small"
                  to={`/admin/galleries/${gallery.id}`}
                >
                  Apri
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
