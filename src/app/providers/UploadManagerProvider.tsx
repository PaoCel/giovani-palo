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
  uploadMediaResumable,
  deleteMediaPath,
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
  handle: UploadHandle | null;
  insertOrder: number;
  previewUrl: string | null;
}

interface UploadApi {
  pickPhotos: (files: File[], gallery: Gallery, startOrder: number) => void;
  pickVideo: (files: File[], gallery: Gallery, startOrder: number) => void;
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
// come CampGallery ad ogni tick di progresso); lo stato cambia spesso ma lo
// legge solo la dock di avanzamento.
const UploadApiContext = createContext<UploadApi | null>(null);
const UploadStateContext = createContext<UploadState | null>(null);

const ACCEPTED_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

let itemCounter = 0;
function newItemId() {
  itemCounter += 1;
  return `up-${Date.now()}-${itemCounter}`;
}

function describeError(error: unknown) {
  if (!error) return "Errore sconosciuto.";
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: string }).code ?? "";
    if (code === "storage/canceled") return "Upload annullato.";
    if (code === "storage/unauthorized") return "Permesso negato.";
    if (code === "storage/quota-exceeded") return "Spazio finito.";
    if (code === "storage/retry-limit-exceeded") return "Rete instabile.";
  }
  return error instanceof Error ? error.message : "Errore upload.";
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

  const [queue, setQueue] = useState<ManagedUploadItem[]>([]);
  const queueRef = useRef<ManagedUploadItem[]>([]);
  queueRef.current = queue;
  const [pickerError, setPickerError] = useState<string | null>(null);

  const updateItem = useCallback((id: string, patch: Partial<ManagedUploadItem>) => {
    setQueue((prev) => prev.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  }, []);

  const removeItem = useCallback((id: string) => {
    setQueue((prev) => {
      const target = prev.find((entry) => entry.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((entry) => entry.id !== id);
    });
  }, []);

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

  const startUpload = useCallback(
    async (item: ManagedUploadItem) => {
      const { file, mediaId, mode, gallery } = item;
      try {
        updateItem(item.id, { status: "preparing", progress: 5 });

        if (mode === "image") {
          const { optimized, thumbnail } = await buildImageDerivatives(file);
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
            posterMeta = { width: poster.width, height: poster.height };
          }
        } catch {
          // poster opzionale
        }

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
        if (!stillExists || stillExists.status === "cancelled") return;
        updateItem(item.id, {
          status: "error",
          error: describeError(caughtError),
          handle: null,
        });
      }
    },
    [removeItem, updateItem],
  );

  const pickPhotos = useCallback(
    (files: File[], gallery: Gallery, startOrder: number) => {
      setPickerError(null);
      if (!gallery || files.length === 0) return;
      if (files.length > MEDIA_LIMITS.imagePerBatch) {
        setPickerError(`Massimo ${MEDIA_LIMITS.imagePerBatch} foto alla volta.`);
        return;
      }
      const newItems: ManagedUploadItem[] = [];
      const base = startOrder + queueRef.current.length;
      for (const [offset, file] of files.entries()) {
        if (!file.type.startsWith("image/")) {
          setPickerError(`Tipo non supportato: ${file.name}.`);
          return;
        }
        if (file.size > MEDIA_LIMITS.imageMaxBytes) {
          setPickerError(`${file.name} troppo pesante.`);
          return;
        }
        newItems.push({
          id: newItemId(),
          gallery,
          uploadedByUid: uidRef.current,
          file,
          mode: "image",
          mediaId: galleriesService.reserveMediaId(gallery.stakeId, gallery.id),
          progress: 0,
          status: "queued",
          error: null,
          handle: null,
          insertOrder: base + offset,
          previewUrl: buildPreviewUrl(file),
        });
      }
      setQueue((prev) => [...prev, ...newItems]);
      for (const item of newItems) void startUpload(item);
    },
    [startUpload],
  );

  const pickVideo = useCallback(
    (files: File[], gallery: Gallery, startOrder: number) => {
      setPickerError(null);
      if (!gallery || files.length === 0) return;
      if (files.length > MEDIA_LIMITS.videoPerBatch) {
        setPickerError(`Massimo ${MEDIA_LIMITS.videoPerBatch} video alla volta.`);
        return;
      }
      const valid: File[] = [];
      for (const file of files) {
        if (!ACCEPTED_VIDEO_TYPES.has(file.type) && !file.type.startsWith("video/")) {
          setPickerError(`Formato video non supportato per "${file.name}".`);
          continue;
        }
        valid.push(file);
      }
      if (valid.length === 0) return;
      const base = startOrder + queueRef.current.length;
      const items: ManagedUploadItem[] = valid.map((file, index) => ({
        id: newItemId(),
        gallery,
        uploadedByUid: uidRef.current,
        file,
        mode: "video",
        mediaId: galleriesService.reserveMediaId(gallery.stakeId, gallery.id),
        progress: 0,
        status: "queued",
        error: null,
        handle: null,
        insertOrder: base + index,
        previewUrl: buildPreviewUrl(file),
      }));
      setQueue((prev) => [...prev, ...items]);
      for (const item of items) void startUpload(item);
    },
    [startUpload],
  );

  const cancel = useCallback(
    async (id: string) => {
      const item = queueRef.current.find((entry) => entry.id === id);
      if (!item) return;
      if (item.handle) item.handle.cancel();
      updateItem(id, { status: "cancelled", handle: null });
      await deleteMediaPath(
        `protected/stakes/${item.gallery.stakeId}/galleries/${item.gallery.id}/media/${item.mediaId}/`,
      ).catch(() => undefined);
    },
    [updateItem],
  );

  const retry = useCallback(
    (id: string) => {
      const item = queueRef.current.find((entry) => entry.id === id);
      if (!item || (item.status !== "error" && item.status !== "cancelled")) return;
      const next: ManagedUploadItem = {
        ...item,
        status: "queued",
        error: null,
        progress: 0,
        handle: null,
      };
      updateItem(id, next);
      void startUpload(next);
    },
    [startUpload, updateItem],
  );

  const remove = useCallback(
    (id: string) => {
      const item = queueRef.current.find((entry) => entry.id === id);
      if (item?.handle) item.handle.cancel();
      removeItem(id);
    },
    [removeItem],
  );

  const api = useMemo<UploadApi>(
    () => ({ pickPhotos, pickVideo, cancel, retry, remove }),
    [pickPhotos, pickVideo, cancel, retry, remove],
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
