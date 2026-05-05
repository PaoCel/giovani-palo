import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { LikeButton } from "@/components/feed/LikeButton";
import { GalleryUnlockForm } from "@/components/feed/GalleryUnlockForm";
import { MediaLightbox } from "@/components/feed/MediaLightbox";
import { useAuth } from "@/hooks/useAuth";
import { feedService } from "@/services/firestore/feedService";
import { galleriesService } from "@/services/firestore/galleriesService";
import { galleryUnlockService } from "@/services/firestore/galleryUnlockService";
import type { FeedPost, Gallery, GalleryMedia } from "@/types";
import { formatEventWindow } from "@/utils/formatters";
import { eventsService } from "@/services/firestore/eventsService";

interface HomeFeedProps {}

interface ActivityRefMap {
  [activityId: string]: { title: string; window: string; location: string };
}

interface MediaCacheMap {
  [galleryId: string]: GalleryMedia[];
}

interface UnlockedSet {
  [galleryId: string]: true;
}

interface LikeState {
  posts: Record<string, boolean>;
  media: Record<string, boolean>;
}

export function HomeFeed(_: HomeFeedProps) {
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId ?? "";
  const uid = session?.firebaseUser.uid ?? "";

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [galleries, setGalleries] = useState<Record<string, Gallery>>({});
  const [activities, setActivities] = useState<ActivityRefMap>({});
  const [unlocked, setUnlocked] = useState<UnlockedSet>({});
  const [mediaByGallery, setMediaByGallery] = useState<MediaCacheMap>({});
  const [likes, setLikes] = useState<LikeState>({ posts: {}, media: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [lightbox, setLightbox] = useState<
    { galleryId: string; media: GalleryMedia[]; index: number } | null
  >(null);

  const refresh = useCallback(async () => {
    if (!stakeId || !uid) {
      setPosts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [feedPosts, unlockedRefs] = await Promise.all([
        feedService.listPublishedPosts(stakeId),
        galleriesService.listUnlockedForUser(uid),
      ]);

      const unlockedMap: UnlockedSet = {};
      for (const ref of unlockedRefs) {
        if (ref.stakeId === stakeId) unlockedMap[ref.galleryId] = true;
      }

      const galleryIds = Array.from(
        new Set(
          feedPosts
            .map((post) => post.galleryId)
            .filter((value): value is string => Boolean(value)),
        ),
      );
      const activityIds = Array.from(
        new Set(
          feedPosts
            .map((post) => post.activityId)
            .filter((value): value is string => Boolean(value)),
        ),
      );

      const [galleryDocs, activityDocs] = await Promise.all([
        Promise.all(galleryIds.map((id) => galleriesService.getGallery(stakeId, id))),
        Promise.all(activityIds.map((id) => eventsService.getEventById(stakeId, id).catch(() => null))),
      ]);

      const galleryMap: Record<string, Gallery> = {};
      galleryDocs.forEach((gallery) => {
        if (gallery) galleryMap[gallery.id] = gallery;
      });

      const activityMap: ActivityRefMap = {};
      activityDocs.forEach((event) => {
        if (event) {
          activityMap[event.id] = {
            title: event.title,
            window: formatEventWindow(event),
            location: event.location ?? "",
          };
        }
      });

      const galleryPosts = feedPosts.filter(
        (post) => post.type === "gallery" && post.galleryId,
      );
      const unlockedGalleryPosts = galleryPosts.filter(
        (post) => post.galleryId && unlockedMap[post.galleryId],
      );

      const mediaCache: MediaCacheMap = {};
      await Promise.all(
        unlockedGalleryPosts.map(async (post) => {
          if (!post.galleryId) return;
          if (!mediaCache[post.galleryId]) {
            mediaCache[post.galleryId] = await galleriesService
              .listMedia(stakeId, post.galleryId)
              .catch(() => []);
          }
        }),
      );

      const likedPosts = await Promise.all(
        feedPosts.map(async (post) => ({
          id: post.id,
          liked: await feedService.hasUserLikedPost(stakeId, post.id, uid),
        })),
      );
      const postLikes: Record<string, boolean> = {};
      likedPosts.forEach(({ id, liked }) => {
        if (liked) postLikes[id] = true;
      });

      setPosts(feedPosts);
      setGalleries(galleryMap);
      setActivities(activityMap);
      setUnlocked(unlockedMap);
      setMediaByGallery(mediaCache);
      setLikes((prev) => ({ ...prev, posts: postLikes }));
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Errore nel caricamento del feed.",
      );
    } finally {
      setLoading(false);
    }
  }, [stakeId, uid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleUnlock = useCallback(
    async (galleryId: string, code: string) => {
      if (!stakeId) {
        return { success: false, message: "Sessione non disponibile." };
      }
      const result = await galleryUnlockService.unlock({ stakeId, galleryId, code });
      if (!result.success) {
        return { success: false, message: result.message ?? "Codice non valido." };
      }
      setUnlocked((prev) => ({ ...prev, [galleryId]: true }));
      const media = await galleriesService.listMedia(stakeId, galleryId).catch(() => []);
      setMediaByGallery((prev) => ({ ...prev, [galleryId]: media }));
      return { success: true };
    },
    [stakeId],
  );

  const handleTogglePostLike = useCallback(
    async (post: FeedPost) => {
      if (!stakeId || !uid) return;
      const wasLiked = likes.posts[post.id] === true;
      try {
        if (wasLiked) {
          await feedService.unlikePost(stakeId, post.id, uid);
        } else {
          await feedService.likePost(stakeId, post.id, uid);
        }
        setLikes((prev) => ({
          ...prev,
          posts: { ...prev.posts, [post.id]: !wasLiked },
        }));
        setPosts((prev) =>
          prev.map((entry) =>
            entry.id === post.id
              ? {
                  ...entry,
                  likeCount: Math.max(0, entry.likeCount + (wasLiked ? -1 : 1)),
                }
              : entry,
          ),
        );
      } catch (likeError) {
        console.error("Like fallito", likeError);
      }
    },
    [stakeId, uid, likes.posts],
  );

  const handleToggleMediaLike = useCallback(
    async (media: GalleryMedia) => {
      if (!stakeId || !uid) return;
      const wasLiked = likes.media[media.id] === true;
      try {
        if (wasLiked) {
          await feedService.unlikeMedia(stakeId, media.galleryId, media.id, uid);
        } else {
          await feedService.likeMedia(stakeId, media.galleryId, media.id, uid);
        }
        setLikes((prev) => ({
          ...prev,
          media: { ...prev.media, [media.id]: !wasLiked },
        }));
        setMediaByGallery((prev) => {
          const list = prev[media.galleryId];
          if (!list) return prev;
          return {
            ...prev,
            [media.galleryId]: list.map((item) =>
              item.id === media.id
                ? {
                    ...item,
                    likeCount: Math.max(0, item.likeCount + (wasLiked ? -1 : 1)),
                  }
                : item,
            ),
          };
        });
      } catch (likeError) {
        console.error("Like media fallito", likeError);
      }
    },
    [stakeId, uid, likes.media],
  );

  const lightboxMediaIsLiked = useCallback(
    (mediaId: string) => likes.media[mediaId] === true,
    [likes.media],
  );

  const sortedPosts = useMemo(() => posts, [posts]);

  if (loading) {
    return (
      <div className="feed-section">
        <p className="subtle-text">Carico il feed…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="feed-section">
        <div className="notice notice--warning">
          <h3>Impossibile caricare il feed</h3>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (sortedPosts.length === 0) {
    return (
      <div className="feed-section">
        <p className="subtle-text">
          Quando i responsabili pubblicheranno annunci o gallerie li troverai qui.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="feed-section">
        <div className="feed-stack">
          {sortedPosts.map((post) => {
            const liked = likes.posts[post.id] === true;
            if (post.type === "announcement") {
              return (
                <AnnouncementCard
                  key={post.id}
                  post={post}
                  liked={liked}
                  onToggleLike={() => handleTogglePostLike(post)}
                />
              );
            }
            if (post.type === "activity_reminder") {
              return (
                <ActivityReminderCard
                  key={post.id}
                  post={post}
                  activity={post.activityId ? activities[post.activityId] : undefined}
                  liked={liked}
                  onToggleLike={() => handleTogglePostLike(post)}
                />
              );
            }
            if (post.type === "gallery" && post.galleryId) {
              const gallery = galleries[post.galleryId];
              const isUnlocked = Boolean(unlocked[post.galleryId]);
              const allMedia = mediaByGallery[post.galleryId] ?? [];
              const postMedia = post.mediaIds
                .map((mediaId) => allMedia.find((media) => media.id === mediaId))
                .filter((value): value is GalleryMedia => Boolean(value));
              return (
                <GalleryCard
                  key={post.id}
                  post={post}
                  gallery={gallery}
                  unlocked={isUnlocked}
                  media={postMedia}
                  liked={liked}
                  onToggleLike={() => handleTogglePostLike(post)}
                  onUnlock={(code) =>
                    handleUnlock(post.galleryId as string, code)
                  }
                  onOpenMedia={(index) =>
                    setLightbox({
                      galleryId: post.galleryId as string,
                      media: postMedia,
                      index,
                    })
                  }
                  isMediaLiked={lightboxMediaIsLiked}
                />
              );
            }
            return null;
          })}
        </div>
      </div>

      {lightbox ? (
        <MediaLightbox
          media={lightbox.media}
          initialIndex={lightbox.index}
          isMediaLiked={lightboxMediaIsLiked}
          onClose={() => setLightbox(null)}
          onToggleMediaLike={handleToggleMediaLike}
        />
      ) : null}
    </>
  );
}

interface AnnouncementCardProps {
  post: FeedPost;
  liked: boolean;
  onToggleLike: () => Promise<void>;
}

function AnnouncementCard({ post, liked, onToggleLike }: AnnouncementCardProps) {
  return (
    <article className="card feed-card feed-card--announcement">
      <header className="feed-card__header">
        <span className="feed-card__kind">Annuncio</span>
        <time className="feed-card__date">{formatPostDate(post)}</time>
      </header>
      <h3 className="feed-card__title">{post.title}</h3>
      {post.body ? <p className="feed-card__body">{post.body}</p> : null}
      {post.ctaUrl && post.ctaLabel ? (
        <a className="button button--primary button--small" href={post.ctaUrl}>
          {post.ctaLabel}
        </a>
      ) : null}
      <footer className="feed-card__footer">
        <LikeButton liked={liked} count={post.likeCount} onToggle={onToggleLike} />
      </footer>
    </article>
  );
}

interface ActivityReminderCardProps {
  post: FeedPost;
  activity?: { title: string; window: string; location: string };
  liked: boolean;
  onToggleLike: () => Promise<void>;
}

function ActivityReminderCard({
  post,
  activity,
  liked,
  onToggleLike,
}: ActivityReminderCardProps) {
  return (
    <article className="card feed-card feed-card--activity">
      <header className="feed-card__header">
        <span className="feed-card__kind">Attività</span>
        <time className="feed-card__date">{formatPostDate(post)}</time>
      </header>
      <h3 className="feed-card__title">{post.title || activity?.title || "Attività"}</h3>
      {activity ? (
        <p className="feed-card__meta">
          {activity.window}
          {activity.location ? ` — ${activity.location}` : ""}
        </p>
      ) : null}
      {post.body ? <p className="feed-card__body">{post.body}</p> : null}
      <div className="feed-card__actions">
        {post.activityId ? (
          <Link
            className="button button--primary button--small"
            to={`/me/activities/${post.activityId}`}
          >
            Apri attività
          </Link>
        ) : null}
      </div>
      <footer className="feed-card__footer">
        <LikeButton liked={liked} count={post.likeCount} onToggle={onToggleLike} />
      </footer>
    </article>
  );
}

interface GalleryCardProps {
  post: FeedPost;
  gallery?: Gallery;
  unlocked: boolean;
  media: GalleryMedia[];
  liked: boolean;
  onToggleLike: () => Promise<void>;
  onUnlock: (code: string) => Promise<{ success: boolean; message?: string }>;
  onOpenMedia: (index: number) => void;
  isMediaLiked: (mediaId: string) => boolean;
}

function GalleryCard({
  post,
  gallery,
  unlocked,
  media,
  liked,
  onToggleLike,
  onUnlock,
  onOpenMedia,
}: GalleryCardProps) {
  const totalBatches = useMemo(() => {
    if (!gallery) return null;
    if (gallery.mediaCount === 0) return null;
    return Math.max(1, Math.ceil(gallery.mediaCount / Math.max(1, gallery.batchSize || 10)));
  }, [gallery]);

  return (
    <article className="card feed-card feed-card--gallery">
      <header className="feed-card__header">
        <span className="feed-card__kind">Galleria</span>
        <time className="feed-card__date">{formatPostDate(post)}</time>
      </header>
      <h3 className="feed-card__title">{post.title || gallery?.title || "Galleria"}</h3>
      {post.body ? <p className="feed-card__body">{post.body}</p> : null}

      {!unlocked ? (
        <div className="gallery-card__locked">
          <div
            className="gallery-card__cover gallery-card__cover--locked"
            style={{
              backgroundImage: gallery?.coverImageUrl
                ? `url(${gallery.coverImageUrl})`
                : undefined,
            }}
          >
            <div className="gallery-card__lock-badge">🔒</div>
          </div>
          <p className="feed-card__hint">
            Inserisci il codice ricevuto dai responsabili per vedere foto e video.
          </p>
          <GalleryUnlockForm onUnlock={onUnlock} />
        </div>
      ) : (
        <div className="gallery-card__unlocked">
          {media.length > 0 ? (
            <>
              <div className="gallery-carousel" role="list">
                {media.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    className="gallery-carousel__item"
                    onClick={() => onOpenMedia(index)}
                    role="listitem"
                    aria-label={`Apri ${item.type === "video" ? "video" : "foto"} ${index + 1} di ${media.length}`}
                  >
                    {item.type === "image" ? (
                      <img
                        src={item.thumbnailUrl ?? item.optimizedUrl ?? item.storageUrl ?? ""}
                        alt={item.caption || `Foto ${index + 1}`}
                        loading="lazy"
                      />
                    ) : (
                      <>
                        <img
                          src={item.posterUrl ?? item.thumbnailUrl ?? ""}
                          alt={item.caption || `Video ${index + 1}`}
                          loading="lazy"
                        />
                        <span className="gallery-carousel__play" aria-hidden="true">▶</span>
                      </>
                    )}
                  </button>
                ))}
              </div>
              <div className="gallery-card__meta-row">
                <span className="gallery-card__counter">
                  {post.galleryBatchIndex !== null && totalBatches && totalBatches > 1
                    ? `Parte ${post.galleryBatchIndex + 1}/${totalBatches} · ${media.length} elementi`
                    : `${media.length} elementi`}
                </span>
              </div>
            </>
          ) : (
            <p className="subtle-text">
              La galleria è stata sbloccata, ma non ci sono ancora media in questo gruppo.
            </p>
          )}
        </div>
      )}

      <footer className="feed-card__footer">
        <LikeButton liked={liked} count={post.likeCount} onToggle={onToggleLike} />
      </footer>
    </article>
  );
}

function formatPostDate(post: FeedPost) {
  const iso = post.publishedAt ?? post.createdAt;
  try {
    return new Date(iso).toLocaleDateString("it-IT", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}
