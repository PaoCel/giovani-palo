import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { PageHero } from "@/components/PageHero";
import { SectionCard } from "@/components/SectionCard";
import {
  galleriesService,
  type GalleryDoc,
} from "@/services/firestore/galleriesService";

const STAKE_ID = "roma-est";

export function GalleryByActivityPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [galleries, setGalleries] = useState<GalleryDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    galleriesService
      .listGalleriesForActivity(STAKE_ID, eventId)
      .then((list) => {
        if (!cancelled) setGalleries(list.filter((gallery) => gallery.published));
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
  }, [eventId]);

  if (!loading && galleries.length === 1) {
    return <Navigate replace to={`/me/galleria/${galleries[0].id}`} />;
  }

  return (
    <div className="page-content">
      <PageHero
        eyebrow="Galleria"
        title="Gallerie dell'attività"
        description="Tocca una galleria per vedere le foto."
      />

      {loading ? <p className="subtle-text">Caricamento...</p> : null}
      {error ? <p className="field-error">{error}</p> : null}

      {!loading && galleries.length === 0 ? (
        <SectionCard title="Nessuna galleria disponibile per questa attività">
          <Link className="button button--ghost" to="/me/galleria">
            Vedi tutte le gallerie
          </Link>
        </SectionCard>
      ) : null}

      <div className="gallery-hub-grid">
        {galleries.map((gallery) => (
          <Link
            key={gallery.id}
            to={`/me/galleria/${gallery.id}`}
            className="gallery-hub-card"
          >
            {gallery.coverImageUrl ? (
              <img src={gallery.coverImageUrl} alt={gallery.title} loading="lazy" />
            ) : (
              <div className="gallery-hub-card__cover-fallback" />
            )}
            <div className="gallery-hub-card__body">
              <strong>{gallery.title}</strong>
              <p className="subtle-text">{gallery.mediaCount} elementi</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
