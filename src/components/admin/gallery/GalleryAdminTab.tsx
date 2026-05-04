import { useCallback, useEffect, useState, type FormEvent } from "react";

import { GalleryAdminPanel } from "@/components/admin/gallery/GalleryAdminPanel";
import { useAuth } from "@/hooks/useAuth";
import { galleriesService } from "@/services/firestore/galleriesService";
import { gallerySecretsService } from "@/services/firestore/gallerySecretsService";
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
  const [createCode, setCreateCode] = useState(() =>
    gallerySecretsService.generateReadableCode("ATT"),
  );

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
    if (createCode.trim().length < 4) {
      setError("Il codice deve avere almeno 4 caratteri.");
      return;
    }
    setWorking(true);
    setError(null);
    setFeedback(null);
    try {
      const newGallery = await galleriesService.createGallery(stakeId, uid, {
        title: createTitle.trim(),
        description: createDescription.trim(),
        activityId: event.id,
      });
      await gallerySecretsService.setGalleryCode({
        stakeId,
        galleryId: newGallery.id,
        code: createCode,
      });
      setFeedback(`Galleria creata. Codice: ${createCode.trim().toUpperCase()}`);
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
            Una galleria protetta da codice per condividere foto e video con i partecipanti.
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
            <label className="field">
              <span>Codice di accesso</span>
              <div className="inline-row">
                <input
                  type="text"
                  value={createCode}
                  onChange={(submitEvent) => setCreateCode(submitEvent.target.value)}
                  required
                  minLength={4}
                  disabled={working}
                />
                <button
                  type="button"
                  className="button button--ghost button--small"
                  onClick={() =>
                    setCreateCode(gallerySecretsService.generateReadableCode("ATT"))
                  }
                  disabled={working}
                >
                  Genera
                </button>
              </div>
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
