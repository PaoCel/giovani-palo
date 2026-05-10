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

export type GalleryCodeStatus = "set" | "missing";
export type GalleryAccessMode = "code_required" | "open";

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
  codeStatus: GalleryCodeStatus;
}

export interface GalleryMember {
  uid: string;
  email: string | null;
  displayName: string | null;
  unlockedAt: string;
  unlockedBy: "code" | "admin";
  source: "home_code_prompt" | "admin_manual";
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
