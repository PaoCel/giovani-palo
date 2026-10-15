import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import "@/styles/activityGallery.css";

import { GalleryAdminPanel } from "@/components/admin/gallery/GalleryAdminPanel";
import { useAuth } from "@/hooks/useAuth";
import { galleriesService } from "@/services/firestore/galleriesService";
import type { Event, Gallery, GalleryMedia } from "@/types";
import { isGalleryUploadOpen } from "@/utils/galleryWindow";

function formatUntil(ms: number) {
  return new Date(ms).toLocaleString("it-IT", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface GalleryAdminTabProps {
  event: Event;
}

export function GalleryAdminTab({ event }: GalleryAdminTabProps) {
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId ?? event.stakeId;
  const uid = session?.firebaseUser.uid ?? "";

  const [gallery, setGallery] = useState<Gallery | null>(null);
  const [media, setMedia] = useState<GalleryMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const [createTitle, setCreateTitle] = useState(event.title);
  const [createDescription, setCreateDescription] = useState(event.description);

  const refresh = useCallback(async () => {
    if (!stakeId || !event.id) return;
    setLoading(true);
    setError(null);
    try {
      const found = await galleriesService.getGalleryByActivity(stakeId, event.id);
      if (!found) {
        setGallery(null);
        setMedia([]);
        return;
      }
      const list = await galleriesService.listMedia(stakeId, found.id);
      setGallery(found);
      setMedia(list);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Errore caricamento.",
      );
    } finally {
      setLoading(false);
    }
  }, [stakeId, event.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleCreate(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    if (!stakeId || !uid) return;
    if (!createTitle.trim()) {
      setError("Il titolo è obbligatorio.");
      return;
    }
    setWorking(true);
    setError(null);
    setFeedback(null);
    try {
      // Stessa galleria che aprono i ragazzi (id dell'attività + finestra di
      // caricamento dalle date), poi titolo e descrizione scelti qui.
      const galleryId = await galleriesService.ensureActivityGallery(stakeId, event.id);
      if (!galleryId) throw new Error("Attività senza data di inizio: impossibile aprire la galleria.");
      await galleriesService.updateGallery(stakeId, galleryId, {
        title: createTitle.trim(),
        description: createDescription.trim(),
      });
      setFeedback("Galleria creata. La vedono tutti gli iscritti al palo con un account.");
      await refresh();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Errore creazione.");
    } finally {
      setWorking(false);
    }
  }

  if (loading) {
    return <p className="subtle-text">Sto caricando…</p>;
  }

  if (!gallery) {
    return (
      <div className="gallery-empty">
        {error ? (
          <div className="notice notice--warning">
            <p>{error}</p>
          </div>
        ) : null}
        {feedback ? (
          <div className="notice notice--info">
            <p>{feedback}</p>
          </div>
        ) : null}
        <div className="card gallery-create">
          <h3 className="gallery-create__title">Crea galleria</h3>
          <p className="subtle-text">
            Si apre da sola all'inizio dell'attività; puoi crearla prima per caricare tu le prime foto.
            La vedono tutti gli iscritti al palo con un account.
          </p>
          <form className="stack" onSubmit={handleCreate}>
            <label className="field">
              <span>Titolo</span>
              <input
                type="text"
                value={createTitle}
                onChange={(submitEvent) => setCreateTitle(submitEvent.target.value)}
                required
                disabled={working}
              />
            </label>
            <label className="field">
              <span>Descrizione (facoltativa)</span>
              <textarea
                value={createDescription}
                onChange={(submitEvent) => setCreateDescription(submitEvent.target.value)}
                rows={2}
                disabled={working}
              />
            </label>
            <div className="form-actions">
              <button type="submit" className="button button--primary" disabled={working}>
                {working ? "Creo…" : "Crea galleria"}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  const open = isGalleryUploadOpen(event, gallery);

  async function toggleUploads(next: boolean) {
    if (!gallery) return;
    setWorking(true);
    setError(null);
    try {
      await galleriesService.setUploadsOpen(stakeId, gallery.id, next ? { days: 7 } : false);
      await refresh();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Modifica non salvata.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <div className="card gallery-uploads">
        <div>
          <h3 className="gallery-create__title">Caricamenti dei ragazzi</h3>
          <p className="subtle-text">
            {open && gallery.uploadsOpenUntil
              ? `Aperti fino al ${formatUntil(gallery.uploadsOpenUntil)}.`
              : "Chiusi: solo gli admin possono aggiungere foto e video."}{" "}
            Le foto segnalate si controllano dalla galleria, nel filtro Nascosti.
          </p>
          {error ? <p className="form-error">{error}</p> : null}
        </div>
        <div className="form-actions">
          <Link className="button button--soft" to={`/activities/${event.id}/foto`}>
            Apri la galleria
          </Link>
          {open ? (
            <button
              type="button"
              className="button button--ghost"
              disabled={working}
              onClick={() => void toggleUploads(false)}
            >
              Chiudi caricamenti
            </button>
          ) : (
            <button
              type="button"
              className="button button--primary"
              disabled={working}
              onClick={() => void toggleUploads(true)}
            >
              Riapri per 7 giorni
            </button>
          )}
        </div>
      </div>
      <GalleryAdminPanel
        gallery={gallery}
        media={media}
        setGallery={setGallery}
        setMedia={setMedia}
      />
    </>
  );
}
