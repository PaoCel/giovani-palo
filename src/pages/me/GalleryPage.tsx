import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { PageHero } from "@/components/PageHero";
import { SectionCard } from "@/components/SectionCard";
import { useAuth } from "@/hooks/useAuth";
import { eventsService } from "@/services/firestore/eventsService";
import {
  galleryService,
  type GalleryItem,
} from "@/services/firestore/galleryService";
import type { Event } from "@/types";

const STAKE_ID = "roma-est";

export function GalleryPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { session } = useAuth();
  const [event, setEvent] = useState<Event | null>(null);
  const [hasAccess, setHasAccess] = useState(false);
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId || !session) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      eventsService.getEventById(STAKE_ID, eventId),
      galleryService.hasAccess(STAKE_ID, eventId, session.firebaseUser.uid),
    ])
      .then(async ([eventData, accessGranted]) => {
        if (cancelled) return;
        setEvent(eventData);
        setHasAccess(accessGranted);
        if (accessGranted) {
          const list = await galleryService.listItems(STAKE_ID, eventId);
          if (!cancelled) setItems(list);
        }
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
  }, [eventId, session]);

  async function tryUnlock() {
    if (!eventId || !session || !code.trim()) {
      setError("Inserisci il codice della galleria.");
      return;
    }
    setUnlocking(true);
    setError(null);
    try {
      await galleryService.unlockWithCode(
        STAKE_ID,
        eventId,
        session.firebaseUser.uid,
        code,
      );
      setHasAccess(true);
      const list = await galleryService.listItems(STAKE_ID, eventId);
      setItems(list);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Codice non valido.";
      setError(message.includes("permission") ? "Codice non valido." : message);
    } finally {
      setUnlocking(false);
    }
  }

  return (
    <div className="page-content">
      <PageHero
        eyebrow="Galleria"
        title="Galleria foto e video"
        description={
          event
            ? `Materiale dell'attività ${event.title}.`
            : "Materiale dell'attività."
        }
      />

      {loading ? <p className="subtle-text">Caricamento...</p> : null}
      {error ? <p className="field-error">{error}</p> : null}

      {!loading && !hasAccess ? (
        <SectionCard
          title="Inserisci il codice di accesso"
          description="Chiedi il codice all'organizzatore dell'attività."
        >
          <div className="form-stack form-stack--compact">
            <label className="field">
              <span className="field__label">Codice</span>
              <input
                className="input"
                type="text"
                value={code}
                placeholder="Codice galleria"
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
            <button
              className="button button--primary"
              type="button"
              disabled={unlocking}
              onClick={tryUnlock}
            >
              {unlocking ? "Verifica..." : "Sblocca galleria"}
            </button>
            <Link className="button button--ghost" to="/me">
              Torna alla dashboard
            </Link>
          </div>
        </SectionCard>
      ) : null}

      {!loading && hasAccess ? (
        <SectionCard title={`${items.length} elementi`}>
          {items.length === 0 ? (
            <p className="subtle-text">
              Nessuna foto o video caricato. Torna piu' tardi.
            </p>
          ) : (
            <div className="gallery-grid">
              {items.map((item) => (
                <GalleryTile key={item.id} item={item} />
              ))}
            </div>
          )}
        </SectionCard>
      ) : null}
    </div>
  );
}

function GalleryTile({ item }: { item: GalleryItem }) {
  const isVideo = item.contentType.startsWith("video/");
  const isImage = item.contentType.startsWith("image/");
  return (
    <a
      className="gallery-tile"
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {isImage ? (
        <img src={item.url} alt={item.name} loading="lazy" />
      ) : isVideo ? (
        <video src={item.url} controls preload="metadata" />
      ) : (
        <div className="gallery-tile__file">
          <strong>{item.name}</strong>
          <small>{(item.size / (1024 * 1024)).toFixed(1)} MB</small>
        </div>
      )}
    </a>
  );
}
