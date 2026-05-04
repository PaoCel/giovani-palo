import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
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
