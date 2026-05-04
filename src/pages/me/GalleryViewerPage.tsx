import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { PageHero } from "@/components/PageHero";
import { SectionCard } from "@/components/SectionCard";
import { useAuth } from "@/hooks/useAuth";
import {
  galleriesService,
  type GalleryDoc,
  type GalleryMedia,
} from "@/services/firestore/galleriesService";

const STAKE_ID = "roma-est";

export function GalleryViewerPage() {
  const { galleryId } = useParams<{ galleryId: string }>();
  const { session } = useAuth();
  const [gallery, setGallery] = useState<GalleryDoc | null>(null);
  const [hasMembership, setHasMembership] = useState(false);
  const [media, setMedia] = useState<GalleryMedia[]>([]);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<GalleryMedia | null>(null);

  useEffect(() => {
    if (!galleryId || !session) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      galleriesService.getGallery(STAKE_ID, galleryId),
      galleriesService.hasMembership(STAKE_ID, galleryId, session.firebaseUser.uid),
    ])
      .then(async ([galleryData, membership]) => {
        if (cancelled) return;
        setGallery(galleryData);
        setHasMembership(membership);
        if (membership) {
          const list = await galleriesService.listMedia(STAKE_ID, galleryId);
          if (!cancelled) setMedia(list);
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
  }, [galleryId, session]);

  async function tryUnlock() {
    if (!galleryId || !session) return;
    if (!code.trim()) {
      setError("Inserisci il codice della galleria.");
      return;
    }
    setUnlocking(true);
    setError(null);
    try {
      await galleriesService.unlockWithCode(STAKE_ID, galleryId, code);
      setHasMembership(true);
      const list = await galleriesService.listMedia(STAKE_ID, galleryId);
      setMedia(list);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Codice non valido.");
    } finally {
      setUnlocking(false);
    }
  }

  const sortedMedia = useMemo(
    () => [...media].sort((left, right) => left.order - right.order),
    [media],
  );

  return (
    <div className="page-content">
      <PageHero
        eyebrow="Galleria"
        title={gallery?.title ?? "Galleria foto e video"}
        description={gallery?.description ?? undefined}
      />

      {loading ? <p className="subtle-text">Caricamento...</p> : null}
      {error ? <p className="field-error">{error}</p> : null}

      {!loading && !gallery ? (
        <SectionCard title="Galleria non trovata">
          <Link className="button button--ghost" to="/me">
            Torna alla dashboard
          </Link>
        </SectionCard>
      ) : null}

      {!loading && gallery && !hasMembership ? (
        <SectionCard
          title="Inserisci il codice di accesso"
          description="Chiedi il codice all'organizzatore."
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
          </div>
        </SectionCard>
      ) : null}

      {!loading && hasMembership ? (
        <SectionCard title={`${sortedMedia.length} elementi`}>
          {sortedMedia.length === 0 ? (
            <p className="subtle-text">Galleria vuota.</p>
          ) : (
            <div className="gallery-grid">
              {sortedMedia.map((item) => {
                const thumb =
                  item.thumbnailUrl ?? item.optimizedUrl ?? item.posterUrl ?? item.storageUrl ?? "";
                return (
                  <button
                    key={item.id}
                    className="gallery-tile gallery-tile--button"
                    type="button"
                    onClick={() => setActive(item)}
                  >
                    {thumb ? <img src={thumb} alt={item.filename} loading="lazy" /> : null}
                    {item.type === "video" ? (
                      <span className="home-feed__video-badge">▶</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </SectionCard>
      ) : null}

      {active ? (
        <div
          className="gallery-lightbox"
          role="dialog"
          aria-modal="true"
          onClick={() => setActive(null)}
        >
          <button
            className="gallery-lightbox__close"
            type="button"
            aria-label="Chiudi"
            onClick={(event) => {
              event.stopPropagation();
              setActive(null);
            }}
          >
            ×
          </button>
          {active.type === "video" ? (
            <video
              src={active.originalUrl ?? active.storageUrl ?? active.optimizedUrl ?? ""}
              controls
              autoPlay
              onClick={(event) => event.stopPropagation()}
            />
          ) : (
            <img
              src={active.originalUrl ?? active.optimizedUrl ?? active.storageUrl ?? ""}
              alt={active.filename}
              onClick={(event) => event.stopPropagation()}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
