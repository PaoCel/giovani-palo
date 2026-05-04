import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

import { db } from "@/services/firebase/app";
import type {
  FeedPost,
  FeedPostType,
  FeedPostVisibility,
  FeedPostWriteInput,
  Gallery,
  GalleryMedia,
} from "@/types";

function nowIso() {
  return new Date().toISOString();
}

function feedPostsCollection(stakeId: string) {
  return collection(db, "stakes", stakeId, "feedPosts");
}

function feedPostDoc(stakeId: string, postId: string) {
  return doc(db, "stakes", stakeId, "feedPosts", postId);
}

function feedPostLikeDoc(stakeId: string, postId: string, uid: string) {
  return doc(db, "stakes", stakeId, "feedPosts", postId, "likes", uid);
}

function sanitizeType(value: unknown): FeedPostType {
  return value === "activity_reminder" || value === "gallery"
    ? value
    : "announcement";
}

function sanitizeVisibility(value: unknown): FeedPostVisibility {
  return value === "gallery_members" || value === "admins_only"
    ? value
    : "all_authenticated";
}

function mapFeedPost(stakeId: string, id: string, data: Record<string, unknown>): FeedPost {
  return {
    id,
    stakeId,
    type: sanitizeType(data.type),
    title: typeof data.title === "string" ? data.title : "",
    body: typeof data.body === "string" ? data.body : "",
    createdAt: typeof data.createdAt === "string" ? data.createdAt : nowIso(),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : nowIso(),
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    published: data.published !== false,
    pinned: data.pinned === true,
    publishedAt: typeof data.publishedAt === "string" ? data.publishedAt : null,
    activityId: typeof data.activityId === "string" ? data.activityId : null,
    galleryId: typeof data.galleryId === "string" ? data.galleryId : null,
    galleryBatchIndex:
      typeof data.galleryBatchIndex === "number" ? data.galleryBatchIndex : null,
    mediaIds: Array.isArray(data.mediaIds)
      ? (data.mediaIds.filter((value) => typeof value === "string") as string[])
      : [],
    likeCount: typeof data.likeCount === "number" ? data.likeCount : 0,
    visibility: sanitizeVisibility(data.visibility),
    ctaLabel: typeof data.ctaLabel === "string" ? data.ctaLabel : null,
    ctaUrl: typeof data.ctaUrl === "string" ? data.ctaUrl : null,
  };
}

function buildPayload(
  input: FeedPostWriteInput,
  createdBy: string,
  ts: string,
  patch?: Partial<FeedPost>,
) {
  const published = input.published ?? false;
  return {
    type: input.type,
    title: input.title,
    body: input.body,
    createdBy,
    createdAt: patch?.createdAt ?? ts,
    updatedAt: ts,
    published,
    pinned: input.pinned ?? false,
    publishedAt: published ? patch?.publishedAt ?? ts : null,
    activityId: input.activityId ?? null,
    galleryId: input.galleryId ?? null,
    galleryBatchIndex: input.galleryBatchIndex ?? null,
    mediaIds: input.mediaIds ?? [],
    likeCount: patch?.likeCount ?? 0,
    visibility: input.visibility ?? "all_authenticated",
    ctaLabel: input.ctaLabel ?? null,
    ctaUrl: input.ctaUrl ?? null,
  };
}

export const feedService = {
  async listPublishedPosts(stakeId: string): Promise<FeedPost[]> {
    if (!stakeId) return [];
    const snapshot = await getDocs(
      query(feedPostsCollection(stakeId), where("published", "==", true)),
    );
    return snapshot.docs
      .map((d) => mapFeedPost(stakeId, d.id, d.data()))
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return (b.publishedAt ?? b.createdAt).localeCompare(
          a.publishedAt ?? a.createdAt,
        );
      });
  },

  async listAllPosts(stakeId: string): Promise<FeedPost[]> {
    if (!stakeId) return [];
    const snapshot = await getDocs(feedPostsCollection(stakeId));
    return snapshot.docs
      .map((d) => mapFeedPost(stakeId, d.id, d.data()))
      .sort((a, b) =>
        (b.publishedAt ?? b.createdAt).localeCompare(a.publishedAt ?? a.createdAt),
      );
  },

  async getPost(stakeId: string, postId: string): Promise<FeedPost | null> {
    const snap = await getDoc(feedPostDoc(stakeId, postId));
    if (!snap.exists()) return null;
    return mapFeedPost(stakeId, snap.id, snap.data());
  },

  async createPost(
    stakeId: string,
    createdBy: string,
    input: FeedPostWriteInput,
  ): Promise<FeedPost> {
    const ref = doc(feedPostsCollection(stakeId));
    const ts = nowIso();
    const data = buildPayload(input, createdBy, ts);
    await setDoc(ref, data);
    return mapFeedPost(stakeId, ref.id, data);
  },

  async updatePost(
    stakeId: string,
    postId: string,
    input: FeedPostWriteInput,
  ): Promise<void> {
    const existing = await this.getPost(stakeId, postId);
    if (!existing) throw new Error("Post non trovato.");
    const ts = nowIso();
    const data = buildPayload(input, existing.createdBy, ts, existing);
    await setDoc(feedPostDoc(stakeId, postId), data);
  },

  async setPublished(
    stakeId: string,
    postId: string,
    published: boolean,
  ): Promise<void> {
    const ts = nowIso();
    await updateDoc(feedPostDoc(stakeId, postId), {
      published,
      publishedAt: published ? ts : null,
      updatedAt: ts,
    });
  },

  async setPinned(
    stakeId: string,
    postId: string,
    pinned: boolean,
  ): Promise<void> {
    await updateDoc(feedPostDoc(stakeId, postId), {
      pinned,
      updatedAt: nowIso(),
    });
  },

  async deletePost(stakeId: string, postId: string): Promise<void> {
    await deleteDoc(feedPostDoc(stakeId, postId));
  },

  async hasUserLikedPost(
    stakeId: string,
    postId: string,
    uid: string,
  ): Promise<boolean> {
    if (!uid) return false;
    const snap = await getDoc(feedPostLikeDoc(stakeId, postId, uid));
    return snap.exists();
  },

  async likePost(stakeId: string, postId: string, uid: string): Promise<void> {
    const likeRef = feedPostLikeDoc(stakeId, postId, uid);
    const existing = await getDoc(likeRef);
    if (existing.exists()) return;
    const batch = writeBatch(db);
    batch.set(likeRef, { uid, createdAt: nowIso() });
    batch.update(feedPostDoc(stakeId, postId), {
      likeCount: increment(1),
    });
    await batch.commit();
  },

  async unlikePost(stakeId: string, postId: string, uid: string): Promise<void> {
    const likeRef = feedPostLikeDoc(stakeId, postId, uid);
    const existing = await getDoc(likeRef);
    if (!existing.exists()) return;
    const batch = writeBatch(db);
    batch.delete(likeRef);
    batch.update(feedPostDoc(stakeId, postId), {
      likeCount: increment(-1),
    });
    await batch.commit();
  },

  async hasUserLikedMedia(
    stakeId: string,
    galleryId: string,
    mediaId: string,
    uid: string,
  ): Promise<boolean> {
    if (!uid) return false;
    const snap = await getDoc(
      doc(
        db,
        "stakes",
        stakeId,
        "galleries",
        galleryId,
        "media",
        mediaId,
        "likes",
        uid,
      ),
    );
    return snap.exists();
  },

  async likeMedia(
    stakeId: string,
    galleryId: string,
    mediaId: string,
    uid: string,
  ): Promise<void> {
    const likeRef = doc(
      db,
      "stakes",
      stakeId,
      "galleries",
      galleryId,
      "media",
      mediaId,
      "likes",
      uid,
    );
    const existing = await getDoc(likeRef);
    if (existing.exists()) return;
    const batch = writeBatch(db);
    batch.set(likeRef, { uid, createdAt: nowIso() });
    batch.update(
      doc(db, "stakes", stakeId, "galleries", galleryId, "media", mediaId),
      { likeCount: increment(1) },
    );
    await batch.commit();
  },

  async unlikeMedia(
    stakeId: string,
    galleryId: string,
    mediaId: string,
    uid: string,
  ): Promise<void> {
    const likeRef = doc(
      db,
      "stakes",
      stakeId,
      "galleries",
      galleryId,
      "media",
      mediaId,
      "likes",
      uid,
    );
    const existing = await getDoc(likeRef);
    if (!existing.exists()) return;
    const batch = writeBatch(db);
    batch.delete(likeRef);
    batch.update(
      doc(db, "stakes", stakeId, "galleries", galleryId, "media", mediaId),
      { likeCount: increment(-1) },
    );
    await batch.commit();
  },

  buildGalleryPostsFromMedia(
    gallery: Gallery,
    media: GalleryMedia[],
    batchSize = 30,
  ): { mediaIds: string[]; batchIndex: number }[] {
    const sorted = [...media].sort((a, b) => a.order - b.order);
    const batches: { mediaIds: string[]; batchIndex: number }[] = [];
    for (let i = 0; i < sorted.length; i += batchSize) {
      batches.push({
        mediaIds: sorted.slice(i, i + batchSize).map((m) => m.id),
        batchIndex: Math.floor(i / batchSize),
      });
    }
    if (batches.length === 0 && gallery.mediaCount === 0) {
      batches.push({ mediaIds: [], batchIndex: 0 });
    }
    return batches;
  },

  async findGalleryPosts(
    stakeId: string,
    galleryId: string,
  ): Promise<FeedPost[]> {
    const snap = await getDocs(
      query(feedPostsCollection(stakeId), where("galleryId", "==", galleryId)),
    );
    return snap.docs.map((d) => mapFeedPost(stakeId, d.id, d.data()));
  },

  async syncGalleryPosts(
    stakeId: string,
    createdBy: string,
    gallery: Gallery,
    media: GalleryMedia[],
  ): Promise<void> {
    const existing = await this.findGalleryPosts(stakeId, gallery.id);
    const batches = this.buildGalleryPostsFromMedia(gallery, media);

    const ts = nowIso();
    const batch = writeBatch(db);

    for (const post of existing) {
      batch.delete(feedPostDoc(stakeId, post.id));
    }

    batches.forEach(({ mediaIds, batchIndex }) => {
      const ref = doc(feedPostsCollection(stakeId));
      const totalBatches = batches.length;
      const batchSuffix = totalBatches > 1 ? ` (parte ${batchIndex + 1}/${totalBatches})` : "";
      batch.set(ref, {
        type: "gallery",
        title: `${gallery.title}${batchSuffix}`,
        body:
          gallery.description ||
          `È disponibile la galleria: ${gallery.title}. Inserisci il codice per guardarla.`,
        createdBy,
        createdAt: ts,
        updatedAt: ts,
        published: gallery.published,
        pinned: false,
        publishedAt: gallery.published ? ts : null,
        activityId: gallery.activityId ?? null,
        galleryId: gallery.id,
        galleryBatchIndex: batchIndex,
        mediaIds,
        likeCount: 0,
        visibility: "gallery_members",
        ctaLabel: null,
        ctaUrl: null,
      });
    });

    await batch.commit();
  },
};
