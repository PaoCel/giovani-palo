import { collection, deleteDoc, doc, getDocsFromServer, setDoc } from "firebase/firestore";

import { db } from "@/services/firebase/app";
import type { GalleryComment } from "@/types";
import { isOffline } from "@/utils/writeTimeout";

const MAX_BODY = 2000;
interface CommentContext { stakeId: string; galleryId: string; mediaId: string; uid: string }
interface AddCommentArgs extends CommentContext {
  displayName: string;
  body: string;
  id?: string;
  createdAt?: string;
}
export interface GalleryCommentSubmission {
  comment: GalleryComment;
  status: "pending" | "failed" | "sent";
  promise: Promise<GalleryComment>;
  error?: unknown;
  discarded?: boolean;
}
const submissions = new Map<string, { context: CommentContext; submission: GalleryCommentSubmission }>();
const deletions = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
const contextKey = (args: CommentContext) => JSON.stringify([args.uid, args.stakeId, args.galleryId, args.mediaId]);
const changed = () => listeners.forEach((listener) => listener());
const offlineError = () => Object.assign(new Error("offline"), { code: "unavailable" });

function commentsCollection(stakeId: string, galleryId: string, mediaId: string) {
  return collection(db, "stakes", stakeId, "galleries", galleryId, "media", mediaId, "comments");
}
function commentDoc(stakeId: string, galleryId: string, mediaId: string, commentId: string) {
  return doc(commentsCollection(stakeId, galleryId, mediaId), commentId);
}
function mapComment(id: string, data: Record<string, unknown>): GalleryComment {
  return {
    id,
    uid: typeof data.uid === "string" ? data.uid : "",
    displayName: typeof data.displayName === "string" ? data.displayName : "Utente",
    body: typeof data.body === "string" ? data.body : "",
    createdAt: typeof data.createdAt === "string" ? data.createdAt : new Date().toISOString(),
  };
}

export const galleryCommentsService = {
  async list(stakeId: string, galleryId: string, mediaId: string): Promise<GalleryComment[]> {
    if (!stakeId || !galleryId || !mediaId) return [];
    // A failed server read must remain an error, not become a cached empty thread.
    const snap = await getDocsFromServer(commentsCollection(stakeId, galleryId, mediaId));
    return snap.docs.map((item) => mapComment(item.id, item.data()))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  subscribeSubmissions(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },

  getSubmission(context: CommentContext): GalleryCommentSubmission | undefined {
    const value = submissions.get(contextKey(context))?.submission;
    return value?.discarded ? undefined : value;
  },

  discardSubmission(context: CommentContext) {
    const key = contextKey(context);
    const value = submissions.get(key)?.submission;
    if (value?.status !== "pending") submissions.delete(key);
    changed();
  },

  clearContext(uid: string, stakeId: string) {
    for (const [key, value] of submissions) {
      if (value.context.uid !== uid || value.context.stakeId !== stakeId) continue;
      // A started SDK write cannot be cancelled. Retain its lock until it settles,
      // but hide its body and suppress its result in any subsequent UI context.
      if (value.submission.status === "pending") value.submission.discarded = true;
      else submissions.delete(key);
    }
    changed();
  },

  add(args: AddCommentArgs): Promise<GalleryComment> {
    const key = contextKey(args);
    const previous = submissions.get(key)?.submission;
    if (previous?.status === "pending") {
      return previous.discarded
        ? Promise.reject(Object.assign(new Error("comment-in-flight"), { code: "comment-in-flight" }))
        : previous.promise;
    }
    if (isOffline()) return Promise.reject(offlineError());
    const body = args.body.trim();
    if (!body) return Promise.reject(new Error("Commento vuoto."));
    if (body.length > MAX_BODY) return Promise.reject(new Error("Commento troppo lungo."));
    const retry = previous?.status === "failed" ? previous.comment : undefined;
    const ref = retry
      ? commentDoc(args.stakeId, args.galleryId, args.mediaId, retry.id)
      : args.id
        ? commentDoc(args.stakeId, args.galleryId, args.mediaId, args.id)
        : doc(commentsCollection(args.stakeId, args.galleryId, args.mediaId));
    const data = {
      uid: args.uid, displayName: args.displayName.slice(0, 80), body,
      createdAt: retry?.createdAt ?? args.createdAt ?? new Date().toISOString(),
    };
    const submission: GalleryCommentSubmission = {
      comment: mapComment(ref.id, data), status: "pending", promise: Promise.resolve(mapComment(ref.id, data)),
    };
    // The same real promise and document ID are shared across double taps,
    // photo changes and normal viewer closure. Only an explicit retry writes again.
    submission.promise = setDoc(ref, data).then(() => {
      submission.status = "sent";
      return submission.comment;
    }, (error: unknown) => {
      submission.status = "failed";
      submission.error = error;
      throw error;
    }).finally(() => {
      if (submission.discarded && submissions.get(key)?.submission === submission) submissions.delete(key);
      changed();
    });
    submissions.set(key, { context: args, submission });
    changed();
    return submission.promise;
  },

  remove(stakeId: string, galleryId: string, mediaId: string, commentId: string): Promise<void> {
    const key = JSON.stringify([stakeId, galleryId, mediaId, commentId]);
    const pending = deletions.get(key);
    if (pending) return pending;
    if (isOffline()) return Promise.reject(offlineError());
    const request = deleteDoc(commentDoc(stakeId, galleryId, mediaId, commentId))
      .finally(() => { deletions.delete(key); });
    deletions.set(key, request);
    return request;
  },
};
