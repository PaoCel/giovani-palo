import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  MEDIA_LIMITS,
  deleteMediaFolder,
  uploadMediaResumable,
  type UploadHandle,
} from "@/services/firebase/galleryUploadService";
import { galleriesService } from "@/services/firestore/galleriesService";
import {
  buildImageDerivatives,
  captureVideoPoster,
} from "@/utils/imageCompression";
import { UploadDock } from "@/components/camp/UploadDock";
import { useAuth } from "@/hooks/useAuth";
import type { Gallery } from "@/types";

export type UploadItemMode = "image" | "video";
export type UploadItemStatus =
  | "queued"
  | "preparing"
  | "uploading"
  | "saving"
  | "done"
  | "error"
  | "cancelled";

export interface ManagedUploadItem {
  id: string;
  gallery: Gallery;
  /** Uid dell'utente che carica: deve combaciare con auth.uid (rules media). */
  uploadedByUid: string;
  file: File;
  mode: UploadItemMode;
  mediaId: string;
  progress: number;
  status: UploadItemStatus;
  error: string | null;
  /** false per i file scartati prima di partire (peso, tipo): "Riprova" non serve. */
  retryable: boolean;
  /** Errore di rete: si riprova da solo quando la connessione torna. */
  networkError: boolean;
  handle: UploadHandle | null;
  insertOrder: number;
  previewUrl: string | null;
}

interface UploadApi {
  /** Foto e video insieme, dal bottone unico: ogni file va nella sua coda. */
  pickMedia: (files: File[], gallery: Gallery, startOrder: number) => void;
  cancel: (id: string) => void;
  retry: (id: string) => void;
  remove: (id: string) => void;
}

interface UploadState {
  queue: ManagedUploadItem[];
  pickerError: string | null;
  clearPickerError: () => void;
}

// Due context separati: l'API è stabile (non provoca re-render dei consumatori
// come la galleria ad ogni tick di progresso); lo stato cambia spesso ma lo
// legge solo la dock di avanzamento.
const UploadApiContext = createContext<UploadApi | null>(null);
const UploadStateContext = createContext<UploadState | null>(null);

// Due caricamenti alla volta: su una rete debole trenta upload in parallelo
// vanno tutti in timeout insieme, uno o due arrivano in fondo.
const MAX_ACTIVE_UPLOADS = 2;
const MAX_FILES_PER_PICK = 30;
const ACTIVE_STATUSES: UploadItemStatus[] = ["preparing", "uploading", "saving"];

let itemCounter = 0;
function newItemId() {
  itemCounter += 1;
  return `up-${Date.now()}-${itemCounter}`;
}

function formatMegabytes(bytes: number) {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

const CLOSED_MESSAGE = "Caricamenti chiusi per questa attività.";
const NETWORK_MESSAGE = "Connessione persa. Riprovo appena torna la rete.";

function describeError(error: unknown): { message: string; network: boolean } {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: string }).code ?? "")
      : "";
  if (code === "storage/canceled") return { message: "Caricamento annullato.", network: false };
  if (code === "storage/unauthorized" || code === "permission-denied") {
    return { message: CLOSED_MESSAGE, network: false };
  }
  if (code === "storage/quota-exceeded") return { message: "Spazio finito.", network: false };
  if (
    code === "storage/retry-limit-exceeded" ||
    code === "storage/unknown" ||
    code === "unavailable" ||
    code === "deadline-exceeded" ||
    (typeof navigator !== "undefined" && navigator.onLine === false)
  ) {
    return { message: NETWORK_MESSAGE, network: true };
  }
  return {
    message: error instanceof Error && error.message ? error.message : "Caricamento non riuscito.",
    network: false,
  };
}

class CancelledUpload extends Error {
  constructor() {
    super("cancelled");
  }
}

function fileKey(file: File, galleryId: string) {
  return `${galleryId}:${file.name}:${file.size}:${file.lastModified}`;
}

/** Perché un file non può partire, prima ancora di caricarlo. */
function rejectReason(file: File): string | null {
  if (file.type.startsWith("image/")) {
    return file.size > MEDIA_LIMITS.imageMaxBytes
      ? `Foto troppo pesante: massimo ${formatMegabytes(MEDIA_LIMITS.imageMaxBytes)}.`
      : null;
  }
  if (file.type.startsWith("video/")) {
    return file.size > MEDIA_LIMITS.videoMaxBytes
      ? `Troppo pesante: massimo ${formatMegabytes(MEDIA_LIMITS.videoMaxBytes)}, circa 3 minuti.`
      : null;
  }
  return "Si possono caricare solo foto e video.";
}

function buildPreviewUrl(file: File): string | null {
  try {
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
}

export function UploadManagerProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  // Uid corrente sempre aggiornato via ref, così le callback restano stabili.
  const uidRef = useRef<string>("");
  uidRef.current = session?.firebaseUser.uid ?? "";

  // queueRef è la fonte di verità, aggiornata in modo sincrono: la coda
  // decide cosa far partire leggendola subito dopo una modifica, senza
  // aspettare il render. Lo state serve solo a ridisegnare la dock.
  const [queue, setQueue] = useState<ManagedUploadItem[]>([]);
  const queueRef = useRef<ManagedUploadItem[]>([]);
  const commitQueue = useCallback((next: ManagedUploadItem[]) => {
    queueRef.current = next;
    setQueue(next);
  }, []);
  const [pickerError, setPickerError] = useState<string | null>(null);
  // Id già avviati: la coda è asincrona, senza questo set due "pump" ravvicinati
  // farebbero partire lo stesso file due volte.
  const startedRef = useRef<Set<string>>(new Set());
  // Id annullati: runUpload lo controlla dopo ogni attesa, così un "Annulla"
  // toccato durante la preparazione non viene scavalcato dal passo successivo.
  const cancelledRef = useRef<Set<string>>(new Set());

  const updateItem = useCallback(
    (id: string, patch: Partial<ManagedUploadItem>) => {
      if (cancelledRef.current.has(id) && patch.status !== "cancelled" && patch.status !== "queued") {
        return;
      }
      commitQueue(
        queueRef.current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
      );
    },
    [commitQueue],
  );

  const removeItem = useCallback(
    (id: string) => {
      startedRef.current.delete(id);
      const target = queueRef.current.find((entry) => entry.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      commitQueue(queueRef.current.filter((entry) => entry.id !== id));
    },
    [commitQueue],
  );

  const uploading = queue.some((item) =>
    ["preparing", "uploading", "saving", "queued"].includes(item.status),
  );

  // Avviso prima di chiudere/ricaricare mentre un upload è in corso. Non serve
  // più quando si naviga soltanto tra le schermate dell'app: la coda vive qui,
  // sopra il router, quindi gli upload proseguono cambiando pagina.
  useEffect(() => {
    if (!uploading) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "Upload in corso, vuoi davvero abbandonare?";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [uploading]);

  useEffect(() => {
    return () => {
      for (const item of queueRef.current) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, []);

  const runUpload = useCallback(
    async (item: ManagedUploadItem) => {
      const { file, mediaId, mode, gallery } = item;
      const uploaded: boolean[] = [];
      const stopIfCancelled = () => {
        if (cancelledRef.current.has(item.id)) throw new CancelledUpload();
      };
      try {
        updateItem(item.id, { status: "preparing", progress: 5 });

        if (mode === "image") {
          const { optimized, thumbnail } = await buildImageDerivatives(file);
          stopIfCancelled();
          updateItem(item.id, { status: "uploading", progress: 15 });

          const optimizedHandle = uploadMediaResumable(
            optimized.blob,
            {
              stakeId: gallery.stakeId,
              galleryId: gallery.id,
              mediaId,
              kind: "optimized",
              filename: file.name,
              contentType: optimized.contentType,
              uploadedBy: item.uploadedByUid,
            },
            (percent) => {
              updateItem(item.id, {
                status: "uploading",
                progress: Math.min(80, 15 + Math.round(percent * 0.55)),
              });
            },
          );
          updateItem(item.id, { handle: optimizedHandle });
          const optimizedResult = await optimizedHandle.promise;
          uploaded.push(true);
          stopIfCancelled();

          const thumbHandle = uploadMediaResumable(
            thumbnail.blob,
            {
              stakeId: gallery.stakeId,
              galleryId: gallery.id,
              mediaId,
              kind: "thumb",
              filename: file.name,
              contentType: thumbnail.contentType,
              uploadedBy: item.uploadedByUid,
            },
            (percent) => {
              updateItem(item.id, {
                status: "uploading",
                progress: Math.min(95, 80 + Math.round(percent * 0.15)),
              });
            },
          );
          updateItem(item.id, { handle: thumbHandle });
          const thumbResult = await thumbHandle.promise;
          stopIfCancelled();

          updateItem(item.id, { status: "saving", progress: 97 });

          await galleriesService.createMediaDoc(gallery.stakeId, gallery.id, mediaId, {
            activityId: gallery.activityId ?? null,
            type: "image",
            storagePath: optimizedResult.path,
            storageUrl: optimizedResult.url,
            originalPath: null,
            originalUrl: null,
            optimizedPath: optimizedResult.path,
            optimizedUrl: optimizedResult.url,
            thumbnailPath: thumbResult.path,
            thumbnailUrl: thumbResult.url,
            posterPath: null,
            posterUrl: null,
            width: optimized.width,
            height: optimized.height,
            duration: null,
            order: item.insertOrder,
            caption: "",
            filename: file.name,
            contentType: file.type || "image/jpeg",
            sizeBytes: file.size,
            uploadedBy: item.uploadedByUid,
            status: "uploaded",
          });

          updateItem(item.id, { status: "done", progress: 100, handle: null });
          window.setTimeout(() => removeItem(item.id), 1400);
          return;
        }

        updateItem(item.id, { status: "uploading", progress: 8 });

        let posterUpload: { path: string; url: string } | null = null;
        let posterMeta: { width: number; height: number } | null = null;
        try {
          const poster = await Promise.race([
            captureVideoPoster(file),
            new Promise<null>((_, reject) =>
              window.setTimeout(() => reject(new Error("poster_timeout")), 6000),
            ),
          ]);
          if (poster) {
            const posterHandle = uploadMediaResumable(
              poster.blob,
              {
                stakeId: gallery.stakeId,
                galleryId: gallery.id,
                mediaId,
                kind: "poster",
                filename: file.name,
                contentType: poster.contentType,
                uploadedBy: item.uploadedByUid,
              },
              (percent) => {
                updateItem(item.id, {
                  status: "uploading",
                  progress: Math.min(14, 8 + Math.round(percent * 0.06)),
                });
              },
            );
            updateItem(item.id, { handle: posterHandle });
            posterUpload = await posterHandle.promise;
            uploaded.push(true);
            posterMeta = { width: poster.width, height: poster.height };
          }
        } catch {
          // poster opzionale
        }

        stopIfCancelled();
        updateItem(item.id, { status: "uploading", progress: 15 });

        const videoHandle = uploadMediaResumable(
          file,
          {
            stakeId: gallery.stakeId,
            galleryId: gallery.id,
            mediaId,
            kind: "original",
            filename: file.name,
            contentType: file.type || "video/mp4",
            uploadedBy: item.uploadedByUid,
          },
          (percent) => {
            updateItem(item.id, {
              status: "uploading",
              progress: Math.min(95, 15 + Math.round(percent * 0.8)),
            });
          },
        );
        updateItem(item.id, { handle: videoHandle });
        const videoResult = await videoHandle.promise;
        uploaded.push(true);
        stopIfCancelled();

        updateItem(item.id, { status: "saving", progress: 97 });

        await galleriesService.createMediaDoc(gallery.stakeId, gallery.id, mediaId, {
          activityId: gallery.activityId ?? null,
          type: "video",
          storagePath: videoResult.path,
          storageUrl: videoResult.url,
          originalPath: videoResult.path,
          originalUrl: videoResult.url,
          optimizedPath: null,
          optimizedUrl: null,
          thumbnailPath: posterUpload?.path ?? null,
          thumbnailUrl: posterUpload?.url ?? null,
          posterPath: posterUpload?.path ?? null,
          posterUrl: posterUpload?.url ?? null,
          width: posterMeta?.width ?? null,
          height: posterMeta?.height ?? null,
          duration: null,
          order: item.insertOrder,
          caption: "",
          filename: file.name,
          contentType: file.type || "video/mp4",
          sizeBytes: file.size,
          uploadedBy: item.uploadedByUid,
          status: "uploaded",
        });

        updateItem(item.id, { status: "done", progress: 100, handle: null });
        window.setTimeout(() => removeItem(item.id), 1400);
      } catch (caughtError) {
        const stillExists = queueRef.current.find((entry) => entry.id === item.id);
        if (!stillExists || cancelledRef.current.has(item.id)) {
          if (uploaded.length > 0) void deleteMediaFolder(gallery.stakeId, gallery.id, mediaId);
          return;
        }
        // File caricati senza il doc (galleria chiusa nel frattempo, rete
        // caduta al salvataggio): invisibili nell'app, quindi si tolgono.
        if (uploaded.length > 0) {
          void deleteMediaFolder(gallery.stakeId, gallery.id, mediaId);
        }
        const described = describeError(caughtError);
        updateItem(item.id, {
          status: "error",
          error: described.message,
          networkError: described.network,
          // Galleria chiusa: riprovare non serve, resta solo "Rimuovi".
          retryable: described.message !== CLOSED_MESSAGE,
          handle: null,
        });
      }
    },
    [removeItem, updateItem],
  );

  // Fa partire i file in coda finché ci sono posti liberi.
  const pump = useCallback(() => {
    const current = queueRef.current;
    let active = current.filter(
      (entry) =>
        ACTIVE_STATUSES.includes(entry.status) ||
        (entry.status === "queued" && startedRef.current.has(entry.id)),
    ).length;
    for (const entry of current) {
      if (active >= MAX_ACTIVE_UPLOADS) break;
      if (entry.status !== "queued" || startedRef.current.has(entry.id)) continue;
      startedRef.current.add(entry.id);
      active += 1;
      void runUpload(entry).finally(() => {
        startedRef.current.delete(entry.id);
        window.setTimeout(() => pumpRef.current(), 0);
      });
    }
  }, [runUpload]);
  const pumpRef = useRef(pump);
  pumpRef.current = pump;

  // Quando la rete torna, i file fermati da un errore di rete ripartono da soli.
  useEffect(() => {
    const onOnline = () => {
      const stalled = queueRef.current.filter(
        (entry) => entry.status === "error" && entry.networkError,
      );
      if (stalled.length === 0) return;
      for (const entry of stalled) {
        updateItem(entry.id, {
          status: "queued",
          error: null,
          networkError: false,
          progress: 0,
          handle: null,
          mediaId: galleriesService.reserveMediaId(entry.gallery.stakeId, entry.gallery.id),
        });
      }
      window.setTimeout(() => pumpRef.current(), 0);
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [updateItem]);

  const pickMedia = useCallback(
    (files: File[], gallery: Gallery, startOrder: number) => {
      setPickerError(null);
      if (!gallery || files.length === 0) return;
      if (files.length > MAX_FILES_PER_PICK) {
        setPickerError(`Massimo ${MAX_FILES_PER_PICK} file alla volta.`);
        return;
      }
      const known = new Set(
        queueRef.current
          .filter((entry) => entry.status !== "cancelled")
          .map((entry) => fileKey(entry.file, entry.gallery.id)),
      );
      const base = startOrder + queueRef.current.length;
      const newItems: ManagedUploadItem[] = [];
      for (const [offset, file] of files.entries()) {
        const key = fileKey(file, gallery.id);
        // Lo stesso file scelto due volte (doppio tocco, rullino riaperto).
        if (known.has(key)) continue;
        known.add(key);
        const reason = rejectReason(file);
        newItems.push({
          id: newItemId(),
          gallery,
          uploadedByUid: uidRef.current,
          file,
          mode: file.type.startsWith("video/") ? "video" : "image",
          mediaId: galleriesService.reserveMediaId(gallery.stakeId, gallery.id),
          progress: 0,
          status: reason ? "error" : "queued",
          error: reason,
          retryable: !reason,
          networkError: false,
          handle: null,
          insertOrder: base + offset,
          previewUrl: buildPreviewUrl(file),
        });
      }
      if (newItems.length === 0) return;
      commitQueue([...queueRef.current, ...newItems]);
      pumpRef.current();
    },
    [commitQueue],
  );

  const cancel = useCallback(
    async (id: string) => {
      const item = queueRef.current.find((entry) => entry.id === id);
      // Durante il salvataggio il doc sta per essere scritto: lì non si annulla
      // (la dock non mostra il bottone), si toglie poi dalla galleria.
      if (!item || item.status === "saving") return;
      cancelledRef.current.add(id);
      if (item.handle) item.handle.cancel();
      updateItem(id, { status: "cancelled", handle: null });
      await deleteMediaFolder(item.gallery.stakeId, item.gallery.id, item.mediaId);
    },
    [updateItem],
  );

  const retry = useCallback(
    (id: string) => {
      const item = queueRef.current.find((entry) => entry.id === id);
      if (!item || !item.retryable) return;
      if (item.status !== "error" && item.status !== "cancelled") return;
      cancelledRef.current.delete(id);
      updateItem(id, {
        status: "queued",
        error: null,
        networkError: false,
        progress: 0,
        handle: null,
        // Id nuovo: la cartella del tentativo fallito può essere già stata pulita.
        mediaId: galleriesService.reserveMediaId(item.gallery.stakeId, item.gallery.id),
      });
      window.setTimeout(() => pumpRef.current(), 0);
    },
    [updateItem],
  );

  const remove = useCallback(
    (id: string) => {
      const item = queueRef.current.find((entry) => entry.id === id);
      if (item && ACTIVE_STATUSES.includes(item.status)) cancelledRef.current.add(id);
      if (item?.handle) item.handle.cancel();
      removeItem(id);
    },
    [removeItem],
  );

  const api = useMemo<UploadApi>(
    () => ({ pickMedia, cancel, retry, remove }),
    [pickMedia, cancel, retry, remove],
  );

  const clearPickerError = useCallback(() => setPickerError(null), []);
  const state = useMemo<UploadState>(
    () => ({ queue, pickerError, clearPickerError }),
    [queue, pickerError, clearPickerError],
  );

  return (
    <UploadApiContext.Provider value={api}>
      <UploadStateContext.Provider value={state}>
        {children}
        <UploadDock />
      </UploadStateContext.Provider>
    </UploadApiContext.Provider>
  );
}

export function useUploadApi(): UploadApi {
  const ctx = useContext(UploadApiContext);
  if (!ctx) {
    throw new Error("useUploadApi deve essere usato dentro UploadManagerProvider");
  }
  return ctx;
}

export function useUploadState(): UploadState {
  const ctx = useContext(UploadStateContext);
  if (!ctx) {
    throw new Error("useUploadState deve essere usato dentro UploadManagerProvider");
  }
  return ctx;
}
