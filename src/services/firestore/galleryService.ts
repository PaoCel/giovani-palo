import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
} from "firebase/firestore";

import { db } from "@/services/firebase/app";

export interface GalleryItem {
  id: string;
  eventId: string;
  stakeId: string;
  path: string;
  url: string;
  name: string;
  contentType: string;
  size: number;
  uploadedBy: string;
  createdAt: string;
}

function nowIso() {
  return new Date().toISOString();
}

function getAccessRef(stakeId: string, eventId: string, uid: string) {
  return doc(db, "stakes", stakeId, "activities", eventId, "galleryAccess", uid);
}

function getItemsCollection(stakeId: string, eventId: string) {
  return collection(db, "stakes", stakeId, "activities", eventId, "galleryItems");
}

function getItemRef(stakeId: string, eventId: string, itemId: string) {
  return doc(db, "stakes", stakeId, "activities", eventId, "galleryItems", itemId);
}

function mapItem(
  stakeId: string,
  eventId: string,
  id: string,
  data: Record<string, unknown>,
): GalleryItem {
  return {
    id,
    eventId,
    stakeId,
    path: typeof data.path === "string" ? data.path : "",
    url: typeof data.url === "string" ? data.url : "",
    name: typeof data.name === "string" ? data.name : "",
    contentType: typeof data.contentType === "string" ? data.contentType : "",
    size: typeof data.size === "number" ? data.size : 0,
    uploadedBy: typeof data.uploadedBy === "string" ? data.uploadedBy : "",
    createdAt: typeof data.createdAt === "string" ? data.createdAt : nowIso(),
  };
}

export const galleryService = {
  async unlockWithCode(stakeId: string, eventId: string, uid: string, code: string) {
    await setDoc(getAccessRef(stakeId, eventId, uid), {
      code: code.trim(),
      grantedAt: nowIso(),
    });
  },

  async hasAccess(stakeId: string, eventId: string, uid: string) {
    const snapshot = await getDoc(getAccessRef(stakeId, eventId, uid));
    return snapshot.exists();
  },

  async listItems(stakeId: string, eventId: string): Promise<GalleryItem[]> {
    const snapshot = await getDocs(
      query(getItemsCollection(stakeId, eventId), orderBy("createdAt", "desc")),
    );
    return snapshot.docs.map((document) =>
      mapItem(stakeId, eventId, document.id, document.data()),
    );
  },

  async addItem(
    stakeId: string,
    eventId: string,
    payload: Omit<GalleryItem, "id" | "eventId" | "stakeId" | "createdAt"> & {
      uploadedBy: string;
    },
  ): Promise<GalleryItem> {
    const id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const reference = getItemRef(stakeId, eventId, id);
    const data = {
      eventId,
      stakeId,
      path: payload.path,
      url: payload.url,
      name: payload.name,
      contentType: payload.contentType,
      size: payload.size,
      uploadedBy: payload.uploadedBy,
      createdAt: nowIso(),
    };
    await setDoc(reference, data);
    return mapItem(stakeId, eventId, id, data);
  },

  async deleteItem(stakeId: string, eventId: string, itemId: string) {
    await deleteDoc(getItemRef(stakeId, eventId, itemId));
  },
};
