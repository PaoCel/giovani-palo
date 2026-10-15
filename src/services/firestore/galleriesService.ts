import {
  collection,
  deleteDoc,
  doc,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { db, functions } from "@/services/firebase/app";
import { getDocCacheFirst, getDocsCacheFirst } from "@/services/firestore/cacheFirst";
import type {
  Gallery,
  GalleryMedia,
  GalleryMediaType,
  GalleryMember,
  GalleryReportReason,
  GalleryWriteInput,
  HiddenGalleryMedia,
} from "@/types";

const GALLERY_BATCH_SIZE = 30;

function nowIso() {
  return new Date().toISOString();
}

function sortMedia(left: GalleryMedia, right: GalleryMedia) {
  if (left.order !== right.order) return left.order - right.order;
  return left.createdAt.localeCompare(right.createdAt);
}

function galleriesCollection(stakeId: string) {
  return collection(db, "stakes", stakeId, "galleries");
}

function galleryDoc(stakeId: string, galleryId: string) {
  return doc(db, "stakes", stakeId, "galleries", galleryId);
}

function mediaCollection(stakeId: string, galleryId: string) {
  return collection(galleryDoc(stakeId, galleryId), "media");
}

function mediaDoc(stakeId: string, galleryId: string, mediaId: string) {
  return doc(mediaCollection(stakeId, galleryId), mediaId);
}

function membersCollection(stakeId: string, galleryId: string) {
  return collection(galleryDoc(stakeId, galleryId), "members");
}

function memberDoc(stakeId: string, galleryId: string, uid: string) {
  return doc(membersCollection(stakeId, galleryId), uid);
}

// La finestra di caricamento è un Timestamp Firestore (la confrontano le rules).
function timestampMs(value: unknown): number | null {
  if (value && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
}

/** Id della galleria creata dalla callable per un'attività. */
export function activityGalleryId(activityId: string) {
  return `act_${activityId}`;
}

// Prima la galleria con l'id dell'attività (la stessa che sceglie la callable),
// poi la più recente fra quelle create a mano dal pannello admin.
function pickActivityGallery(galleries: Gallery[], activityId: string): Gallery | null {
  const fixed = galleries.find((gallery) => gallery.id === activityGalleryId(activityId));
  if (fixed) return fixed;
  return [...galleries].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

function mapGallery(stakeId: string, id: string, data: Record<string, unknown>): Gallery {
  return {
    id,
    stakeId,
    title: typeof data.title === "string" ? data.title : "Galleria",
    description: typeof data.description === "string" ? data.description : "",
    activityId: typeof data.activityId === "string" ? data.activityId : null,
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "",
    createdAt: typeof data.createdAt === "string" ? data.createdAt : nowIso(),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : nowIso(),
    published: data.published === true,
    publishedAt: typeof data.publishedAt === "string" ? data.publishedAt : null,
    coverMediaId: typeof data.coverMediaId === "string" ? data.coverMediaId : null,
    coverImageUrl: typeof data.coverImageUrl === "string" ? data.coverImageUrl : null,
    mediaCount: typeof data.mediaCount === "number" ? data.mediaCount : 0,
    batchSize: typeof data.batchSize === "number" ? data.batchSize : GALLERY_BATCH_SIZE,
    accessMode: data.accessMode === "open" ? "open" : "code_required",
    likeCount: typeof data.likeCount === "number" ? data.likeCount : 0,
    commentsEnabled: false,
    postsCreated: data.postsCreated === true,
    codeStatus: data.codeStatus === "set" ? "set" : "missing",
    uploadsClosed: data.uploadsClosed === true,
    uploadsOpenFrom: timestampMs(data.uploadsOpenFrom),
    uploadsOpenUntil: timestampMs(data.uploadsOpenUntil),
    uploadsWindowSource:
      data.uploadsWindowSource === "manual" || data.uploadsWindowSource === "activity"
        ? data.uploadsWindowSource
        : null,
  };
}

function mapHiddenMedia(
  stakeId: string,
  galleryId: string,
  id: string,
  data: Record<string, unknown>,
): HiddenGalleryMedia {
  const reason = data.hiddenReason;
  return {
    ...mapMedia(stakeId, galleryId, id, data),
    hiddenAt: typeof data.hiddenAt === "string" ? data.hiddenAt : "",
    hiddenBy: typeof data.hiddenBy === "string" ? data.hiddenBy : "",
    hiddenReason:
      reason === "mine" || reason === "inappropriate" || reason === "off_topic"
        ? reason
        : "inappropriate",
  };
}

type ActivityGalleryAction =
  | { action: "ensure"; stakeId: string; activityId: string }
  | {
      action: "report";
      stakeId: string;
      galleryId: string;
      mediaId: string;
      reason: GalleryReportReason;
    }
  | { action: "restore" | "delete"; stakeId: string; galleryId: string; mediaId: string };

const activityGalleryCallable = httpsCallable<
  ActivityGalleryAction,
  { galleryId?: string | null; created?: boolean; status?: string }
>(functions, "activityGallery");

function mapMedia(
  stakeId: string,
  galleryId: string,
  id: string,
  data: Record<string, unknown>,
): GalleryMedia {
  const type: GalleryMediaType = data.type === "video" ? "video" : "image";
  const status =
    data.status === "processing" || data.status === "error"
      ? data.status
      : "uploaded";
  return {
    id,
    galleryId,
    stakeId,
    activityId: typeof data.activityId === "string" ? data.activityId : null,
    type,
    storagePath: typeof data.storagePath === "string" ? data.storagePath : "",
    storageUrl: typeof data.storageUrl === "string" ? data.storageUrl : null,
    originalPath: typeof data.originalPath === "string" ? data.originalPath : null,
    originalUrl: typeof data.originalUrl === "string" ? data.originalUrl : null,
    thumbnailPath: typeof data.thumbnailPath === "string" ? data.thumbnailPath : null,
    thumbnailUrl: typeof data.thumbnailUrl === "string" ? data.thumbnailUrl : null,
    optimizedPath: typeof data.optimizedPath === "string" ? data.optimizedPath : null,
    optimizedUrl: typeof data.optimizedUrl === "string" ? data.optimizedUrl : null,
    posterPath: typeof data.posterPath === "string" ? data.posterPath : null,
    posterUrl: typeof data.posterUrl === "string" ? data.posterUrl : null,
    width: typeof data.width === "number" ? data.width : null,
    height: typeof data.height === "number" ? data.height : null,
    duration: typeof data.duration === "number" ? data.duration : null,
    order: typeof data.order === "number" ? data.order : 0,
    caption: typeof data.caption === "string" ? data.caption : "",
    filename: typeof data.filename === "string" ? data.filename : "",
    contentType: typeof data.contentType === "string" ? data.contentType : "",
    sizeBytes: typeof data.sizeBytes === "number" ? data.sizeBytes : 0,
    uploadedBy: typeof data.uploadedBy === "string" ? data.uploadedBy : "",
    createdAt: typeof data.createdAt === "string" ? data.createdAt : nowIso(),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : nowIso(),
    status,
    likeCount: typeof data.likeCount === "number" ? data.likeCount : 0,
  };
}

function mapMember(uid: string, data: Record<string, unknown>): GalleryMember {
  return {
    uid,
    email: typeof data.email === "string" ? data.email : null,
    displayName: typeof data.displayName === "string" ? data.displayName : null,
    unlockedAt: typeof data.unlockedAt === "string" ? data.unlockedAt : nowIso(),
    unlockedBy: data.unlockedBy === "admin" ? "admin" : "code",
    source: data.source === "admin_manual" ? "admin_manual" : "home_code_prompt",
  };
}

export const galleriesService = {
  GALLERY_BATCH_SIZE,

  async listGalleries(stakeId: string): Promise<Gallery[]> {
    if (!stakeId) return [];
    const snapshot = await getDocsCacheFirst(galleriesCollection(stakeId));
    return snapshot.docs
      .map((d) => mapGallery(stakeId, d.id, d.data()))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async listPublishedGalleries(stakeId: string): Promise<Gallery[]> {
    if (!stakeId) return [];
    const snapshot = await getDocsCacheFirst(
      query(galleriesCollection(stakeId), where("published", "==", true)),
    );
    return snapshot.docs
      .map((d) => mapGallery(stakeId, d.id, d.data()))
      .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  },

  async getGallery(stakeId: string, galleryId: string): Promise<Gallery | null> {
    if (!stakeId || !galleryId) return null;
    const snap = await getDocCacheFirst(galleryDoc(stakeId, galleryId));
    if (!snap.exists()) return null;
    return mapGallery(stakeId, snap.id, snap.data());
  },

  async createGallery(
    stakeId: string,
    createdBy: string,
    input: GalleryWriteInput,
  ): Promise<Gallery> {
    if (!stakeId) throw new Error("stakeId mancante.");
    const ref = doc(galleriesCollection(stakeId));
    const ts = nowIso();
    const payload = {
      title: input.title,
      description: input.description ?? "",
      activityId: input.activityId ?? null,
      createdBy,
      createdAt: ts,
      updatedAt: ts,
      published: false,
      publishedAt: null,
      coverMediaId: input.coverMediaId ?? null,
      coverImageUrl: input.coverImageUrl ?? null,
      mediaCount: 0,
      batchSize: GALLERY_BATCH_SIZE,
      accessMode: "open" as const,
      likeCount: 0,
      commentsEnabled: false,
      postsCreated: false,
      codeStatus: "missing" as const,
    };
    await setDoc(ref, payload);
    return mapGallery(stakeId, ref.id, payload);
  },

  async updateGallery(
    stakeId: string,
    galleryId: string,
    patch: Partial<Gallery>,
  ): Promise<void> {
    const allowed: Record<string, unknown> = {};
    for (const key of [
      "title",
      "description",
      "activityId",
      "coverMediaId",
      "coverImageUrl",
      "published",
      "publishedAt",
      "postsCreated",
      "codeStatus",
    ] as const) {
      if (key in patch) allowed[key] = (patch as Record<string, unknown>)[key];
    }
    allowed.updatedAt = nowIso();
    await updateDoc(galleryDoc(stakeId, galleryId), allowed);
  },

  /** Solo admin: chiude i caricamenti dei membri o li riapre per qualche giorno. */
  async setUploadsOpen(
    stakeId: string,
    galleryId: string,
    open: { days: number } | false,
  ): Promise<void> {
    const ts = nowIso();
    if (!open) {
      await updateDoc(galleryDoc(stakeId, galleryId), { uploadsClosed: true, updatedAt: ts });
      return;
    }
    const now = Date.now();
    await updateDoc(galleryDoc(stakeId, galleryId), {
      uploadsClosed: false,
      uploadsOpenFrom: Timestamp.fromMillis(now),
      uploadsOpenUntil: Timestamp.fromMillis(now + open.days * 24 * 60 * 60 * 1000),
      // La callable non riallinea più la finestra alle date dell'attività.
      uploadsWindowSource: "manual",
      updatedAt: ts,
    });
  },

  async getGalleryByActivity(
    stakeId: string,
    activityId: string,
  ): Promise<Gallery | null> {
    if (!stakeId || !activityId) return null;
    const snapshot = await getDocsCacheFirst(
      query(galleriesCollection(stakeId), where("activityId", "==", activityId)),
    );
    if (snapshot.empty) return null;
    return pickActivityGallery(
      snapshot.docs.map((d) => mapGallery(stakeId, d.id, d.data())),
      activityId,
    );
  },

  async markCodeStatus(
    stakeId: string,
    galleryId: string,
    status: "set" | "missing",
  ): Promise<void> {
    await updateDoc(galleryDoc(stakeId, galleryId), {
      codeStatus: status,
      updatedAt: nowIso(),
    });
  },

  async setCover(
    stakeId: string,
    galleryId: string,
    coverMediaId: string,
    coverImageUrl: string | null,
  ): Promise<void> {
    await updateDoc(galleryDoc(stakeId, galleryId), {
      coverMediaId,
      coverImageUrl,
      updatedAt: nowIso(),
    });
  },

  async markPostsCreated(
    stakeId: string,
    galleryId: string,
    value: boolean,
  ): Promise<void> {
    await updateDoc(galleryDoc(stakeId, galleryId), {
      postsCreated: value,
      updatedAt: nowIso(),
    });
  },

  async setPublished(
    stakeId: string,
    galleryId: string,
    published: boolean,
  ): Promise<void> {
    const ts = nowIso();
    await updateDoc(galleryDoc(stakeId, galleryId), {
      published,
      publishedAt: published ? ts : null,
      updatedAt: ts,
    });
  },

  async deleteGallery(stakeId: string, galleryId: string): Promise<void> {
    await deleteDoc(galleryDoc(stakeId, galleryId));
  },

  async listMedia(stakeId: string, galleryId: string): Promise<GalleryMedia[]> {
    // Niente orderBy in query: Firestore esclude i doc senza il campo, e i
    // media legacy (gallerie precedenti a questo flow) spesso non hanno
    // `order`. Risultato: listMedia tornava [] e la galleria appariva vuota.
    // Sortiamo client-side col fallback a 0 di mapMedia.
    const snapshot = await getDocsCacheFirst(mediaCollection(stakeId, galleryId));
    return snapshot.docs
      .map((d) => mapMedia(stakeId, galleryId, d.id, d.data()))
      .sort(sortMedia);
  },

  // Sottoscrizioni cache-first (onSnapshot + persistentLocalCache): la prima
  // emissione arriva SUBITO dalla cache IndexedDB (niente attesa del round-trip
  // di rete che faceva "girare" la galleria all'infinito su connessioni lente),
  // poi il server aggiorna in background. In più i nuovi upload di chiunque
  // compaiono in tempo reale senza refresh.
  subscribeGalleryByActivity(
    stakeId: string,
    activityId: string,
    onData: (gallery: Gallery | null) => void,
    onError?: (error: Error) => void,
  ): Unsubscribe {
    if (!stakeId || !activityId) {
      onData(null);
      return () => {};
    }
    return onSnapshot(
      query(galleriesCollection(stakeId), where("activityId", "==", activityId)),
      (snapshot) => {
        if (snapshot.empty) {
          onData(null);
          return;
        }
        onData(
          pickActivityGallery(
            snapshot.docs.map((d) => mapGallery(stakeId, d.id, d.data())),
            activityId,
          ),
        );
      },
      (error) => onError?.(error),
    );
  },

  subscribeMedia(
    stakeId: string,
    galleryId: string,
    onData: (media: GalleryMedia[]) => void,
    onError?: (error: Error) => void,
  ): Unsubscribe {
    return onSnapshot(
      mediaCollection(stakeId, galleryId),
      (snapshot) => {
        onData(
          snapshot.docs
            .map((d) => mapMedia(stakeId, galleryId, d.id, d.data()))
            .sort(sortMedia),
        );
      },
      (error) => onError?.(error),
    );
  },

  /** Ultimi contenuti caricati, per le anteprime delle card. */
  subscribeLatestMedia(
    stakeId: string,
    galleryId: string,
    count: number,
    onData: (media: GalleryMedia[]) => void,
    onError?: (error: Error) => void,
  ): Unsubscribe {
    return onSnapshot(
      query(mediaCollection(stakeId, galleryId), orderBy("createdAt", "desc"), limit(count)),
      (snapshot) => {
        onData(snapshot.docs.map((d) => mapMedia(stakeId, galleryId, d.id, d.data())));
      },
      (error) => onError?.(error),
    );
  },

  /**
   * Apre (se serve) la galleria dell'attività e ne allinea la finestra di
   * caricamento alle date. Crea solo se la finestra è aperta, salvo staff.
   */
  async ensureActivityGallery(stakeId: string, activityId: string): Promise<string | null> {
    const result = await activityGalleryCallable({ action: "ensure", stakeId, activityId });
    return result.data.galleryId ?? null;
  },

  /** Segnala un contenuto: la callable lo nasconde subito a tutti tranne allo staff. */
  async reportMedia(
    stakeId: string,
    galleryId: string,
    mediaId: string,
    reason: GalleryReportReason,
  ): Promise<void> {
    await activityGalleryCallable({ action: "report", stakeId, galleryId, mediaId, reason });
  },

  async restoreHiddenMedia(stakeId: string, galleryId: string, mediaId: string): Promise<void> {
    await activityGalleryCallable({ action: "restore", stakeId, galleryId, mediaId });
  },

  async deleteHiddenMedia(stakeId: string, galleryId: string, mediaId: string): Promise<void> {
    await activityGalleryCallable({ action: "delete", stakeId, galleryId, mediaId });
  },

  /**
   * Contenuti nascosti: tutti per lo staff, solo i propri per gli altri
   * (la rule accetta la lista dei membri solo filtrata per uploadedBy).
   */
  subscribeHiddenMedia(
    stakeId: string,
    galleryId: string,
    scope: { staff: true } | { uploadedBy: string },
    onData: (media: HiddenGalleryMedia[]) => void,
    onError?: (error: Error) => void,
  ): Unsubscribe {
    const hidden = collection(galleryDoc(stakeId, galleryId), "hiddenMedia");
    const source =
      "staff" in scope ? hidden : query(hidden, where("uploadedBy", "==", scope.uploadedBy));
    return onSnapshot(
      source,
      (snapshot) => {
        onData(
          snapshot.docs
            .map((d) => mapHiddenMedia(stakeId, galleryId, d.id, d.data()))
            .sort((a, b) => b.hiddenAt.localeCompare(a.hiddenAt)),
        );
      },
      (error) => onError?.(error),
    );
  },

  async listMediaByIds(
    stakeId: string,
    galleryId: string,
    mediaIds: string[],
  ): Promise<GalleryMedia[]> {
    if (mediaIds.length === 0) return [];
    const fetched = await Promise.all(
      mediaIds.map(async (mediaId) => {
        const snap = await getDocCacheFirst(mediaDoc(stakeId, galleryId, mediaId));
        if (!snap.exists()) return null;
        return mapMedia(stakeId, galleryId, snap.id, snap.data());
      }),
    );
    return fetched.filter((value): value is GalleryMedia => Boolean(value));
  },

  reserveMediaId(stakeId: string, galleryId: string): string {
    return doc(mediaCollection(stakeId, galleryId)).id;
  },

  async createMediaDoc(
    stakeId: string,
    galleryId: string,
    mediaId: string,
    payload: Omit<GalleryMedia, "id" | "galleryId" | "stakeId" | "createdAt" | "updatedAt" | "likeCount">,
  ): Promise<GalleryMedia> {
    const ts = nowIso();
    const data = {
      ...payload,
      createdAt: ts,
      updatedAt: ts,
      likeCount: 0,
    };
    const batch = writeBatch(db);
    batch.set(mediaDoc(stakeId, galleryId, mediaId), data);
    batch.update(galleryDoc(stakeId, galleryId), {
      mediaCount: increment(1),
      updatedAt: ts,
    });
    await batch.commit();
    return mapMedia(stakeId, galleryId, mediaId, data);
  },

  async addMedia(
    stakeId: string,
    galleryId: string,
    uploadedBy: string,
    payload: Partial<Omit<GalleryMedia, "id" | "galleryId" | "stakeId" | "createdAt" | "likeCount">> & {
      type: GalleryMediaType;
    },
  ): Promise<GalleryMedia> {
    const ref = doc(mediaCollection(stakeId, galleryId));
    const ts = nowIso();
    const data = {
      type: payload.type,
      activityId: payload.activityId ?? null,
      storagePath: payload.storagePath ?? "",
      storageUrl: payload.storageUrl ?? null,
      originalPath: payload.originalPath ?? null,
      originalUrl: payload.originalUrl ?? null,
      thumbnailPath: payload.thumbnailPath ?? null,
      thumbnailUrl: payload.thumbnailUrl ?? null,
      optimizedPath: payload.optimizedPath ?? null,
      optimizedUrl: payload.optimizedUrl ?? null,
      posterPath: payload.posterPath ?? null,
      posterUrl: payload.posterUrl ?? null,
      width: payload.width ?? null,
      height: payload.height ?? null,
      duration: payload.duration ?? null,
      order: payload.order ?? 0,
      caption: payload.caption ?? "",
      filename: payload.filename ?? "",
      contentType: payload.contentType ?? "",
      sizeBytes: payload.sizeBytes ?? 0,
      status: payload.status ?? ("processing" as const),
      uploadedBy: payload.uploadedBy ?? uploadedBy,
      createdAt: ts,
      updatedAt: ts,
      likeCount: 0,
    };
    const batch = writeBatch(db);
    batch.set(ref, data);
    batch.update(galleryDoc(stakeId, galleryId), {
      mediaCount: increment(1),
      updatedAt: ts,
    });
    await batch.commit();
    return mapMedia(stakeId, galleryId, ref.id, data);
  },

  async updateMedia(
    stakeId: string,
    galleryId: string,
    mediaId: string,
    patch: Partial<GalleryMedia>,
  ): Promise<void> {
    const allowed: Record<string, unknown> = {};
    for (const key of [
      "type",
      "storagePath",
      "storageUrl",
      "originalPath",
      "originalUrl",
      "thumbnailPath",
      "thumbnailUrl",
      "optimizedPath",
      "optimizedUrl",
      "posterPath",
      "posterUrl",
      "width",
      "height",
      "duration",
      "order",
      "caption",
      "filename",
      "contentType",
      "sizeBytes",
      "status",
      "activityId",
    ] as const) {
      if (key in patch) allowed[key] = (patch as Record<string, unknown>)[key];
    }
    if (Object.keys(allowed).length === 0) return;
    allowed.updatedAt = nowIso();
    await updateDoc(mediaDoc(stakeId, galleryId, mediaId), allowed);
  },

  async deleteMedia(
    stakeId: string,
    galleryId: string,
    mediaId: string,
  ): Promise<void> {
    const batch = writeBatch(db);
    batch.delete(mediaDoc(stakeId, galleryId, mediaId));
    batch.update(galleryDoc(stakeId, galleryId), {
      mediaCount: increment(-1),
      updatedAt: nowIso(),
    });
    await batch.commit();
  },

  async getMember(
    stakeId: string,
    galleryId: string,
    uid: string,
  ): Promise<GalleryMember | null> {
    if (!uid) return null;
    const snap = await getDocCacheFirst(memberDoc(stakeId, galleryId, uid));
    if (!snap.exists()) return null;
    return mapMember(snap.id, snap.data());
  },

  async listMembers(stakeId: string, galleryId: string): Promise<GalleryMember[]> {
    const snapshot = await getDocsCacheFirst(membersCollection(stakeId, galleryId));
    return snapshot.docs.map((d) => mapMember(d.id, d.data()));
  },

  async addMemberAsAdmin(
    stakeId: string,
    galleryId: string,
    uid: string,
    profile: { email?: string | null; displayName?: string | null },
  ): Promise<void> {
    const ts = nowIso();
    await setDoc(
      memberDoc(stakeId, galleryId, uid),
      {
        uid,
        email: profile.email ?? null,
        displayName: profile.displayName ?? null,
        unlockedAt: ts,
        unlockedBy: "admin",
        source: "admin_manual",
      },
      { merge: true },
    );
    await setDoc(
      doc(db, "users", uid, "unlockedGalleries", galleryId),
      { galleryId, stakeId, unlockedAt: ts },
      { merge: true },
    );
  },

  async removeMember(
    stakeId: string,
    galleryId: string,
    uid: string,
  ): Promise<void> {
    await deleteDoc(memberDoc(stakeId, galleryId, uid));
    await deleteDoc(doc(db, "users", uid, "unlockedGalleries", galleryId)).catch(
      () => undefined,
    );
  },

  // Used by client touch when admin-only is not available; mirrors function logic.
  // Server-authoritative path is unlockGalleryWithCode callable.
  async listUnlockedForUser(uid: string): Promise<{ galleryId: string; stakeId: string }[]> {
    if (!uid) return [];
    const snap = await getDocsCacheFirst(collection(db, "users", uid, "unlockedGalleries"));
    return snap.docs
      .map((d) => {
        const data = d.data();
        return {
          galleryId: d.id,
          stakeId: typeof data.stakeId === "string" ? data.stakeId : "",
        };
      })
      .filter((entry) => Boolean(entry.stakeId));
  },

  serverTimestampToken: serverTimestamp,
};
