import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import {
  galleriesService,
  type GalleryDoc,
} from "@/services/firestore/galleriesService";

interface AdminGalleryPanelProps {
  stakeId: string;
  eventId: string;
}

export function AdminGalleryPanel({ stakeId, eventId }: AdminGalleryPanelProps) {
  const [galleries, setGalleries] = useState<GalleryDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyGalleryId, setBusyGalleryId] = useState<string | null>(null);
  const [codeInputs, setCodeInputs] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    galleriesService
      .listGalleriesForActivity(stakeId, eventId)
      .then((list) => {
        if (!cancelled) setGalleries(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Errore caricamento gallerie.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [stakeId, eventId]);

  async function setSecret(gallery: GalleryDoc) {
    const code = codeInputs[gallery.id]?.trim() ?? "";
    if (!code) {
      setError("Inserisci un codice.");
      return;
    }
    setBusyGalleryId(gallery.id);
    setError(null);
    setFeedback(null);
    try {
      await galleriesService.setSecretCode(stakeId, gallery.id, code);
      setFeedback(`Codice impostato per "${gallery.title}".`);
      setCodeInputs((current) => ({ ...current, [gallery.id]: "" }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Errore impostazione codice.");
    } finally {
      setBusyGalleryId(null);
    }
  }

  return (
    <article className="surface-panel surface-panel--subtle">
      <h3>Gallerie associate all'attività</h3>
      <p className="subtle-text">
        Le gallerie e i media sono caricati da uno strumento esterno (admin SDK / batch).
        Da qui puoi impostare il codice di accesso.
      </p>

      {loading ? <p className="subtle-text">Caricamento gallerie...</p> : null}
      {error ? <p className="field-error">{error}</p> : null}
      {feedback ? <p className="subtle-text">{feedback}</p> : null}

      {!loading && galleries.length === 0 ? (
        <p className="subtle-text">
          Nessuna galleria associata a questa attività.
        </p>
      ) : null}

      <div className="stack">
        {galleries.map((gallery) => (
          <article
            key={gallery.id}
            className="surface-panel surface-panel--subtle admin-gallery-row"
          >
            <div>
              <strong>{gallery.title}</strong>
              <p className="subtle-text">
                {gallery.mediaCount} elementi · accesso:{" "}
                {gallery.accessMode === "code_required" ? "con codice" : gallery.accessMode}{" "}
                · codice: {gallery.codeStatus === "set" ? "impostato" : "non impostato"} ·{" "}
                {gallery.published ? "pubblicata" : "bozza"}
              </p>
              <Link
                className="button button--ghost button--small"
                to={`/me/galleria/${gallery.id}`}
              >
                Apri da utente
              </Link>
            </div>

            <div className="form-stack form-stack--compact">
              <label className="field">
                <span className="field__label">Imposta / aggiorna codice</span>
                <input
                  className="input"
                  type="text"
                  value={codeInputs[gallery.id] ?? ""}
                  placeholder="Nuovo codice"
                  onChange={(eventInput) =>
                    setCodeInputs((current) => ({
                      ...current,
                      [gallery.id]: eventInput.target.value,
                    }))
                  }
                />
              </label>
              <button
                className="button button--primary button--small"
                type="button"
                disabled={busyGalleryId === gallery.id}
                onClick={() => setSecret(gallery)}
              >
                {busyGalleryId === gallery.id ? "Salvataggio..." : "Imposta codice"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </article>
  );
}
