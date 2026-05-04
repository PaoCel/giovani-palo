import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { CommentSection } from "@/components/CommentSection";
import { LikeButton } from "@/components/LikeButton";
import { PolaroidLightbox } from "@/components/PolaroidLightbox";
import { PostCarousel } from "@/components/PostCarousel";
import { useAuth } from "@/hooks/useAuth";
import {
  feedPostsService,
  type FeedPost,
} from "@/services/firestore/feedPostsService";
import {
  galleriesService,
  type GalleryDoc,
  type GalleryMedia,
} from "@/services/firestore/galleriesService";

interface HomeFeedProps {
  stakeId: string;
  signedIn: boolean;
}

export function HomeFeed({ stakeId, signedIn }: HomeFeedProps) {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [galleries, setGalleries] = useState<Record<string, GalleryDoc>>({});
  const [memberships, setMemberships] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    feedPostsService
      .listPublishedPosts(stakeId)
      .then(async (list) => {
        if (cancelled) return;
        setPosts(list);
        const galleryIds = Array.from(
          new Set(
            list
              .filter((post) => post.type === "gallery" && post.galleryId)
              .map((post) => post.galleryId as string),
          ),
        );
        if (galleryIds.length === 0) return;
        const galleriesData = await Promise.all(
          galleryIds.map((galleryId) =>
            galleriesService.getGallery(stakeId, galleryId).catch(() => null),
          ),
        );
        const map: Record<string, GalleryDoc> = {};
        galleriesData.forEach((gallery) => {
          if (gallery) map[gallery.id] = gallery;
        });
        if (!cancelled) setGalleries(map);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Errore caricamento feed.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [stakeId]);

  if (loading) return <p className="subtle-text">Caricamento feed...</p>;
  if (error) return <p className="field-error">{error}</p>;
  if (posts.length === 0) return <p className="subtle-text">Nessun post per ora.</p>;

  return (
    <div className="stack home-feed">
      {posts.map((post) => (
        <FeedPostCard
          key={post.id}
          post={post}
          stakeId={stakeId}
          signedIn={signedIn}
          gallery={post.galleryId ? galleries[post.galleryId] : undefined}
          membership={
            post.galleryId ? memberships[post.galleryId] === true : false
          }
          onMembershipResolved={(galleryId, granted) =>
            setMemberships((current) => ({ ...current, [galleryId]: granted }))
          }
        />
      ))}
    </div>
  );
}

interface FeedPostCardProps {
  post: FeedPost;
  stakeId: string;
  signedIn: boolean;
  gallery?: GalleryDoc;
  membership: boolean;
  onMembershipResolved: (galleryId: string, granted: boolean) => void;
}

function FeedPostCard({
  post,
  stakeId,
  signedIn,
  gallery,
  membership,
  onMembershipResolved,
}: FeedPostCardProps) {
  const { session } = useAuth();
  const [media, setMedia] = useState<GalleryMedia[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [likeBusy, setLikeBusy] = useState(false);

  useEffect(() => {
    setLikeCount(post.likeCount);
  }, [post.likeCount]);

  useEffect(() => {
    if (!signedIn || !post.galleryId || !session) return;
    let cancelled = false;
    galleriesService
      .hasMembership(stakeId, post.galleryId, session.firebaseUser.uid)
      .then((granted) => {
        if (!cancelled) onMembershipResolved(post.galleryId as string, granted);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [signedIn, post.galleryId, session, stakeId, onMembershipResolved]);

  useEffect(() => {
    if (!signedIn || !session) return;
    let cancelled = false;
    feedPostsService
      .hasUserLikedPost(stakeId, post.id, session.firebaseUser.uid)
      .then((value) => {
        if (!cancelled) setLiked(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [signedIn, session, stakeId, post.id]);

  useEffect(() => {
    if (
      post.type !== "gallery" ||
      !post.galleryId ||
      post.mediaIds.length === 0 ||
      !membership
    )
      return;
    let cancelled = false;
    setMediaLoading(true);
    galleriesService
      .listMediaByIds(stakeId, post.galleryId, post.mediaIds)
      .then((list) => {
        if (cancelled) return;
        const ordered = post.mediaIds
          .map((id) => list.find((item) => item.id === id))
          .filter((value): value is GalleryMedia => Boolean(value));
        setMedia(ordered);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setMediaLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [post.galleryId, post.mediaIds, post.type, membership, stakeId]);

  async function togglePostLike() {
    if (!session || likeBusy) return;
    setLikeBusy(true);
    try {
      const result = await feedPostsService.togglePostLike(
        stakeId,
        post.id,
        session.firebaseUser.uid,
      );
      setLiked(result.liked);
      setLikeCount(result.likeCount);
    } catch {
      // silent
    } finally {
      setLikeBusy(false);
    }
  }

  return (
    <article className="surface-panel home-feed__card">
      <header className="home-feed__head">
        <h3>{post.title}</h3>
        {post.publishedAt ? (
          <span className="subtle-text">
            {new Date(post.publishedAt).toLocaleDateString("it-IT", {
              day: "2-digit",
              month: "long",
              year: "numeric",
            })}
          </span>
        ) : null}
      </header>

      {post.body ? <p>{post.body}</p> : null}

      {post.type === "gallery" && post.galleryId ? (
        <>
          {!signedIn ? (
            <p className="subtle-text">
              Accedi per vedere le foto.{" "}
              <Link to="/login">Login</Link>
            </p>
          ) : !membership ? (
            <Link
              className="button button--primary button--small"
              to={`/me/galleria/${post.galleryId}`}
            >
              Sblocca con codice
            </Link>
          ) : mediaLoading ? (
            <p className="subtle-text">Caricamento foto...</p>
          ) : media.length > 0 ? (
            <PostCarousel
              media={media}
              onSelect={(_, index) => setLightboxIndex(index)}
            />
          ) : null}
        </>
      ) : null}

      <div className="home-feed__actions">
        {signedIn ? (
          <LikeButton
            liked={liked}
            count={likeCount}
            busy={likeBusy}
            onToggle={togglePostLike}
          />
        ) : (
          <span className="like-button like-button--medium" aria-disabled="true">
            <span className="like-button__heart">♡</span>
            <span className="like-button__count">{likeCount}</span>
          </span>
        )}

        {post.galleryId && membership ? (
          <Link
            className="button button--ghost button--small"
            to={`/me/galleria/${post.galleryId}`}
          >
            Apri galleria{gallery?.mediaCount ? ` (${gallery.mediaCount})` : ""}
          </Link>
        ) : null}

        {post.ctaLabel && post.ctaUrl ? (
          <a
            className="button button--ghost button--small"
            href={post.ctaUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            {post.ctaLabel}
          </a>
        ) : null}
      </div>

      {signedIn ? <CommentSection stakeId={stakeId} postId={post.id} /> : null}

      {lightboxIndex !== null && post.galleryId ? (
        <PolaroidLightbox
          stakeId={stakeId}
          galleryId={post.galleryId}
          media={media}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      ) : null}
    </article>
  );
}
