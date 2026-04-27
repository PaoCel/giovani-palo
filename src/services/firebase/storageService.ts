import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from "firebase/storage";

import { storage } from "@/services/firebase/app";
import { slugify } from "@/utils/slugify";

interface UploadEventImageArgs {
  file: File;
  uploadedBy: string;
  stakeId: string;
  eventId?: string;
  previousPath?: string;
}

interface UploadStakeAssetImageArgs {
  file: File;
  uploadedBy: string;
  stakeId: string;
  assetKey: "minor-consent-example";
  previousPath?: string;
}

interface UploadParentConsentDocumentArgs {
  file: File;
  uploadedBy: string;
  stakeId: string;
  eventId: string;
  registrationId: string;
  previousPath?: string;
}

const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024;

function getFileExtension(fileName: string) {
  const parts = fileName.split(".");
  return parts.length > 1 ? parts.at(-1)?.toLowerCase() ?? "jpg" : "jpg";
}

function buildStoragePath({ file, uploadedBy, eventId, stakeId }: UploadEventImageArgs) {
  const extension = getFileExtension(file.name);
  const fileStem = slugify(file.name.replace(/\.[^.]+$/, "")) || "locandina";
  const folder = eventId
    ? `public/stakes/${stakeId}/activities/${eventId}`
    : `public/stakes/${stakeId}/drafts/${uploadedBy}`;
  return `${folder}/${Date.now()}-${fileStem}.${extension}`;
}

function buildStakeAssetPath({
  file,
  assetKey,
  stakeId,
}: UploadStakeAssetImageArgs) {
  const extension = getFileExtension(file.name);
  const fileStem = slugify(file.name.replace(/\.[^.]+$/, "")) || assetKey;
  return `public/stakes/${stakeId}/settings/${assetKey}/${Date.now()}-${fileStem}.${extension}`;
}

function buildParentConsentPath({
  file,
  stakeId,
  eventId,
  registrationId,
}: UploadParentConsentDocumentArgs) {
  const extension = getFileExtension(file.name);
  const fileStem =
    slugify(file.name.replace(/\.[^.]+$/, "")) || "autorizzazione-genitore";
  return `protected/stakes/${stakeId}/activities/${eventId}/parent-consents/${registrationId}/${Date.now()}-${fileStem}.${extension}`;
}

function validateImageFile(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Seleziona un file immagine valido.");
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error("L'immagine supera 8 MB. Riduci il file e riprova.");
  }
}

async function uploadImageAtPath(
  path: string,
  file: File,
  metadata: Record<string, string>,
  previousPath?: string,
) {
  validateImageFile(file);

  const fileReference = ref(storage, path);

  await uploadBytes(fileReference, file, {
    contentType: file.type || "image/jpeg",
    customMetadata: metadata,
  });

  if (previousPath && previousPath !== path) {
    await storageService.deleteFile(previousPath).catch(() => undefined);
  }

  return {
    path,
    url: await getDownloadURL(fileReference),
    name: file.name,
  };
}

export const storageService = {
  async uploadEventImage(args: UploadEventImageArgs) {
    if (!args.stakeId) {
      throw new Error("Serve lo stakeId per caricare la copertina.");
    }

    return uploadImageAtPath(
      buildStoragePath(args),
      args.file,
      {
        uploadedBy: args.uploadedBy,
        stakeId: args.stakeId,
        eventId: args.eventId ?? "",
      },
      args.previousPath,
    );
  },

  async uploadMinorConsentExampleImage(args: Omit<UploadStakeAssetImageArgs, "assetKey">) {
    if (!args.stakeId) {
      throw new Error("Serve lo stakeId per caricare l'esempio.");
    }

    return uploadImageAtPath(
      buildStakeAssetPath({
        ...args,
        assetKey: "minor-consent-example",
      }),
      args.file,
      {
        uploadedBy: args.uploadedBy,
        stakeId: args.stakeId,
        assetKey: "minor-consent-example",
      },
      args.previousPath,
    );
  },

  async uploadParentConsentDocument(args: UploadParentConsentDocumentArgs) {
    if (!args.stakeId || !args.eventId || !args.registrationId) {
      throw new Error("Servono attività e registrazione per caricare il consenso.");
    }

    return uploadImageAtPath(
      buildParentConsentPath(args),
      args.file,
      {
        uploadedBy: args.uploadedBy,
        stakeId: args.stakeId,
        eventId: args.eventId,
        registrationId: args.registrationId,
        assetKey: "parent-consent",
      },
      args.previousPath,
    );
  },

  async deleteFile(path: string) {
    if (!path) {
      return;
    }

    await deleteObject(ref(storage, path));
  },
};
