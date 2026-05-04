import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { db, functions } from "@/services/firebase/app";

export interface GalleryDoc {
  id: string;
  title: string;
  description: string;
  activityId: string | null;
  coverImageUrl: string | null;
  coverMediaId: string | null;
  mediaCount: number;
  accessMode: string;
  codeStatus: string;
  published: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GalleryMedia {
  id: string;
  galleryId: string;
  type: "image" | "video";
  filename: string;
  contentType: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  order: number;
  caption: string;
  storageUrl: string | null;
  optimizedUrl: string | null;
  thumbnailUrl: string | null;
  posterUrl: string | null;
  originalUrl: string | null;
}

function nowIso() {
  return new Date().toISOString();
}

function getCollection(stakeId: string) {
  return collection(db, "stakes", stakeId, "galleries");
}

function getDocRef(stakeId: string, galleryId: string) {
  return doc(db, "stakes", stakeId, "galleries", galleryId);
}

function getMediaCollection(stakeId: string, galleryId: string) {
  return collection(db, "stakes", stakeId, "galleries", galleryId, "media");
}

function getMemberRef(stakeId: string, galleryId: string, uid: string) {
  return doc(db, "stakes", stakeId, "galleries", galleryId, "members", uid);
}

function mapGallery(id: string, data: Record<string, unknown>): GalleryDoc {
  return {
    id,
    title: typeof data.title === "string" ? data.title : "Galleria",
    description: typeof data.description === "string" ? data.description : "",
    activityId: typeof data.activityId === "string" ? data.activityId : null,
    coverImageUrl:
      typeof data.coverImageUrl === "string" ? data.coverImageUrl : null,
    coverMediaId:
      typeof data.coverMediaId === "string" ? data.coverMediaId : null,
    mediaCount: typeof data.mediaCount === "number" ? data.mediaCount : 0,
    accessMode: typeof data.accessMode === "string" ? data.accessMode : "open",
    codeStatus: typeof data.codeStatus === "string" ? data.codeStatus : "none",
    published: data.published === true,
    publishedAt: typeof data.publishedAt === "string" ? data.publishedAt : null,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : nowIso(),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : nowIso(),
  };
}

function mapMedia(
  galleryId: string,
  id: string,
  data: Record<string, unknown>,
): GalleryMedia {
  const type = data.type === "video" ? "video" : "image";
  return {
    id,
    galleryId,
    type,
    filename: typeof data.filename === "string" ? data.filename : "",
    contentType:
      typeof data.contentType === "string" ? data.contentType : "image/jpeg",
    width: typeof data.width === "number" ? data.width : null,
    height: typeof data.height === "number" ? data.height : null,
    duration: typeof data.duration === "number" ? data.duration : null,
    order: typeof data.order === "number" ? data.order : 0,
    caption: typeof data.caption === "string" ? data.caption : "",
    storageUrl: typeof data.storageUrl === "string" ? data.storageUrl : null,
    optimizedUrl: typeof data.optimizedUrl === "string" ? data.optimizedUrl : null,
    thumbnailUrl: typeof data.thumbnailUrl === "string" ? data.thumbnailUrl : null,
    posterUrl: typeof data.posterUrl === "string" ? data.posterUrl : null,
    originalUrl: typeof data.originalUrl === "string" ? data.originalUrl : null,
  };
}

const unlockGalleryWithCodeFn = httpsCallable<
  { stakeId: string; galleryId: string; code: string },
  { success?: boolean; ok?: boolean; error?: string; message?: string }
>(functions, "unlockGalleryWithCode");

const setGallerySecretCodeFn = httpsCallable<
  { stakeId: string; galleryId: string; code: string },
  { success?: boolean; ok?: boolean; error?: string; message?: string }
>(functions, "setGallerySecretCode");

export const galleriesService = {
  async listPublishedGalleries(stakeId: string): Promise<GalleryDoc[]> {
    const snapshot = await getDocs(
      query(getCollection(stakeId), where("published", "==", true)),
    );
    return snapshot.docs
      .map((document) => mapGallery(document.id, document.data()))
      .sort((left, right) => {
        const leftDate = left.publishedAt || left.createdAt;
        const rightDate = right.publishedAt || right.createdAt;
        return rightDate.localeCompare(leftDate);
      });
  },

  async listGalleriesForActivity(
    stakeId: string,
    activityId: string,
  ): Promise<GalleryDoc[]> {
    const snapshot = await getDocs(
      query(getCollection(stakeId), where("activityId", "==", activityId)),
    );
    return snapshot.docs.map((document) => mapGallery(document.id, document.data()));
  },

  async listAllGalleriesForAdmin(stakeId: string): Promise<GalleryDoc[]> {
    const snapshot = await getDocs(
      query(getCollection(stakeId), orderBy("createdAt", "desc")),
    );
    return snapshot.docs.map((document) => mapGallery(document.id, document.data()));
  },

  async getGallery(stakeId: string, galleryId: string): Promise<GalleryDoc | null> {
    const snapshot = await getDoc(getDocRef(stakeId, galleryId));
    if (!snapshot.exists()) return null;
    return mapGallery(snapshot.id, snapshot.data());
  },

  async listMedia(stakeId: string, galleryId: string): Promise<GalleryMedia[]> {
    const snapshot = await getDocs(getMediaCollection(stakeId, galleryId));
    return snapshot.docs
      .map((document) => mapMedia(galleryId, document.id, document.data()))
      .sort((left, right) => left.order - right.order);
  },

  async listMediaByIds(
    stakeId: string,
    galleryId: string,
    mediaIds: string[],
  ): Promise<GalleryMedia[]> {
    if (mediaIds.length === 0) return [];
    const snapshots = await Promise.all(
      mediaIds.map((mediaId) =>
        getDoc(doc(db, "stakes", stakeId, "galleries", galleryId, "media", mediaId)),
      ),
    );
    return snapshots
      .filter((snapshot) => snapshot.exists())
      .map((snapshot) => mapMedia(galleryId, snapshot.id, snapshot.data() ?? {}));
  },

  async hasMembership(stakeId: string, galleryId: string, uid: string): Promise<boolean> {
    const snapshot = await getDoc(getMemberRef(stakeId, galleryId, uid));
    return snapshot.exists();
  },

  async unlockWithCode(stakeId: string, galleryId: string, code: string) {
    const result = await unlockGalleryWithCodeFn({
      stakeId,
      galleryId,
      code: code.trim(),
    });
    return result.data;
  },

  async setSecretCode(stakeId: string, galleryId: string, code: string) {
    const result = await setGallerySecretCodeFn({
      stakeId,
      galleryId,
      code: code.trim(),
    });
    return result.data;
  },
};
