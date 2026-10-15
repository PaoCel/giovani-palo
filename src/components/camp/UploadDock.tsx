import { createPortal } from "react-dom";

import "@/styles/activityGallery.css";

import { AppIcon } from "@/components/AppIcon";
import { useUploadApi, useUploadState } from "@/app/providers/UploadManagerProvider";

const ACTIVE = new Set(["queued", "preparing", "uploading", "saving"]);

function progressLabel(status: string, progress: number) {
  if (status === "queued") return "In attesa";
  if (status === "preparing") return "Preparazione";
  if (status === "saving") return "Quasi fatto";
  return `In caricamento · ${progress}%`;
}

/**
 * Avanzamento dei caricamenti, visibile su ogni pagina: la coda vive sopra il
 * router, quindi si può cambiare schermata mentre carica.
 */
export function UploadDock() {
  const { queue, pickerError, clearPickerError } = useUploadState();
  const { cancel, retry, remove } = useUploadApi();

  const batch = queue.filter((item) => item.status !== "cancelled");
  const visible = queue.filter((item) => item.status !== "done");

  if (visible.length === 0 && !pickerError) return null;
  if (typeof document === "undefined") return null;

  const doneCount = batch.filter((item) => item.status === "done").length;
  const activeCount = batch.filter((item) => ACTIVE.has(item.status)).length;
  const totalProgress =
    batch.length === 0
      ? 0
      : Math.round(
          batch.reduce(
            (sum, item) => sum + (item.status === "done" ? 100 : item.status === "error" ? 0 : item.progress),
            0,
          ) / batch.length,
        );

  const dock = (
    <div className="media-dock" role="status" aria-live="polite">
      {pickerError ? (
        <div className="media-dock__toast">
          <span>{pickerError}</span>
          <button type="button" onClick={clearPickerError} aria-label="Chiudi">
            <AppIcon name="x" />
          </button>
        </div>
      ) : null}

      {visible.length > 0 ? (
        <div className="media-dock__panel">
          <div className="media-dock__head">
            <strong>
              {activeCount > 0
                ? `Caricamento ${Math.min(doneCount + 1, batch.length)} di ${batch.length}`
                : "Caricamenti da rivedere"}
            </strong>
            {activeCount > 0 ? <span>Puoi cambiare pagina</span> : null}
          </div>
          {activeCount > 0 ? (
            <span className="media-dock__bar">
              <span style={{ width: `${totalProgress}%` }} />
            </span>
          ) : null}

          <ul className="media-dock__list">
            {visible.slice(0, 4).map((item) => (
              <li key={item.id} className="media-dock__item">
                <span className="media-dock__thumb">
                  {item.previewUrl && item.mode === "image" ? (
                    <img src={item.previewUrl} alt="" />
                  ) : (
                    <AppIcon name={item.mode === "video" ? "play" : "camera"} />
                  )}
                </span>
                <span className="media-dock__info">
                  <b>
                    {item.mode === "video"
                      ? `Video · ${Math.round(item.file.size / (1024 * 1024))} MB`
                      : "Foto"}
                  </b>
                  {item.status === "error" ? (
                    <span className="media-dock__err">{item.error ?? "Caricamento non riuscito."}</span>
                  ) : item.status === "cancelled" ? (
                    <span className="media-dock__err">Annullato</span>
                  ) : (
                    <span>{progressLabel(item.status, item.progress)}</span>
                  )}
                </span>
                {item.status === "error" || item.status === "cancelled" ? (
                  item.retryable ? (
                    <button type="button" className="media-dock__link" onClick={() => retry(item.id)}>
                      Riprova
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="media-dock__link media-dock__link--muted"
                      onClick={() => remove(item.id)}
                    >
                      Rimuovi
                    </button>
                  )
                ) : item.status === "saving" ? null : (
                  <button
                    type="button"
                    className="media-dock__link media-dock__link--muted"
                    onClick={() => void cancel(item.id)}
                  >
                    Annulla
                  </button>
                )}
              </li>
            ))}
          </ul>

          {visible.length > 4 ? (
            <p className="media-dock__more">+{visible.length - 4} altri</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  return createPortal(dock, document.body);
}
