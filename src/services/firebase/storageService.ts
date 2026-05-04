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

interface UploadConsentSignatureArgs {
  blob: Blob;
  uploadedBy: string;
  stakeId: string;
  eventId: string;
  registrationId: string;
  previousPath?: string;
}

interface UploadParentIdDocumentArgs {
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

function buildSignaturePath({
  stakeId,
  eventId,
  registrationId,
}: UploadConsentSignatureArgs) {
  return `protected/stakes/${stakeId}/activities/${eventId}/signatures/${registrationId}/${Date.now()}-firma.png`;
}

function buildParentIdPath({
  file,
  stakeId,
  eventId,
  registrationId,
}: UploadParentIdDocumentArgs) {
  const extension = getFileExtension(file.name);
  const fileStem = slugify(file.name.replace(/\.[^.]+$/, "")) || "documento-genitore";
  return `protected/stakes/${stakeId}/activities/${eventId}/parent-ids/${registrationId}/${Date.now()}-${fileStem}.${extension}`;
}

const MAX_PARENT_ID_SIZE_BYTES = 12 * 1024 * 1024;
const ACCEPTED_PARENT_ID_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
  "application/pdf",
]);

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

  async uploadConsentSignature(args: UploadConsentSignatureArgs) {
    if (!args.stakeId || !args.eventId || !args.registrationId) {
      throw new Error("Servono attività e registrazione per caricare la firma.");
    }

    if (args.blob.size > 2 * 1024 * 1024) {
      throw new Error("La firma e troppo grande, riprova.");
    }

    const path = buildSignaturePath(args);
    const fileReference = ref(storage, path);

    await uploadBytes(fileReference, args.blob, {
      contentType: "image/png",
      customMetadata: {
        uploadedBy: args.uploadedBy,
        stakeId: args.stakeId,
        eventId: args.eventId,
        registrationId: args.registrationId,
        assetKey: "consent-signature",
      },
    });

    if (args.previousPath && args.previousPath !== path) {
      await storageService.deleteFile(args.previousPath).catch(() => undefined);
    }

    return {
      path,
      url: await getDownloadURL(fileReference),
    };
  },

  async uploadParentIdDocument(args: UploadParentIdDocumentArgs) {
    if (!args.stakeId || !args.eventId || !args.registrationId) {
      throw new Error("Servono attività e registrazione per caricare il documento.");
    }

    if (!ACCEPTED_PARENT_ID_TYPES.has(args.file.type)) {
      throw new Error("Formato non supportato. Usa una foto (JPG/PNG/HEIC/WEBP) o un PDF.");
    }

    if (args.file.size > MAX_PARENT_ID_SIZE_BYTES) {
      throw new Error("Il file supera 12 MB. Riduci il file e riprova.");
    }

    const path = buildParentIdPath(args);
    const fileReference = ref(storage, path);

    await uploadBytes(fileReference, args.file, {
      contentType: args.file.type,
      customMetadata: {
        uploadedBy: args.uploadedBy,
        stakeId: args.stakeId,
        eventId: args.eventId,
        registrationId: args.registrationId,
        assetKey: "parent-id",
      },
    });

    if (args.previousPath && args.previousPath !== path) {
      await storageService.deleteFile(args.previousPath).catch(() => undefined);
    }

    return {
      path,
      url: await getDownloadURL(fileReference),
      name: args.file.name,
    };
  },

  async deleteFile(path: string) {
    if (!path) {
      return;
    }

    await deleteObject(ref(storage, path));
  },

  async uploadGalleryFile(args: {
    file: File;
    stakeId: string;
    eventId: string;
    uploadedBy: string;
  }) {
    const extension = getFileExtension(args.file.name);
    const fileStem = slugify(args.file.name.replace(/\.[^.]+$/, "")) || "media";
    const path = `protected/stakes/${args.stakeId}/activities/${args.eventId}/gallery/${Date.now()}-${fileStem}.${extension}`;
    const fileReference = ref(storage, path);
    await uploadBytes(fileReference, args.file, {
      contentType: args.file.type || "application/octet-stream",
      customMetadata: { uploadedBy: args.uploadedBy },
    });
    return {
      path,
      url: await getDownloadURL(fileReference),
      name: args.file.name,
      contentType: args.file.type || "application/octet-stream",
      size: args.file.size,
    };
  },
};
