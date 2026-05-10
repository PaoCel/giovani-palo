import {
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";

import { GalleryGrid } from "@/components/admin/gallery/GalleryGrid";
import { MediaActionSheet } from "@/components/admin/gallery/MediaActionSheet";
import { useGalleryUploader } from "@/components/admin/gallery/useGalleryUploader";
import { AppModal } from "@/components/AppModal";
import { useAuth } from "@/hooks/useAuth";
import { deleteMediaPath } from "@/services/firebase/galleryUploadService";
import { feedService } from "@/services/firestore/feedService";
import { galleriesService } from "@/services/firestore/galleriesService";
import { gallerySecretsService } from "@/services/firestore/gallerySecretsService";
import type { Gallery, GalleryMedia } from "@/types";

interface GalleryAdminPanelProps {
  gallery: Gallery;
  media: GalleryMedia[];
  setGallery: Dispatch<SetStateAction<Gallery | null>>;
  setMedia: Dispatch<SetStateAction<GalleryMedia[]>>;
  onDeleted?: () => void;
}

export function GalleryAdminPanel({
  gallery,
  media,
  setGallery,
  setMedia,
  onDeleted,
}: GalleryAdminPanelProps) {
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId ?? gallery.stakeId;
  const uid = session?.firebaseUser.uid ?? "";

  const [working, setWorking] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<GalleryMedia | null>(null);
  const [codeModalOpen, setCodeModalOpen] = useState(false);
  const [newCode, setNewCode] = useState("");

  const [infoModalOpen, setInfoModalOpen] = useState(false);
  const [editTitle, setEditTitle] = useState(gallery.title);
  const [editDescription, setEditDescription] = useState(gallery.description);
  const [savingInfo, setSavingInfo] = useState(false);

  const uploader = useGalleryUploader({
    gallery,
    uploadedBy: uid,
    startOrder: media.length,
    onUploaded: (item) => {
      setMedia((prev) => [...prev, item]);
      setGallery((prev) =>
        prev ? { ...prev, mediaCount: prev.mediaCount + 1 } : prev,
      );
    },
  });

  function openInfoModal() {
    setEditTitle(gallery.title);
    setEditDescription(gallery.description);
    setInfoModalOpen(true);
  }

  async function handleSaveInfo(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    if (!editTitle.trim()) return;
    setSavingInfo(true);
    setError(null);
    try {
      await galleriesService.updateGallery(stakeId, gallery.id, {
        title: editTitle.trim(),
        description: editDescription.trim(),
      });
      setGallery((prev) =>
        prev
          ? {
              ...prev,
              title: editTitle.trim(),
              description: editDescription.trim(),
            }
          : prev,
      );
      setInfoModalOpen(false);
      setFeedback("Dettagli aggiornati.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Errore.");
    } finally {
      setSavingInfo(false);
    }
  }

  async function handleSetCode(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    if (newCode.trim().length < 4) return;
    setWorking(true);
    setError(null);
    try {
      await gallerySecretsService.setGalleryCode({
        stakeId,
        galleryId: gallery.id,
        code: newCode,
      });
      setGallery((prev) => (prev ? { ...prev, codeStatus: "set" } : prev));
      setFeedback(
        `Codice aggiornato: ${newCode.trim().toUpperCase()}`,
      );
      setNewCode("");
      setCodeModalOpen(false);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Errore codice.");
    } finally {
      setWorking(false);
    }
  }

  async function handleDeleteMedia(item: GalleryMedia) {
    if (!window.confirm("Eliminare questo media?")) return;
    setWorking(true);
    try {
      await galleriesService.deleteMedia(stakeId, gallery.id, item.id);
      const targets = [
        item.storagePath,
        item.optimizedPath,
        item.thumbnailPath,
        item.posterPath,
        item.originalPath,
      ];
      await Promise.all(
        targets
          .filter((path): path is string => Boolean(path))
          .map((path) => deleteMediaPath(path)),
      );
      setMedia((prev) => prev.filter((entry) => entry.id !== item.id));
      const refreshed = await galleriesService.getGallery(stakeId, gallery.id);
      if (refreshed) setGallery(refreshed);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Errore eliminazione.");
    } finally {
      setWorking(false);
    }
  }

  async function handleSetCover(item: GalleryMedia) {
    setWorking(true);
    try {
      await galleriesService.setCover(
        stakeId,
        gallery.id,
        item.id,
        item.optimizedUrl ?? item.thumbnailUrl ?? item.storageUrl ?? null,
      );
      setGallery((prev) =>
        prev
          ? {
              ...prev,
              coverMediaId: item.id,
              coverImageUrl:
                item.optimizedUrl ?? item.thumbnailUrl ?? item.storageUrl ?? null,
            }
          : prev,
      );
    } finally {
      setWorking(false);
    }
  }

  async function handleMove(item: GalleryMedia, direction: "up" | "down") {
    const sorted = [...media].sort((a, b) => a.order - b.order);
    const index = sorted.findIndex((entry) => entry.id === item.id);
    if (index === -1) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= sorted.length) return;
    const swap = sorted[targetIndex];
    setWorking(true);
    try {
      await Promise.all([
        galleriesService.updateMedia(stakeId, gallery.id, item.id, {
          order: swap.order,
        }),
        galleriesService.updateMedia(stakeId, gallery.id, swap.id, {
          order: item.order,
        }),
      ]);
      setMedia((prev) =>
        prev.map((entry) => {
          if (entry.id === item.id) return { ...entry, order: swap.order };
          if (entry.id === swap.id) return { ...entry, order: item.order };
          return entry;
        }),
      );
    } finally {
      setWorking(false);
    }
  }

  async function handlePublishToggle() {
    setError(null);
    setFeedback(null);
    if (!gallery.published) {
      if (gallery.accessMode === "code_required" && gallery.codeStatus !== "set") {
        setError("Imposta prima il codice di accesso.");
        return;
      }
      if (gallery.mediaCount === 0) {
        setError("Carica almeno un media prima di pubblicare.");
        return;
      }
    }
    setWorking(true);
    try {
      if (gallery.published) {
        await galleriesService.setPublished(stakeId, gallery.id, false);
        const existing = await feedService.findGalleryPosts(stakeId, gallery.id);
        for (const post of existing) {
          await feedService.setPublished(stakeId, post.id, false);
        }
        setGallery((prev) =>
          prev ? { ...prev, published: false, publishedAt: null } : prev,
        );
        setFeedback("Galleria sospesa.");
      } else {
        await galleriesService.setPublished(stakeId, gallery.id, true);
        const latestMedia = await galleriesService.listMedia(stakeId, gallery.id);
        const refreshed =
          (await galleriesService.getGallery(stakeId, gallery.id)) ?? gallery;
        await feedService.syncGalleryPosts(stakeId, uid, refreshed, latestMedia);
        await galleriesService.markPostsCreated(stakeId, gallery.id, true);
        setMedia(latestMedia);
        setGallery(refreshed);
        setFeedback("Galleria pubblicata.");
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Errore.");
    } finally {
      setWorking(false);
    }
  }

  async function handleSyncPosts() {
    setWorking(true);
    setFeedback(null);
    try {
      const latestMedia = await galleriesService.listMedia(stakeId, gallery.id);
      await feedService.syncGalleryPosts(stakeId, uid, gallery, latestMedia);
      await galleriesService.markPostsCreated(stakeId, gallery.id, true);
      setFeedback("Feed aggiornato.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Errore feed.");
    } finally {
      setWorking(false);
    }
  }

  async function handleDeleteGallery() {
    if (!onDeleted) return;
    if (!window.confirm("Eliminare la galleria? L'azione non rimuove i file da Storage.")) {
      return;
    }
    setWorking(true);
    try {
      const existingPosts = await feedService.findGalleryPosts(stakeId, gallery.id);
      for (const post of existingPosts) {
        await feedService.deletePost(stakeId, post.id);
      }
      await galleriesService.deleteGallery(stakeId, gallery.id);
      onDeleted();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Errore eliminazione.");
    } finally {
      setWorking(false);
    }
  }

  const sortedMedia = [...media].sort((a, b) => a.order - b.order);
  const selectedPosition = selected
    ? sortedMedia.findIndex((entry) => entry.id === selected.id)
    : -1;
  const mediaCount = media.length;
  const requiresCode = gallery.accessMode === "code_required";
  const publishDisabled =
    working ||
    uploader.uploading ||
    (!gallery.published &&
      ((requiresCode && gallery.codeStatus !== "set") || mediaCount === 0));

  return (
    <div className="gallery-stage">
      <header className="gallery-toolbar">
        <div className="gallery-toolbar__status">
          <span
            className={`gallery-status${
              gallery.published ? " gallery-status--published" : ""
            }`}
          >
            {gallery.published ? "Pubblicata" : "Bozza"}
          </span>
          <span className="gallery-toolbar__title" title={gallery.title}>
            {gallery.title}
          </span>
          <span className="gallery-toolbar__count">
            {mediaCount} elemento{mediaCount === 1 ? "" : "i"}
          </span>
          {requiresCode && gallery.codeStatus !== "set" ? (
            <span className="gallery-toolbar__warning" title="Imposta il codice">
              codice mancante
            </span>
          ) : null}
        </div>
        <div className="gallery-toolbar__actions">
          <button
            type="button"
            className="icon-button"
            onClick={openInfoModal}
            aria-label="Modifica info galleria"
            title="Info"
          >
            ✎
          </button>
          {requiresCode ? (
            <button
              type="button"
              className="icon-button"
              onClick={() => {
                setNewCode(gallerySecretsService.generateReadableCode("ATT"));
                setCodeModalOpen(true);
              }}
              aria-label="Codice galleria"
              title="Codice"
            >
              🔑
            </button>
          ) : null}
          {gallery.published ? (
            <button
              type="button"
              className="icon-button"
              onClick={handleSyncPosts}
              disabled={working || uploader.uploading}
              aria-label="Aggiorna post nel feed"
              title="Aggiorna feed"
            >
              ↻
            </button>
          ) : null}
          <button
            type="button"
            className={`button button--small ${
              gallery.published ? "button--ghost" : "button--primary"
            }`}
            onClick={handlePublishToggle}
            disabled={publishDisabled}
          >
            {gallery.published ? "Sospendi" : "Pubblica"}
          </button>
        </div>
      </header>

      {feedback ? (
        <div className="notice notice--info gallery-toast">
          <p>{feedback}</p>
        </div>
      ) : null}
      {error ? (
        <div className="notice notice--warning gallery-toast">
          <p>{error}</p>
        </div>
      ) : null}
      {uploader.pickerError ? (
        <div className="notice notice--warning gallery-toast">
          <p>{uploader.pickerError}</p>
        </div>
      ) : null}

      <GalleryGrid
        gallery={gallery}
        media={media}
        queue={uploader.queue}
        onPickPhotos={uploader.pickPhotos}
        onPickVideo={uploader.pickVideo}
        onSelectMedia={(item) => setSelected(item)}
        onCancelUpload={uploader.cancel}
        onRetryUpload={uploader.retry}
        onRemoveUpload={uploader.remove}
      />

      {selected ? (
        <MediaActionSheet
          media={selected}
          gallery={gallery}
          position={selectedPosition}
          total={sortedMedia.length}
          busy={working}
          onClose={() => setSelected(null)}
          onSetCover={() => void handleSetCover(selected)}
          onMove={(direction) => void handleMove(selected, direction)}
          onDelete={() => void handleDeleteMedia(selected)}
        />
      ) : null}

      {codeModalOpen ? (
        <AppModal
          title="Codice galleria"
          subtitle={
            gallery.codeStatus === "set"
              ? "Cambia il codice. Quello attuale smetterà di funzionare."
              : "Imposta il codice per pubblicare la galleria."
          }
          onClose={() => setCodeModalOpen(false)}
          size="compact"
        >
          <form className="stack" onSubmit={handleSetCode}>
            <label className="field">
              <span>Nuovo codice</span>
              <div className="inline-row">
                <input
                  type="text"
                  value={newCode}
                  onChange={(submitEvent) => setNewCode(submitEvent.target.value)}
                  minLength={4}
                  required
                  disabled={working}
                />
                <button
                  type="button"
                  className="button button--ghost button--small"
                  onClick={() =>
                    setNewCode(gallerySecretsService.generateReadableCode("ATT"))
                  }
                  disabled={working}
                >
                  Genera
                </button>
              </div>
              <small className="subtle-text">
                Salva subito il codice: per sicurezza non sarà più mostrato.
              </small>
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setCodeModalOpen(false)}
                disabled={working}
              >
                Annulla
              </button>
              <button
                type="submit"
                className="button button--primary"
                disabled={working || newCode.trim().length < 4}
              >
                {working ? "Salvo…" : "Imposta codice"}
              </button>
            </div>
          </form>
        </AppModal>
      ) : null}

      {infoModalOpen ? (
        <AppModal
          title="Info galleria"
          subtitle="Cambia titolo e descrizione mostrati ai partecipanti."
          onClose={() => setInfoModalOpen(false)}
          size="compact"
        >
          <form className="stack" onSubmit={handleSaveInfo}>
            <label className="field">
              <span>Titolo</span>
              <input
                type="text"
                value={editTitle}
                onChange={(submitEvent) => setEditTitle(submitEvent.target.value)}
                required
                disabled={savingInfo}
              />
            </label>
            <label className="field">
              <span>Descrizione</span>
              <textarea
                value={editDescription}
                onChange={(submitEvent) => setEditDescription(submitEvent.target.value)}
                rows={3}
                disabled={savingInfo}
              />
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setInfoModalOpen(false)}
                disabled={savingInfo}
              >
                Annulla
              </button>
              <button
                type="submit"
                className="button button--primary"
                disabled={savingInfo || !editTitle.trim()}
              >
                {savingInfo ? "Salvo…" : "Salva"}
              </button>
            </div>
            {onDeleted ? (
              <div className="form-actions form-actions--split">
                <button
                  type="button"
                  className="button button--ghost button--danger"
                  onClick={handleDeleteGallery}
                  disabled={savingInfo || working}
                >
                  Elimina galleria
                </button>
              </div>
            ) : null}
          </form>
        </AppModal>
      ) : null}
    </div>
  );
}
