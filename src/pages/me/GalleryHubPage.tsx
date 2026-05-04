import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { PageHero } from "@/components/PageHero";
import { SectionCard } from "@/components/SectionCard";
import {
  galleriesService,
  type GalleryDoc,
} from "@/services/firestore/galleriesService";

const STAKE_ID = "roma-est";

export function GalleryHubPage() {
  const [galleries, setGalleries] = useState<GalleryDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    galleriesService
      .listPublishedGalleries(STAKE_ID)
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
  }, []);

  return (
    <div className="page-content">
      <PageHero
        eyebrow="Galleria"
        title="Gallerie attività"
        description="Foto e video delle attività GU/GD del palo. Servono i codici di accesso forniti dagli organizzatori."
      />

      {loading ? <p className="subtle-text">Caricamento...</p> : null}
      {error ? <p className="field-error">{error}</p> : null}

      {!loading && galleries.length === 0 ? (
        <SectionCard title="Nessuna galleria pubblicata">
          <Link className="button button--ghost" to="/me">
            Torna alla dashboard
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
              <p className="subtle-text">
                {gallery.mediaCount} elementi
                {gallery.publishedAt
                  ? ` · ${new Date(gallery.publishedAt).toLocaleDateString("it-IT", {
                      day: "2-digit",
                      month: "long",
                      year: "numeric",
                    })}`
                  : ""}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
