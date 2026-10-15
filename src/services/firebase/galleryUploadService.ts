import {
  deleteObject,
  getDownloadURL,
  listAll,
  ref as storageRef,
  uploadBytesResumable,
  type UploadTask,
} from "firebase/storage";

import { storage } from "@/services/firebase/app";
import { slugify } from "@/utils/slugify";

export type UploadKind = "original" | "optimized" | "thumb" | "poster";

export interface UploadHandle {
  promise: Promise<{ path: string; url: string }>;
  cancel: () => void;
  pause: () => void;
  resume: () => void;
}

interface BuildPathArgs {
  stakeId: string;
  galleryId: string;
  mediaId: string;
  kind: UploadKind;
  filename: string;
  contentType: string;
}

export const MEDIA_LIMITS = {
  imagePerBatch: 30,
  // Nessun limite pratico al numero di video per batch: l'admin ne carica
  // quanti gliene servono. Lo Storage tiene la coda con resumable upload.
  videoPerBatch: 100,
  imageMaxBytes: 25 * 1024 * 1024,
  // Uguale al tetto di storage.rules per chi non è admin: niente transcodifica,
  // quindi il limite è sul peso (circa 3 minuti di video 1080p da telefono).
  videoMaxBytes: 300 * 1024 * 1024,
};

function getExtension(filename: string, contentType: string) {
  if (filename.includes(".")) {
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext) return ext;
  }
  if (contentType.startsWith("video/")) return "mp4";
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

export function buildMediaStoragePath(args: BuildPathArgs): string {
  const ext = getExtension(args.filename, args.contentType);
  const stem = slugify(args.filename.replace(/\.[^.]+$/, "")) || args.kind;
  return `protected/stakes/${args.stakeId}/galleries/${args.galleryId}/media/${args.mediaId}/${args.kind}-${Date.now()}-${stem}.${ext}`;
}

export function uploadMediaResumable(
  blob: Blob,
  args: BuildPathArgs & { uploadedBy: string },
  onProgress?: (percent: number) => void,
): UploadHandle {
  const path = buildMediaStoragePath(args);
  const reference = storageRef(storage, path);
  const task: UploadTask = uploadBytesResumable(reference, blob, {
    contentType: args.contentType || (blob.type || "application/octet-stream"),
    customMetadata: {
      uploadedBy: args.uploadedBy,
      stakeId: args.stakeId,
      galleryId: args.galleryId,
      mediaId: args.mediaId,
      kind: args.kind,
    },
  });

  const promise = new Promise<{ path: string; url: string }>((resolve, reject) => {
    task.on(
      "state_changed",
      (snapshot) => {
        if (onProgress && snapshot.totalBytes > 0) {
          onProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100));
        }
      },
      (error) => reject(error),
      () => {
        getDownloadURL(reference)
          .then((url) => resolve({ path, url }))
          .catch(reject);
      },
    );
  });

  return {
    promise,
    cancel: () => {
      try {
        task.cancel();
      } catch {
        // ignore — upload may already be finished
      }
    },
    pause: () => {
      try {
        task.pause();
      } catch {
        // ignore
      }
    },
    resume: () => {
      try {
        task.resume();
      } catch {
        // ignore
      }
    },
  };
}

export async function deleteMediaPath(path: string): Promise<void> {
  if (!path) return;
  try {
    await deleteObject(storageRef(storage, path));
  } catch {
    // ignore — already deleted
  }
}

/** Cartella Storage di un media: tutte le sue varianti (originale, ottimizzata, miniatura, poster). */
export function mediaFolderPath(stakeId: string, galleryId: string, mediaId: string) {
  return `protected/stakes/${stakeId}/galleries/${galleryId}/media/${mediaId}`;
}

/**
 * Cancella tutti i file di un media. `deleteObject` lavora su un file solo:
 * passargli la cartella falliva in silenzio e lasciava i file nel bucket.
 */
export async function deleteMediaFolder(
  stakeId: string,
  galleryId: string,
  mediaId: string,
): Promise<void> {
  try {
    const listing = await listAll(storageRef(storage, mediaFolderPath(stakeId, galleryId, mediaId)));
    await Promise.all(listing.items.map((item) => deleteObject(item).catch(() => undefined)));
  } catch {
    // ignore — cartella già vuota o non leggibile
  }
}
