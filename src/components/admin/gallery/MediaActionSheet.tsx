import { useEffect } from "react";

import type { Gallery, GalleryMedia } from "@/types";

interface MediaActionSheetProps {
  media: GalleryMedia;
  gallery: Gallery;
  position: number;
  total: number;
  busy?: boolean;
  onClose: () => void;
  onSetCover: () => void;
  onMove: (direction: "up" | "down") => void;
  onDelete: () => void;
}

export function MediaActionSheet({
  media,
  gallery,
  position,
  total,
  busy,
  onClose,
  onSetCover,
  onMove,
  onDelete,
}: MediaActionSheetProps) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const isCover = gallery.coverMediaId === media.id;
  const isFirst = position === 0;
  const isLast = position === total - 1;

  return (
    <div
      className="media-sheet"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="media-sheet__panel"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="media-sheet__preview">
          {media.type === "image" ? (
            <img
              src={media.optimizedUrl ?? media.thumbnailUrl ?? media.storageUrl ?? ""}
              alt={media.filename || "Media"}
            />
          ) : media.posterUrl || media.thumbnailUrl ? (
            <img
              src={media.posterUrl ?? media.thumbnailUrl ?? ""}
              alt={media.filename || "Video"}
            />
          ) : (
            <div className="media-sheet__placeholder">▶ video</div>
          )}
        </div>

        <ul className="media-sheet__actions">
          <li>
            <button
              type="button"
              className="media-sheet__action"
              onClick={() => {
                onSetCover();
                onClose();
              }}
              disabled={busy || isCover}
            >
              <span className="media-sheet__icon">★</span>
              <span>{isCover ? "Cover attuale" : "Imposta come cover"}</span>
            </button>
          </li>
          <li>
            <button
              type="button"
              className="media-sheet__action"
              onClick={() => {
                onMove("up");
                onClose();
              }}
              disabled={busy || isFirst}
            >
              <span className="media-sheet__icon">↑</span>
              <span>Sposta avanti</span>
            </button>
          </li>
          <li>
            <button
              type="button"
              className="media-sheet__action"
              onClick={() => {
                onMove("down");
                onClose();
              }}
              disabled={busy || isLast}
            >
              <span className="media-sheet__icon">↓</span>
              <span>Sposta dopo</span>
            </button>
          </li>
          <li>
            <button
              type="button"
              className="media-sheet__action media-sheet__action--danger"
              onClick={() => {
                onDelete();
                onClose();
              }}
              disabled={busy}
            >
              <span className="media-sheet__icon">×</span>
              <span>Elimina</span>
            </button>
          </li>
        </ul>

        <button
          type="button"
          className="media-sheet__cancel"
          onClick={onClose}
        >
          Chiudi
        </button>
      </div>
    </div>
  );
}
