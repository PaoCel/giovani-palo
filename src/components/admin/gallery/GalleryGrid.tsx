import { useRef, type ChangeEvent } from "react";

import type { Gallery, GalleryMedia } from "@/types";
import type { UploadQueueItem } from "@/components/admin/gallery/useGalleryUploader";

interface GalleryGridProps {
  gallery: Gallery;
  media: GalleryMedia[];
  queue: UploadQueueItem[];
  onPickPhotos: (files: File[]) => void;
  onPickVideo: (files: File[]) => void;
  onSelectMedia: (media: GalleryMedia) => void;
  onCancelUpload: (id: string) => void;
  onRetryUpload: (id: string) => void;
  onRemoveUpload: (id: string) => void;
}

export function GalleryGrid({
  gallery,
  media,
  queue,
  onPickPhotos,
  onPickVideo,
  onSelectMedia,
  onCancelUpload,
  onRetryUpload,
  onRemoveUpload,
}: GalleryGridProps) {
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    onPickPhotos(files);
  }

  function handleVideoChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    onPickVideo(files);
  }

  const sortedMedia = [...media].sort((a, b) => a.order - b.order);
  const activeQueue = queue.filter((item) => item.status !== "done");

  return (
    <>
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={handlePhotoChange}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        multiple
        hidden
        onChange={handleVideoChange}
      />

      <div className="gallery-tiles">
        <button
          type="button"
          className="gallery-tile gallery-tile--add"
          onClick={() => photoInputRef.current?.click()}
          aria-label="Aggiungi foto"
        >
          <span className="gallery-tile__plus" aria-hidden="true">+</span>
          <span className="gallery-tile__label">Foto</span>
        </button>
        <button
          type="button"
          className="gallery-tile gallery-tile--add gallery-tile--add-secondary"
          onClick={() => videoInputRef.current?.click()}
          aria-label="Aggiungi video"
        >
          <span className="gallery-tile__plus" aria-hidden="true">+</span>
          <span className="gallery-tile__label">Video</span>
        </button>

        {activeQueue.map((item) => (
          <div
            key={item.id}
            className={`gallery-tile gallery-tile--upload gallery-tile--upload-${item.status}`}
          >
            {item.previewUrl ? (
              <img src={item.previewUrl} alt="" />
            ) : (
              <div className="gallery-tile__placeholder">
                {item.mode === "video" ? "▶" : "◇"}
              </div>
            )}
            <div className="gallery-tile__overlay">
              {item.status === "error" || item.status === "cancelled" ? (
                <div className="gallery-tile__error">
                  <span>{item.status === "error" ? "Errore" : "Annullato"}</span>
                  <div className="gallery-tile__error-actions">
                    <button
                      type="button"
                      className="gallery-tile__icon-btn"
                      onClick={() => onRetryUpload(item.id)}
                      aria-label="Riprova"
                    >
                      ↻
                    </button>
                    <button
                      type="button"
                      className="gallery-tile__icon-btn"
                      onClick={() => onRemoveUpload(item.id)}
                      aria-label="Rimuovi"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="gallery-tile__progress-ring">
                    <span>{item.progress}%</span>
                  </div>
                  <button
                    type="button"
                    className="gallery-tile__icon-btn gallery-tile__icon-btn--top-right"
                    onClick={() => onCancelUpload(item.id)}
                    aria-label="Annulla upload"
                  >
                    ×
                  </button>
                </>
              )}
            </div>
          </div>
        ))}

        {sortedMedia.map((item) => {
          const isCover = gallery.coverMediaId === item.id;
          const previewUrl =
            item.thumbnailUrl ?? item.optimizedUrl ?? item.posterUrl ?? item.storageUrl ?? "";
          return (
            <button
              key={item.id}
              type="button"
              className={`gallery-tile${isCover ? " is-cover" : ""}`}
              onClick={() => onSelectMedia(item)}
            >
              {previewUrl ? (
                <img src={previewUrl} alt={item.filename || "Media"} loading="lazy" />
              ) : (
                <div className="gallery-tile__placeholder">{item.type === "video" ? "▶" : "◇"}</div>
              )}
              {item.type === "video" ? (
                <span className="gallery-tile__badge">▶</span>
              ) : null}
              {isCover ? (
                <span className="gallery-tile__cover">★</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </>
  );
}
