import { useCallback, useEffect, useState, type FormEvent } from "react";

import { GalleryAdminPanel } from "@/components/admin/gallery/GalleryAdminPanel";
import { useAuth } from "@/hooks/useAuth";
import { galleriesService } from "@/services/firestore/galleriesService";
import type { Event, Gallery, GalleryMedia } from "@/types";

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
      await galleriesService.createGallery(stakeId, uid, {
        title: createTitle.trim(),
        description: createDescription.trim(),
        activityId: event.id,
      });
      setFeedback("Galleria creata. È accessibile a tutti gli utenti registrati.");
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
            Una galleria visibile a tutti gli utenti registrati per condividere foto e video con i partecipanti.
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

  return (
    <GalleryAdminPanel
      gallery={gallery}
      media={media}
      setGallery={setGallery}
      setMedia={setMedia}
    />
  );
}
