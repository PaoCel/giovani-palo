import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { GalleryAdminPanel } from "@/components/admin/gallery/GalleryAdminPanel";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/hooks/useAuth";
import { galleriesService } from "@/services/firestore/galleriesService";
import type { Gallery, GalleryMedia } from "@/types";

export function AdminGalleryDetailPage() {
  const { galleryId = "" } = useParams();
  const navigate = useNavigate();
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId ?? "";

  const [gallery, setGallery] = useState<Gallery | null>(null);
  const [media, setMedia] = useState<GalleryMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!stakeId || !galleryId) return;
      setLoading(true);
      setError(null);
      try {
        const [doc, list] = await Promise.all([
          galleriesService.getGallery(stakeId, galleryId),
          galleriesService.listMedia(stakeId, galleryId),
        ]);
        if (!active) return;
        setGallery(doc);
        setMedia(list);
      } catch (caughtError) {
        if (active) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Errore caricamento.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [stakeId, galleryId]);

  if (loading) {
    return (
      <div className="page">
        <p className="subtle-text">Sto caricando…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <div className="notice notice--warning">
          <h3>Errore</h3>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!gallery) {
    return (
      <div className="page">
        <EmptyState
          title="Galleria non trovata"
          description="Forse è stata eliminata. Torna all'elenco."
          action={
            <Link className="button button--ghost" to="/admin/galleries">
              Torna alle gallerie
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="gallery-page-back">
        <Link className="button button--ghost button--small" to="/admin/galleries">
          ← Tutte le gallerie
        </Link>
      </div>
      <GalleryAdminPanel
        gallery={gallery}
        media={media}
        setGallery={setGallery}
        setMedia={setMedia}
        onDeleted={() => navigate("/admin/galleries")}
      />
    </div>
  );
}
