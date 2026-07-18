import { createPortal } from "react-dom";

import { useUploadApi, useUploadState } from "@/app/providers/UploadManagerProvider";

const ACTIVE = new Set(["queued", "preparing", "uploading", "saving"]);

export function UploadDock() {
  const { queue, pickerError, clearPickerError } = useUploadState();
  const { cancel, retry, remove } = useUploadApi();

  const visible = queue.filter(
    (item) => ACTIVE.has(item.status) || item.status === "error" || item.status === "cancelled",
  );

  if (visible.length === 0 && !pickerError) return null;
  if (typeof document === "undefined") return null;

  const activeCount = visible.filter((item) => ACTIVE.has(item.status)).length;

  const dock = (
    <div className="upload-dock" role="status" aria-live="polite">
      {pickerError ? (
        <div className="upload-dock__toast">
          <span>{pickerError}</span>
          <button type="button" onClick={clearPickerError} aria-label="Chiudi">
            ×
          </button>
        </div>
      ) : null}

      {visible.length > 0 ? (
        <div className="upload-dock__panel">
          <div className="upload-dock__head">
            <span className="upload-dock__spinner" aria-hidden="true" />
            <strong>
              {activeCount > 0
                ? `Caricamento in corso (${activeCount})`
                : "Caricamenti da rivedere"}
            </strong>
          </div>

          <ul className="upload-dock__list">
            {visible.slice(0, 4).map((item) => (
              <li key={item.id} className="upload-dock__item">
                <span className="upload-dock__thumb">
                  {item.previewUrl ? (
                    <img src={item.previewUrl} alt="" />
                  ) : (
                    <span aria-hidden="true">{item.mode === "video" ? "▶" : "◇"}</span>
                  )}
                </span>

                <span className="upload-dock__info">
                  <span className="upload-dock__name">{item.file.name}</span>
                  {item.status === "error" ? (
                    <span className="upload-dock__err">{item.error ?? "Errore"}</span>
                  ) : item.status === "cancelled" ? (
                    <span className="upload-dock__err">Annullato</span>
                  ) : (
                    <span className="upload-dock__bar">
                      <span
                        className="upload-dock__bar-fill"
                        style={{ width: `${item.progress}%` }}
                      />
                    </span>
                  )}
                </span>

                {item.status === "error" || item.status === "cancelled" ? (
                  <span className="upload-dock__actions">
                    <button type="button" onClick={() => retry(item.id)} aria-label="Riprova">
                      ↻
                    </button>
                    <button type="button" onClick={() => remove(item.id)} aria-label="Rimuovi">
                      ×
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="upload-dock__cancel"
                    onClick={() => cancel(item.id)}
                    aria-label="Annulla"
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>

          {visible.length > 4 ? (
            <p className="upload-dock__more">+{visible.length - 4} altri</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  return createPortal(dock, document.body);
}
