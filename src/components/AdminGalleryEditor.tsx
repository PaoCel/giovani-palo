import { useEffect, useState, type ChangeEvent } from "react";

import { storageService } from "@/services/firebase/storageService";
import {
  galleryService,
  type GalleryItem,
} from "@/services/firestore/galleryService";

interface AdminGalleryEditorProps {
  stakeId: string;
  eventId: string;
  uploadedBy: string;
  galleryAccessCode: string;
}

export function AdminGalleryEditor({
  stakeId,
  eventId,
  uploadedBy,
  galleryAccessCode,
}: AdminGalleryEditorProps) {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    galleryService
      .listItems(stakeId, eventId)
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Errore caricamento galleria.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [stakeId, eventId]);

  async function refresh() {
    const list = await galleryService.listItems(stakeId, eventId);
    setItems(list);
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    setProgress({ current: 0, total: files.length });
    try {
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        const stored = await storageService.uploadGalleryFile({
          file,
          stakeId,
          eventId,
          uploadedBy,
        });
        await galleryService.addItem(stakeId, eventId, {
          path: stored.path,
          url: stored.url,
          name: stored.name,
          contentType: stored.contentType,
          size: stored.size,
          uploadedBy,
        });
        setProgress({ current: index + 1, total: files.length });
      }
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Errore upload.");
    } finally {
      setUploading(false);
      setProgress(null);
      event.target.value = "";
    }
  }

  async function removeItem(item: GalleryItem) {
    if (!confirm(`Eliminare ${item.name}?`)) return;
    try {
      await storageService.deleteFile(item.path).catch(() => undefined);
      await galleryService.deleteItem(stakeId, eventId, item.id);
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Errore eliminazione.");
    }
  }

  return (
    <div className="stack">
      {!galleryAccessCode ? (
        <div className="notice notice--warning">
          <div>
            <strong>Codice galleria non impostato.</strong>
            <p>
              Imposta il "Codice galleria foto" nell'editor evento per consentire ai
              partecipanti di sbloccare la galleria.
            </p>
          </div>
        </div>
      ) : (
        <p className="subtle-text">
          Codice attuale per i partecipanti: <code>{galleryAccessCode}</code>
        </p>
      )}

      <label className="field">
        <span className="field__label">Carica foto / video</span>
        <input
          className="input"
          type="file"
          accept="image/*,video/*"
          multiple
          disabled={uploading}
          onChange={handleUpload}
        />
        {progress ? (
          <small>
            Caricamento {progress.current} / {progress.total}
          </small>
        ) : null}
      </label>

      {error ? <p className="field-error">{error}</p> : null}

      {loading ? <p className="subtle-text">Caricamento...</p> : null}

      {!loading && items.length === 0 ? (
        <p className="subtle-text">Nessun media caricato.</p>
      ) : (
        <div className="gallery-grid">
          {items.map((item) => {
            const isVideo = item.contentType.startsWith("video/");
            const isImage = item.contentType.startsWith("image/");
            return (
              <div key={item.id} className="gallery-tile gallery-tile--admin">
                {isImage ? (
                  <img src={item.url} alt={item.name} loading="lazy" />
                ) : isVideo ? (
                  <video src={item.url} controls preload="metadata" />
                ) : (
                  <div className="gallery-tile__file">
                    <strong>{item.name}</strong>
                  </div>
                )}
                <button
                  className="button button--ghost button--small"
                  type="button"
                  onClick={() => removeItem(item)}
                >
                  Elimina
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
