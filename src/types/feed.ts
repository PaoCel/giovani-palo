export type FeedPostType = "announcement" | "activity_reminder" | "gallery";
export type FeedPostVisibility =
  | "all_authenticated"
  | "gallery_members"
  | "admins_only";

export interface FeedPost {
  id: string;
  stakeId: string;
  type: FeedPostType;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  published: boolean;
  pinned: boolean;
  publishedAt: string | null;
  activityId: string | null;
  galleryId: string | null;
  galleryBatchIndex: number | null;
  mediaIds: string[];
  likeCount: number;
  visibility: FeedPostVisibility;
  ctaLabel: string | null;
  ctaUrl: string | null;
}

export interface FeedPostWriteInput {
  type: FeedPostType;
  title: string;
  body: string;
  published?: boolean;
  pinned?: boolean;
  activityId?: string | null;
  galleryId?: string | null;
  galleryBatchIndex?: number | null;
  mediaIds?: string[];
  visibility?: FeedPostVisibility;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
}

export type GalleryMediaType = "image" | "video";
export type GalleryMediaStatus = "uploaded" | "processing" | "error";

export interface GalleryMedia {
  id: string;
  galleryId: string;
  stakeId: string;
  activityId: string | null;
  type: GalleryMediaType;
  storagePath: string;
  storageUrl: string | null;
  originalPath: string | null;
  originalUrl: string | null;
  thumbnailPath: string | null;
  thumbnailUrl: string | null;
  optimizedPath: string | null;
  optimizedUrl: string | null;
  posterPath: string | null;
  posterUrl: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  order: number;
  caption: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
  status: GalleryMediaStatus;
  likeCount: number;
}

/** Sempre "open": l'accesso alla galleria lo decide l'appartenenza al palo. */
export type GalleryAccessMode = "open";

export interface Gallery {
  id: string;
  stakeId: string;
  title: string;
  description: string;
  activityId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  published: boolean;
  publishedAt: string | null;
  coverMediaId: string | null;
  coverImageUrl: string | null;
  mediaCount: number;
  batchSize: number;
  accessMode: GalleryAccessMode;
  likeCount: number;
  commentsEnabled: false;
  postsCreated: boolean;
  /** Caricamenti dei membri chiusi a mano da un admin. */
  uploadsClosed: boolean;
  /** Finestra di caricamento (ms epoch) scritta dalla callable activityGallery o da un admin. */
  uploadsOpenFrom: number | null;
  uploadsOpenUntil: number | null;
  /** "manual" se un admin ha riaperto a mano: la finestra non segue più le date. */
  uploadsWindowSource: "activity" | "manual" | null;
}

export type GalleryReportReason = "mine" | "inappropriate" | "off_topic";

/** Contenuto nascosto da una segnalazione: lo vedono lo staff e chi l'ha caricato. */
export interface HiddenGalleryMedia extends GalleryMedia {
  hiddenAt: string;
  hiddenBy: string;
  hiddenReason: GalleryReportReason;
}

export interface GalleryComment {
  id: string;
  uid: string;
  displayName: string;
  body: string;
  createdAt: string;
}

export interface GalleryUnlockedRef {
  galleryId: string;
  stakeId: string;
  unlockedAt: string;
}

export interface GalleryWriteInput {
  title: string;
  description?: string;
  activityId?: string | null;
  coverImageUrl?: string | null;
  coverMediaId?: string | null;
  published?: boolean;
}
