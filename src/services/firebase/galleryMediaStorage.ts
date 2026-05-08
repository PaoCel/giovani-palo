import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from "firebase/storage";

import { storage } from "@/services/firebase/app";
import { slugify } from "@/utils/slugify";

const MAX_GALLERY_IMAGE_BYTES = 12 * 1024 * 1024;

interface UploadGalleryMediaArgs {
  file: File;
  uploadedBy: string;
  stakeId: string;
  galleryId: string;
  kind: "original" | "thumb" | "poster" | "optimized";
}

function getExtension(file: File) {
  const parts = file.name.split(".");
  if (parts.length <= 1) return file.type.startsWith("video/") ? "mp4" : "jpg";
  return parts.at(-1)?.toLowerCase() ?? "jpg";
}

function buildPath(args: UploadGalleryMediaArgs, mediaIdLike: string) {
  const ext = getExtension(args.file);
  const stem = slugify(args.file.name.replace(/\.[^.]+$/, "")) || "media";
  return `protected/stakes/${args.stakeId}/galleries/${args.galleryId}/${mediaIdLike}/${args.kind}-${Date.now()}-${stem}.${ext}`;
}

function validateMediaFile(file: File) {
  if (file.type.startsWith("video/")) {
    // Nessun cap: i video grandi possono andare oltre i 256 MB.
    return;
  }
  if (file.type.startsWith("image/")) {
    if (file.size > MAX_GALLERY_IMAGE_BYTES) {
      throw new Error("L'immagine supera 12 MB.");
    }
    return;
  }
  throw new Error("Formato non supportato. Usa immagine o video.");
}

export const galleryMediaStorage = {
  async upload(args: UploadGalleryMediaArgs & { mediaId: string }) {
    if (!args.stakeId || !args.galleryId) {
      throw new Error("Dati galleria mancanti.");
    }
    validateMediaFile(args.file);
    const path = buildPath(args, args.mediaId);
    const reference = storageRef(storage, path);
    await uploadBytes(reference, args.file, {
      contentType: args.file.type || "application/octet-stream",
      customMetadata: {
        uploadedBy: args.uploadedBy,
        stakeId: args.stakeId,
        galleryId: args.galleryId,
        kind: args.kind,
      },
    });
    const url = await getDownloadURL(reference);
    return { path, url };
  },

  async deleteFile(path: string) {
    if (!path) return;
    await deleteObject(storageRef(storage, path)).catch(() => undefined);
  },
};
