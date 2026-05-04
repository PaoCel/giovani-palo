import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

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
  const [previewMedia, setPreviewMedia] = useState<Record<string, GalleryMedia[]>>({});
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

        const galleryMap: Record<string, GalleryDoc> = {};
        galleriesData.forEach((gallery) => {
          if (gallery) galleryMap[gallery.id] = gallery;
        });
        if (!cancelled) setGalleries(galleryMap);
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

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    const galleryIds = Array.from(
      new Set(posts.filter((p) => p.galleryId).map((p) => p.galleryId as string)),
    );
    if (galleryIds.length === 0) return;
    Promise.all(
      galleryIds.map(async (galleryId) => {
        try {
          const granted = await galleriesService.hasMembership(
            stakeId,
            galleryId,
            (await import("firebase/auth")).getAuth().currentUser?.uid ?? "",
          );
          return [galleryId, granted] as const;
        } catch {
          return [galleryId, false] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      const next: Record<string, boolean> = {};
      for (const [galleryId, granted] of entries) next[galleryId] = granted;
      setMemberships(next);
    });
    return () => {
      cancelled = true;
    };
  }, [posts, stakeId, signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    posts.forEach(async (post) => {
      if (
        post.type !== "gallery" ||
        !post.galleryId ||
        post.mediaIds.length === 0 ||
        previewMedia[post.id] ||
        !memberships[post.galleryId]
      ) {
        return;
      }
      try {
        const ids = post.mediaIds.slice(0, 6);
        const media = await galleriesService.listMediaByIds(
          stakeId,
          post.galleryId,
          ids,
        );
        if (cancelled) return;
        setPreviewMedia((current) => ({ ...current, [post.id]: media }));
      } catch {
        // ignored
      }
    });
    return () => {
      cancelled = true;
    };
  }, [posts, memberships, signedIn, stakeId, previewMedia]);

  if (loading) return <p className="subtle-text">Caricamento feed...</p>;
  if (error) return <p className="field-error">{error}</p>;
  if (posts.length === 0) return null;

  return (
    <div className="stack home-feed">
      {posts.map((post) => {
        const gallery = post.galleryId ? galleries[post.galleryId] : null;
        const isMember = post.galleryId ? memberships[post.galleryId] === true : false;
        const media = previewMedia[post.id] ?? [];
        return (
          <article key={post.id} className="surface-panel home-feed__card">
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
                ) : !isMember ? (
                  <Link
                    className="button button--primary button--small"
                    to={`/me/galleria/${post.galleryId}`}
                  >
                    Sblocca con codice
                  </Link>
                ) : media.length > 0 ? (
                  <>
                    <div className="home-feed__grid">
                      {media.map((item) => {
                        const src =
                          item.thumbnailUrl ?? item.optimizedUrl ?? item.posterUrl ?? item.storageUrl ?? "";
                        return (
                          <Link
                            key={item.id}
                            to={`/me/galleria/${post.galleryId}`}
                            className="home-feed__tile"
                          >
                            {src ? <img src={src} alt={item.filename} loading="lazy" /> : null}
                            {item.type === "video" ? (
                              <span className="home-feed__video-badge">▶</span>
                            ) : null}
                          </Link>
                        );
                      })}
                    </div>
                    <Link
                      className="button button--ghost button--small"
                      to={`/me/galleria/${post.galleryId}`}
                    >
                      Apri galleria{gallery?.mediaCount ? ` (${gallery.mediaCount})` : ""}
                    </Link>
                  </>
                ) : (
                  <Link
                    className="button button--ghost button--small"
                    to={`/me/galleria/${post.galleryId}`}
                  >
                    Apri galleria
                  </Link>
                )}
              </>
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
          </article>
        );
      })}
    </div>
  );
}
