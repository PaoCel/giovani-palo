import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { GalleryAdminPanel } from "@/components/admin/gallery/GalleryAdminPanel";
import { AdminListSkeleton } from "@/components/AdminListSkeleton";
import { ButtonLink, EmptyState, Icon, Notice } from "@/components/ui";
import { ADMIN_ELENCHI as COPY } from "@/copy/adminElenchi";
import { useAuth } from "@/hooks/useAuth";
import { galleriesService } from "@/services/firestore/galleriesService";
import type { Gallery, GalleryMedia } from "@/types";
import "@/styles/adminPages.css";

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
              : COPY.galleriaErrore,
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
      <div className="page page--admin-gallery">
        <AdminListSkeleton label={COPY.caricamento} rows={2} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page page--admin-gallery">
        <Notice title={COPY.galleriaErrore} tone="warning">
          <p>{error}</p>
        </Notice>
      </div>
    );
  }

  if (!gallery) {
    return (
      <div className="page page--admin-gallery">
        <h1 className="sr-only">{COPY.gallerieTitolo}</h1>
        <EmptyState
          action={
            <ButtonLink to="/admin/galleries" variant="secondary">
              {COPY.tornaAlleGallerie}
            </ButtonLink>
          }
          description={COPY.galleriaNonTrovataCorpo}
          title={COPY.galleriaNonTrovata}
        />
      </div>
    );
  }

  return (
    <div className="page page--admin-gallery">
      {/* Il pannello scrive il titolo in uno span (è anche nella scheda
          dell'attività): l'h1 della pagina è per i lettori di schermo. */}
      <h1 className="sr-only">{gallery.title}</h1>
      <Link className="admin-back" to="/admin/galleries">
        <Icon name="arrow-left" />
        <span>{COPY.tutteLeGallerie}</span>
      </Link>
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
