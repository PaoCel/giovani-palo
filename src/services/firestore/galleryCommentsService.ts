import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  setDoc,
} from "firebase/firestore";

import { db } from "@/services/firebase/app";
import type { GalleryComment } from "@/types";

const MAX_BODY = 2000;

function nowIso() {
  return new Date().toISOString();
}

function commentsCollection(stakeId: string, galleryId: string, mediaId: string) {
  return collection(
    db,
    "stakes",
    stakeId,
    "galleries",
    galleryId,
    "media",
    mediaId,
    "comments",
  );
}

function commentDoc(
  stakeId: string,
  galleryId: string,
  mediaId: string,
  commentId: string,
) {
  return doc(commentsCollection(stakeId, galleryId, mediaId), commentId);
}

function mapComment(id: string, data: Record<string, unknown>): GalleryComment {
  return {
    id,
    uid: typeof data.uid === "string" ? data.uid : "",
    displayName: typeof data.displayName === "string" ? data.displayName : "Utente",
    body: typeof data.body === "string" ? data.body : "",
    createdAt: typeof data.createdAt === "string" ? data.createdAt : nowIso(),
  };
}

export const galleryCommentsService = {
  async list(
    stakeId: string,
    galleryId: string,
    mediaId: string,
  ): Promise<GalleryComment[]> {
    if (!stakeId || !galleryId || !mediaId) return [];
    const snap = await getDocs(commentsCollection(stakeId, galleryId, mediaId));
    return snap.docs
      .map((d) => mapComment(d.id, d.data()))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  async add(args: {
    stakeId: string;
    galleryId: string;
    mediaId: string;
    uid: string;
    displayName: string;
    body: string;
  }): Promise<GalleryComment> {
    const trimmed = args.body.trim();
    if (!trimmed) throw new Error("Commento vuoto.");
    if (trimmed.length > MAX_BODY) throw new Error("Commento troppo lungo.");
    const ref = doc(commentsCollection(args.stakeId, args.galleryId, args.mediaId));
    const data = {
      uid: args.uid,
      displayName: args.displayName.slice(0, 80),
      body: trimmed,
      createdAt: nowIso(),
    };
    await setDoc(ref, data);
    return mapComment(ref.id, data);
  },

  async remove(
    stakeId: string,
    galleryId: string,
    mediaId: string,
    commentId: string,
  ): Promise<void> {
    await deleteDoc(commentDoc(stakeId, galleryId, mediaId, commentId));
  },
};
