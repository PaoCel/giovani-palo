import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { LikeButton } from "@/components/feed/LikeButton";
import { MediaLightbox } from "@/components/feed/MediaLightbox";
import { MemberLockedNote } from "@/components/membership/MemberLockedNote";
import { useAuth } from "@/hooks/useAuth";
import { useStakeMembership } from "@/hooks/useStakeMembership";
import { onCacheRevalidated } from "@/services/firestore/cacheFirst";
import { feedService } from "@/services/firestore/feedService";
import { galleriesService } from "@/services/firestore/galleriesService";
import { userActivitiesService, type UserActivityItem } from "@/services/firestore/userActivitiesService";
import type { FeedPost, Gallery, GalleryMedia } from "@/types";
import { isCampEvent, isPastEvent } from "@/utils/events";
import { formatEventWindow } from "@/utils/formatters";
import type { MemberAccess } from "@/utils/stakeMembership";
import { eventsService } from "@/services/firestore/eventsService";

interface HomeFeedProps {}

interface ActivityRefMap {
  [activityId: string]: { title: string; window: string; location: string };
}

interface MediaCacheMap {
  [galleryId: string]: GalleryMedia[];
}

interface LikeState {
  posts: Record<string, boolean>;
  media: Record<string, boolean>;
}

function isPermissionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /permission|permissions|insufficient/i.test(message);
}

export function HomeFeed(_: HomeFeedProps) {
  const { session } = useAuth();
  const stakeId = session?.profile.stakeId ?? "";
  const uid = session?.firebaseUser.uid ?? "";
  // Gli annunci si leggono da tutti; foto, video e like sono dei membri del
  // palo (docs/APPARTENENZA_AL_PALO.md): per gli altri quelle letture non
  // partono e la galleria dice perché.
  const { access } = useStakeMembership(stakeId);
  const isMember = access === "member";

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [galleries, setGalleries] = useState<Record<string, Gallery>>({});
  const [activities, setActivities] = useState<ActivityRefMap>({});
  const [campChecklistActivities, setCampChecklistActivities] = useState<UserActivityItem[]>([]);
  const [mediaByGallery, setMediaByGallery] = useState<MediaCacheMap>({});
  const [likes, setLikes] = useState<LikeState>({ posts: {}, media: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [lightbox, setLightbox] = useState<
    { galleryId: string; media: GalleryMedia[]; index: number } | null
  >(null);
  // Alla revoca il visualizzatore si chiude e dimentica i media già aperti.
  useEffect(() => {
    if (!isMember) setLightbox(null);
  }, [isMember]);

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (!stakeId || !uid) {
      setPosts([]);
      setLoading(false);
      return;
    }
    // Finché non si sa se è membro non parte nessuna lettura (niente lampo di
    // "si sbloccano" né richieste negate).
    if (access === "loading") {
      if (!options?.silent) setLoading(true);
      return;
    }
    // Il refresh silenzioso (revalidazione cache-first) non mostra lo
    // skeleton: il feed già a schermo resta finché non arrivano i nuovi dati.
    if (!options?.silent) {
      setLoading(true);
    }
    setError(null);
    try {
      const [feedPosts, registeredActivities] = await Promise.all([
        feedService.listPublishedPosts(stakeId),
        userActivitiesService.listForSession(session, { onlyRegistered: true }),
      ]);
      const registeredActivityIds = new Set(
        registeredActivities
          .filter(({ registration }) => registration?.registrationStatus !== "cancelled")
          .map(({ event }) => event.id),
      );
      const visibleFeedPosts = feedPosts.filter(
        (post) =>
          post.type !== "gallery" ||
          !post.activityId ||
          registeredActivityIds.has(post.activityId),
      );
      const checklistActivities = registeredActivities.filter(
        ({ event, registration }) =>
          Boolean(registration) &&
          registration?.registrationStatus !== "cancelled" &&
          isCampEvent(event) &&
          !isPastEvent(event),
      );

      const galleryIds = Array.from(
        new Set(
          visibleFeedPosts
            .map((post) => post.galleryId)
            .filter((value): value is string => Boolean(value)),
        ),
      );

      const activityIds = Array.from(
        new Set(
          visibleFeedPosts
            .map((post) => post.activityId)
            .filter((value): value is string => Boolean(value)),
        ),
      );

      const [galleryDocs, activityDocs] = await Promise.all([
        isMember
          ? Promise.all(
              galleryIds.map((id) =>
                galleriesService.getGallery(stakeId, id).catch(() => null),
              ),
            )
          : Promise.resolve([] as (Gallery | null)[]),
        Promise.all(activityIds.map((id) => eventsService.getEventById(stakeId, id).catch(() => null))),
      ]);

      const galleryMap: Record<string, Gallery> = {};
      galleryDocs.forEach((gallery) => {
        if (gallery) {
          galleryMap[gallery.id] = gallery;
        }
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

      const galleryPosts = visibleFeedPosts.filter(
        (post) => post.type === "gallery" && post.galleryId,
      );

      const mediaCache: MediaCacheMap = {};
      await Promise.all(
        galleryPosts.map(async (post) => {
          if (!isMember || !post.galleryId) return;
          if (!mediaCache[post.galleryId]) {
            mediaCache[post.galleryId] = await galleriesService
              .listMedia(stakeId, post.galleryId)
              .catch(() => []);
          }
        }),
      );

      const likedPosts = await Promise.all(
        visibleFeedPosts.map(async (post) => ({
          id: post.id,
          liked: isMember
            ? await feedService.hasUserLikedPost(stakeId, post.id, uid).catch(() => false)
            : false,
        })),
      );
      const postLikes: Record<string, boolean> = {};
      likedPosts.forEach(({ id, liked }) => {
        if (liked) postLikes[id] = true;
      });

      setPosts(visibleFeedPosts);
      setCampChecklistActivities(checklistActivities);
      setGalleries(galleryMap);
      setActivities(activityMap);
      setMediaByGallery(mediaCache);
      setLikes((prev) => ({ ...prev, posts: postLikes }));
    } catch (caughtError) {
      if (isPermissionError(caughtError)) {
        setPosts([]);
        setCampChecklistActivities([]);
        setGalleries({});
        setActivities({});
        setMediaByGallery({});
        setLikes((prev) => ({ ...prev, posts: {} }));
        return;
      }

      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Errore nel caricamento del feed.",
      );
    } finally {
      setLoading(false);
    }
  }, [access, isMember, session, stakeId, uid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Le letture cache-first possono dipingere un feed vecchio di una visita:
  // quando il refresh in background trova dati diversi sul server, ricarica.
  useEffect(() => onCacheRevalidated(() => void refresh({ silent: true })), [refresh]);

  const handleTogglePostLike = useCallback(
    async (post: FeedPost) => {
      if (!stakeId || !uid || !isMember) return;
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
    [stakeId, uid, isMember, likes.posts],
  );

  const handleToggleMediaLike = useCallback(
    async (media: GalleryMedia) => {
      if (!stakeId || !uid || !isMember) return;
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
    [stakeId, uid, isMember, likes.media],
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

  if (sortedPosts.length === 0 && campChecklistActivities.length === 0) {
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
          {campChecklistActivities.slice(0, 2).map(({ event }) => (
            <CampChecklistFeedCard key={`camp-checklist-${event.id}`} event={event} />
          ))}
          {sortedPosts.map((post) => {
            const liked = likes.posts[post.id] === true;
            if (post.type === "announcement") {
              return (
                <AnnouncementCard
                  key={post.id}
                  post={post}
                  liked={liked}
                  canLike={isMember}
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
                  canLike={isMember}
                  onToggleLike={() => handleTogglePostLike(post)}
                />
              );
            }
            if (post.type === "gallery" && post.galleryId) {
              const gallery = galleries[post.galleryId];
              const allMedia = mediaByGallery[post.galleryId] ?? [];
              const postMedia = post.mediaIds
                .map((mediaId) => allMedia.find((media) => media.id === mediaId))
                .filter((value): value is GalleryMedia => Boolean(value));
              return (
                <GalleryCard
                  key={post.id}
                  post={post}
                  gallery={gallery}
                  media={postMedia}
                  liked={liked}
                  access={access}
                  onToggleLike={() => handleTogglePostLike(post)}
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

      {lightbox && isMember ? (
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

function CampChecklistFeedCard({ event }: { event: UserActivityItem["event"] }) {
  return (
    <article className="card feed-card feed-card--camp-checklist">
      <header className="feed-card__header">
        <span className="feed-card__kind">Campeggio</span>
        <time className="feed-card__date">{formatEventWindow(event)}</time>
      </header>
      <h3 className="feed-card__title">Prepara lo zaino per {event.title}</h3>
      <p className="feed-card__body">
        Apri la tua scheda per vedere pattuglia, comitati, menu e una checklist interattiva delle
        cose da portare.
      </p>
      <div className="feed-card__actions">
        <Link className="button button--primary button--small" to={`/me/activities/${event.id}`}>
          Apri checklist
        </Link>
      </div>
    </article>
  );
}

interface AnnouncementCardProps {
  post: FeedPost;
  liked: boolean;
  /** I like sono dei membri del palo: per gli altri il pulsante non c'è. */
  canLike: boolean;
  onToggleLike: () => Promise<void>;
}

function AnnouncementCard({ post, liked, canLike, onToggleLike }: AnnouncementCardProps) {
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
      {canLike ? (
        <footer className="feed-card__footer">
          <LikeButton liked={liked} count={post.likeCount} onToggle={onToggleLike} />
        </footer>
      ) : null}
    </article>
  );
}

interface ActivityReminderCardProps {
  post: FeedPost;
  activity?: { title: string; window: string; location: string };
  liked: boolean;
  canLike: boolean;
  onToggleLike: () => Promise<void>;
}

function ActivityReminderCard({
  post,
  activity,
  liked,
  canLike,
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
      {canLike ? (
        <footer className="feed-card__footer">
          <LikeButton liked={liked} count={post.likeCount} onToggle={onToggleLike} />
        </footer>
      ) : null}
    </article>
  );
}

interface GalleryCardProps {
  post: FeedPost;
  gallery?: Gallery;
  media: GalleryMedia[];
  liked: boolean;
  /** Chi non è membro vede il titolo e la frase del palo, mai i media. */
  access: MemberAccess;
  onToggleLike: () => Promise<void>;
  onOpenMedia: (index: number) => void;
  isMediaLiked: (mediaId: string) => boolean;
}

function GalleryCard({
  post,
  gallery,
  media,
  liked,
  access,
  onToggleLike,
  onOpenMedia,
}: GalleryCardProps) {
  const isMember = access === "member";
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

      <div className="gallery-card__content">
        {!isMember ? (
          <MemberLockedNote access={access} kind="foto" />
        ) : media.length > 0 ? (
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
            Non ci sono ancora media in questo gruppo.
          </p>
        )}
      </div>

      {isMember ? (
        <footer className="feed-card__footer">
          <LikeButton liked={liked} count={post.likeCount} onToggle={onToggleLike} />
        </footer>
      ) : null}
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
