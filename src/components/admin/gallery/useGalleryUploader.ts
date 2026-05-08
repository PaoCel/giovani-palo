import { useCallback, useEffect, useRef, useState } from "react";

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
import type { Gallery, GalleryMedia } from "@/types";

export type UploadItemMode = "image" | "video";
export type UploadItemStatus =
  | "queued"
  | "preparing"
  | "uploading"
  | "saving"
  | "done"
  | "error"
  | "cancelled";

export interface UploadQueueItem {
  id: string;
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

interface UseUploaderArgs {
  gallery: Gallery | null;
  uploadedBy: string;
  startOrder: number;
  onUploaded: (media: GalleryMedia) => void;
}

const ACCEPTED_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

function newItemId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

export function useGalleryUploader({
  gallery,
  uploadedBy,
  startOrder,
  onUploaded,
}: UseUploaderArgs) {
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const queueRef = useRef<UploadQueueItem[]>([]);
  queueRef.current = queue;

  const [pickerError, setPickerError] = useState<string | null>(null);

  const updateItem = useCallback(
    (id: string, patch: Partial<UploadQueueItem>) => {
      setQueue((prev) => prev.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
    },
    [],
  );

  const removeItem = useCallback((id: string) => {
    setQueue((prev) => {
      const target = prev.find((entry) => entry.id === id);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((entry) => entry.id !== id);
    });
  }, []);

  const uploading = queue.some((item) =>
    ["preparing", "uploading", "saving", "queued"].includes(item.status),
  );

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
      // Revoke any leftover preview blobs on unmount.
      for (const item of queueRef.current) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, []);

  const startUpload = useCallback(
    async (item: UploadQueueItem) => {
      if (!gallery) return;
      const { file, mediaId, mode } = item;
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
              uploadedBy,
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
              uploadedBy,
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

          const created = await galleriesService.createMediaDoc(
            gallery.stakeId,
            gallery.id,
            mediaId,
            {
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
              uploadedBy,
              status: "uploaded",
            },
          );

          updateItem(item.id, { status: "done", progress: 100, handle: null });
          onUploaded(created);
          window.setTimeout(() => removeItem(item.id), 700);
          return;
        }

        // Video flow — passiamo subito a "uploading" in modo che la UI non
        // resti bloccata sul 5% di "preparing" se la cattura del poster
        // (best-effort) è lenta o fallisce.
        updateItem(item.id, { status: "uploading", progress: 8 });

        let posterUpload: { path: string; url: string } | null = null;
        let posterMeta: { width: number; height: number } | null = null;
        try {
          // Hard timeout 6s sull'intera cattura poster: se il browser non
          // riesce a fare seek/draw in tempo (Safari iOS, codec esotici),
          // saltiamo il poster e procediamo con l'upload del video.
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
                uploadedBy,
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
          // poster optional — proseguiamo comunque
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
            uploadedBy,
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

        const created = await galleriesService.createMediaDoc(
          gallery.stakeId,
          gallery.id,
          mediaId,
          {
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
            uploadedBy,
            status: "uploaded",
          },
        );

        updateItem(item.id, { status: "done", progress: 100, handle: null });
        onUploaded(created);
        window.setTimeout(() => removeItem(item.id), 700);
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
    [gallery, onUploaded, removeItem, updateItem, uploadedBy],
  );

  function buildPreviewUrl(file: File): string | null {
    try {
      return URL.createObjectURL(file);
    } catch {
      return null;
    }
  }

  const pickPhotos = useCallback(
    (files: File[]) => {
      if (!gallery) return;
      setPickerError(null);
      if (files.length === 0) return;
      if (files.length > MEDIA_LIMITS.imagePerBatch) {
        setPickerError(
          `Massimo ${MEDIA_LIMITS.imagePerBatch} foto alla volta.`,
        );
        return;
      }

      const newItems: UploadQueueItem[] = [];
      const baseOrder = startOrder + queueRef.current.length;
      for (const [offset, file] of files.entries()) {
        if (!file.type.startsWith("image/")) {
          setPickerError(`Tipo non supportato: ${file.name}.`);
          return;
        }
        if (file.size > MEDIA_LIMITS.imageMaxBytes) {
          setPickerError(`${file.name} troppo pesante.`);
          return;
        }
        const mediaId = galleriesService.reserveMediaId(gallery.stakeId, gallery.id);
        newItems.push({
          id: newItemId(),
          file,
          mode: "image",
          mediaId,
          progress: 0,
          status: "queued",
          error: null,
          handle: null,
          insertOrder: baseOrder + offset,
          previewUrl: buildPreviewUrl(file),
        });
      }

      setQueue((prev) => [...prev, ...newItems]);
      for (const item of newItems) {
        void startUpload(item);
      }
    },
    [gallery, startOrder, startUpload],
  );

  const pickVideo = useCallback(
    (files: File[]) => {
      if (!gallery) return;
      setPickerError(null);
      if (files.length === 0) return;
      if (files.length > MEDIA_LIMITS.videoPerBatch) {
        setPickerError("Carica un video alla volta.");
        return;
      }
      const file = files[0];
      if (!ACCEPTED_VIDEO_TYPES.has(file.type) && !file.type.startsWith("video/")) {
        setPickerError(`Formato video non supportato.`);
        return;
      }
      const mediaId = galleriesService.reserveMediaId(gallery.stakeId, gallery.id);
      const item: UploadQueueItem = {
        id: newItemId(),
        file,
        mode: "video",
        mediaId,
        progress: 0,
        status: "queued",
        error: null,
        handle: null,
        insertOrder: startOrder + queueRef.current.length,
        previewUrl: buildPreviewUrl(file),
      };
      setQueue((prev) => [...prev, item]);
      void startUpload(item);
    },
    [gallery, startOrder, startUpload],
  );

  const cancel = useCallback(
    async (id: string) => {
      const item = queueRef.current.find((entry) => entry.id === id);
      if (!item || !gallery) return;
      if (item.handle) item.handle.cancel();
      updateItem(id, { status: "cancelled", handle: null });
      // Best-effort cleanup of any partial upload at known path prefix.
      await deleteMediaPath(
        `protected/stakes/${gallery.stakeId}/galleries/${gallery.id}/media/${item.mediaId}/`,
      );
    },
    [gallery, updateItem],
  );

  const retry = useCallback(
    (id: string) => {
      const item = queueRef.current.find((entry) => entry.id === id);
      if (!item) return;
      if (item.status !== "error" && item.status !== "cancelled") return;
      const next: UploadQueueItem = {
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

  return {
    queue,
    uploading,
    pickerError,
    clearPickerError: () => setPickerError(null),
    pickPhotos,
    pickVideo,
    cancel,
    retry,
    remove,
  };
}
