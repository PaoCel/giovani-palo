import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

import { db } from "@/services/firebase/app";

export type FeedPostType = "gallery" | "announcement" | "link";

export interface FeedPost {
  id: string;
  type: FeedPostType;
  title: string;
  body: string;
  published: boolean;
  pinned: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  activityId: string | null;
  galleryId: string | null;
  galleryBatchIndex: number | null;
  mediaIds: string[];
  visibility: string;
  ctaLabel: string;
  ctaUrl: string;
  likeCount: number;
}

function nowIso() {
  return new Date().toISOString();
}

function getCollection(stakeId: string) {
  return collection(db, "stakes", stakeId, "feedPosts");
}

function getRef(stakeId: string, postId: string) {
  return doc(db, "stakes", stakeId, "feedPosts", postId);
}

function getPostLikeRef(stakeId: string, postId: string, uid: string) {
  return doc(db, "stakes", stakeId, "feedPosts", postId, "likes", uid);
}

function getPostCommentsCollection(stakeId: string, postId: string) {
  return collection(db, "stakes", stakeId, "feedPosts", postId, "comments");
}

function getPostCommentRef(stakeId: string, postId: string, commentId: string) {
  return doc(db, "stakes", stakeId, "feedPosts", postId, "comments", commentId);
}

export interface FeedComment {
  id: string;
  uid: string;
  displayName: string;
  body: string;
  createdAt: string;
}

function mapComment(id: string, data: Record<string, unknown>): FeedComment {
  return {
    id,
    uid: typeof data.uid === "string" ? data.uid : "",
    displayName: typeof data.displayName === "string" ? data.displayName : "Utente",
    body: typeof data.body === "string" ? data.body : "",
    createdAt: typeof data.createdAt === "string" ? data.createdAt : nowIso(),
  };
}

function sanitizeType(value: unknown): FeedPostType {
  if (value === "gallery" || value === "announcement" || value === "link") return value;
  return "announcement";
}

function mapPost(id: string, data: Record<string, unknown>): FeedPost {
  return {
    id,
    type: sanitizeType(data.type),
    title: typeof data.title === "string" ? data.title : "",
    body: typeof data.body === "string" ? data.body : "",
    published: data.published === true,
    pinned: data.pinned === true,
    publishedAt: typeof data.publishedAt === "string" ? data.publishedAt : null,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : nowIso(),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : nowIso(),
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    activityId: typeof data.activityId === "string" ? data.activityId : null,
    galleryId: typeof data.galleryId === "string" ? data.galleryId : null,
    galleryBatchIndex:
      typeof data.galleryBatchIndex === "number" ? data.galleryBatchIndex : null,
    mediaIds: Array.isArray(data.mediaIds)
      ? data.mediaIds.filter((value): value is string => typeof value === "string")
      : [],
    visibility: typeof data.visibility === "string" ? data.visibility : "public",
    ctaLabel: typeof data.ctaLabel === "string" ? data.ctaLabel : "",
    ctaUrl: typeof data.ctaUrl === "string" ? data.ctaUrl : "",
    likeCount: typeof data.likeCount === "number" ? data.likeCount : 0,
  };
}

export const feedPostsService = {
  async listPublishedPosts(stakeId: string): Promise<FeedPost[]> {
    const snapshot = await getDocs(
      query(getCollection(stakeId), where("published", "==", true)),
    );
    const posts = snapshot.docs.map((document) => mapPost(document.id, document.data()));
    return posts.sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      const leftDate = left.publishedAt || left.createdAt;
      const rightDate = right.publishedAt || right.createdAt;
      return rightDate.localeCompare(leftDate);
    });
  },

  async getPost(stakeId: string, postId: string): Promise<FeedPost | null> {
    const snapshot = await getDoc(getRef(stakeId, postId));
    if (!snapshot.exists()) return null;
    return mapPost(snapshot.id, snapshot.data());
  },

  async listAllPostsForAdmin(stakeId: string): Promise<FeedPost[]> {
    const snapshot = await getDocs(
      query(getCollection(stakeId), orderBy("createdAt", "desc")),
    );
    return snapshot.docs.map((document) => mapPost(document.id, document.data()));
  },

  async setPublished(stakeId: string, postId: string, published: boolean) {
    await updateDoc(getRef(stakeId, postId), {
      published,
      publishedAt: published ? nowIso() : null,
      updatedAt: nowIso(),
    });
  },

  async hasUserLikedPost(stakeId: string, postId: string, uid: string) {
    const snapshot = await getDoc(getPostLikeRef(stakeId, postId, uid));
    return snapshot.exists();
  },

  async togglePostLike(stakeId: string, postId: string, uid: string) {
    const postRef = getRef(stakeId, postId);
    const likeRef = getPostLikeRef(stakeId, postId, uid);
    return runTransaction(db, async (transaction) => {
      const [postSnap, likeSnap] = await Promise.all([
        transaction.get(postRef),
        transaction.get(likeRef),
      ]);
      if (!postSnap.exists()) throw new Error("Post non trovato.");
      const current = (postSnap.data().likeCount as number) ?? 0;
      const liked = likeSnap.exists();
      const nextCount = Math.max(0, liked ? current - 1 : current + 1);
      transaction.update(postRef, {
        likeCount: nextCount,
        updatedAt: nowIso(),
      });
      if (liked) {
        transaction.delete(likeRef);
      } else {
        transaction.set(likeRef, { createdAt: nowIso() });
      }
      return { liked: !liked, likeCount: nextCount };
    });
  },

  async listComments(stakeId: string, postId: string): Promise<FeedComment[]> {
    const snapshot = await getDocs(
      query(getPostCommentsCollection(stakeId, postId), orderBy("createdAt", "desc")),
    );
    return snapshot.docs.map((document) => mapComment(document.id, document.data()));
  },

  async addComment(
    stakeId: string,
    postId: string,
    input: { uid: string; displayName: string; body: string },
  ): Promise<FeedComment> {
    const trimmed = input.body.trim();
    if (!trimmed) throw new Error("Commento vuoto.");
    if (trimmed.length > 1000) throw new Error("Commento troppo lungo (max 1000).");
    const data = {
      uid: input.uid,
      displayName: input.displayName.trim() || "Utente",
      body: trimmed,
      createdAt: nowIso(),
    };
    const reference = await addDoc(getPostCommentsCollection(stakeId, postId), data);
    return { id: reference.id, ...data };
  },

  async deleteComment(stakeId: string, postId: string, commentId: string) {
    await deleteDoc(getPostCommentRef(stakeId, postId, commentId));
  },

  async upsertAnnouncement(
    stakeId: string,
    postId: string | null,
    input: { title: string; body: string; ctaLabel?: string; ctaUrl?: string; pinned?: boolean; published?: boolean; createdBy: string },
  ) {
    const id =
      postId ??
      (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    const reference = getRef(stakeId, id);
    const existing = postId ? await getDoc(reference) : null;
    const timestamp = nowIso();
    const published = input.published ?? true;
    await setDoc(reference, {
      type: "announcement",
      title: input.title.trim(),
      body: input.body.trim(),
      published,
      pinned: input.pinned ?? false,
      publishedAt: published
        ? existing?.data()?.publishedAt ?? timestamp
        : null,
      createdAt: existing?.data()?.createdAt ?? timestamp,
      updatedAt: timestamp,
      createdBy: input.createdBy,
      activityId: null,
      galleryId: null,
      galleryBatchIndex: null,
      mediaIds: [],
      visibility: "public",
      ctaLabel: (input.ctaLabel ?? "").trim(),
      ctaUrl: (input.ctaUrl ?? "").trim(),
      likeCount: 0,
    });
  },
};
