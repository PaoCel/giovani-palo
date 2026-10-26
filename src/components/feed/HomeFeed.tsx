import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import "@/styles/homeSocial.css";
import giovani from "@/assets/flusso-genitore/giovani.webp";
import { useUploadApi } from "@/app/providers/UploadManagerProvider";
import { AppIcon } from "@/components/AppIcon";
import { LikeButton } from "@/components/feed/LikeButton";
import { MediaLightbox } from "@/components/feed/MediaLightbox";
import { ReportMediaSheet } from "@/components/gallery/ReportMediaSheet";
import { activityMediaPath } from "@/components/gallery/ActivityMediaCard";
import { MemberLockedNote } from "@/components/membership/MemberLockedNote";
import { useAuth } from "@/hooks/useAuth";
import { useGalleryAccess } from "@/hooks/useActivityGallery";
import { onCacheRevalidated } from "@/services/firestore/cacheFirst";
import { feedService } from "@/services/firestore/feedService";
import { galleriesService } from "@/services/firestore/galleriesService";
import { userActivitiesService, type UserActivityItem } from "@/services/firestore/userActivitiesService";
import { eventsService } from "@/services/firestore/eventsService";
import type { FeedPost, Gallery, GalleryMedia, GalleryReportReason } from "@/types";
import { isGalleryUploadOpen } from "@/utils/galleryWindow";
import { isCampEvent, isPastEvent } from "@/utils/events";
import { getActivityPath } from "@/utils/activityLinks";
import { formatEventWindow } from "@/utils/formatters";
import type { MemberAccess } from "@/utils/stakeMembership";

interface ActivityRefMap {
  [activityId: string]: { title: string; window: string; location: string };
}
interface FeedState {
  key: string;
  posts: FeedPost[];
  galleries: Record<string, Gallery>;
  activities: ActivityRefMap;
  checklist: UserActivityItem[];
  media: Record<string, GalleryMedia[]>;
  likes: { posts: Record<string, boolean>; media: Record<string, boolean> };
  loading: boolean;
  error: string | null;
}
const emptyFeed = (key: string, loading = false): FeedState => ({
  key, posts: [], galleries: {}, activities: {}, checklist: [], media: {},
  likes: { posts: {}, media: {} }, loading, error: null,
});

type Filter = "all" | "media" | "updates";

export function HomeFeed() {
  const { session } = useAuth();
  const { pickMedia } = useUploadApi();
  const navigate = useNavigate();
  const stakeId = session?.profile.stakeId ?? "";
  const uid = session?.firebaseUser.uid ?? "";
  const { access, canUpload } = useGalleryAccess(stakeId);
  const isMember = access === "member";
  const context = `${uid}:${stakeId}:${access}:${canUpload}`;
  const contextRef = useRef(context);
  contextRef.current = context;
  const requestRef = useRef(0);
  const [state, setState] = useState<FeedState>(() => emptyFeed(context, true));
  const data = state.key === context && isMember ? state : emptyFeed(context, access === "loading");
  const [filter, setFilter] = useState<Filter>("all");
  const [online, setOnline] = useState(() => navigator.onLine);
  const [lightbox, setLightbox] = useState<{ key: string; galleryId: string; media: GalleryMedia[]; index: number } | null>(null);
  const [reporting, setReporting] = useState<GalleryMedia | null>(null);
  const [notice, setNotice] = useState("");
  const reportRun = useRef(0);
  const reportPending = useRef(false);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    setLightbox(null);
    reportRun.current += 1;
    reportPending.current = false;
    setReporting(null);
    setNotice("");
    setFilter("all");
    if (!isMember) setState(emptyFeed(context));
  }, [context, isMember]);

  const refresh = useCallback(async (silent = false) => {
    const request = ++requestRef.current;
    const isCurrent = () => request === requestRef.current && context === contextRef.current;
    if (!stakeId || !uid || !isMember) {
      setState(emptyFeed(context, access === "loading"));
      return;
    }
    if (!silent) setState(previous => previous.key === context
      ? { ...previous, loading: true, error: null } : emptyFeed(context, true));
    try {
      const [posts, registered] = await Promise.all([
        feedService.listPublishedPosts(stakeId),
        userActivitiesService.listForSession(session, { onlyRegistered: true }),
      ]);
      const activityIds = new Set(registered.filter(item => item.registration?.registrationStatus !== "cancelled").map(item => item.event.id));
      const visible = posts.filter(post => post.type !== "gallery" || !post.activityId || activityIds.has(post.activityId));
      const galleryIds = [...new Set(visible.map(post => post.galleryId).filter((id): id is string => Boolean(id)))];
      const eventIds = [...new Set(visible.map(post => post.activityId).filter((id): id is string => Boolean(id)))];
      const [galleryDocs, eventDocs, mediaLists, postLikes] = await Promise.all([
        Promise.all(galleryIds.map(id => galleriesService.getGallery(stakeId, id))),
        Promise.all(eventIds.map(id => eventsService.getEventById(stakeId, id))),
        Promise.all(galleryIds.map(id => galleriesService.listMedia(stakeId, id))),
        Promise.all(visible.map(async post => [post.id, await feedService.hasUserLikedPost(stakeId, post.id, uid)] as const)),
      ]);
      const media = Object.fromEntries(galleryIds.map((id, index) => [id, mediaLists[index]]));
      const previewMedia = new Map(visible.flatMap(post => (media[post.galleryId ?? ""] ?? [])
        .filter(item => post.mediaIds.includes(item.id))).map(item => [`${item.galleryId}/${item.id}`, item]));
      const mediaLikes = await Promise.all([...previewMedia.values()].map(async item =>
        [`${item.galleryId}/${item.id}`, await feedService.hasUserLikedMedia(stakeId, item.galleryId, item.id, uid)] as const));
      if (!isCurrent()) return;
      setState({
        key: context, posts: visible,
        galleries: Object.fromEntries(galleryDocs.filter((item): item is Gallery => item !== null).map(item => [item.id, item])),
        activities: Object.fromEntries(eventDocs.filter(item => item !== null).map(item => [item.id, { title: item.title, window: formatEventWindow(item), location: item.location ?? "" }])),
        checklist: registered.filter(({ event, registration }) => Boolean(registration) && registration?.registrationStatus !== "cancelled" && isCampEvent(event) && !isPastEvent(event)),
        media, likes: { posts: Object.fromEntries(postLikes), media: Object.fromEntries(mediaLikes) }, loading: false, error: null,
      });
      setLightbox(previous => {
        if (!previous || previous.key !== context) return null;
        const available = media[previous.galleryId] ?? [];
        // Do not silently replace a deleted or hidden photo with its neighbour.
        if (!previous.media.every(item => available.some(next => next.id === item.id))) return null;
        return { ...previous, media: previous.media.map(item => available.find(next => next.id === item.id)!) };
      });
    } catch (error) {
      if (!isCurrent()) return;
      const code = (error as { code?: string })?.code ?? "";
      const denied = code.endsWith("permission-denied");
      if (denied) { setLightbox(null); setReporting(null); }
      setState(previous => ({ ...(!denied && previous.key === context ? previous : emptyFeed(context)), loading: false,
        error: code.endsWith("permission-denied") ? "L'accesso ai contenuti è cambiato. Riprova per aggiornare la pagina." : "Non riesco a caricare le novità. Controlla la connessione e riprova." }));
    }
  }, [access, context, isMember, session, stakeId, uid]);

  useEffect(() => {
    void refresh();
    return () => { requestRef.current += 1; };
  }, [refresh]);
  useEffect(() => onCacheRevalidated(() => void refresh(true)), [refresh]);

  const handleTogglePostLike = useCallback(async (post: FeedPost) => {
    if (!isMember || !navigator.onLine || contextRef.current !== context) throw new Error("Connettiti per mettere Mi piace.");
    const liked = data.likes.posts[post.id] === true;
    await (liked ? feedService.unlikePost(stakeId, post.id, uid) : feedService.likePost(stakeId, post.id, uid));
    if (contextRef.current !== context) return;
    setState(previous => previous.key !== context ? previous : ({ ...previous,
      likes: { ...previous.likes, posts: { ...previous.likes.posts, [post.id]: !liked } },
      posts: previous.posts.map(item => item.id !== post.id ? item : { ...item, likeCount: Math.max(0, item.likeCount + (liked ? -1 : 1)) }),
    }));
  }, [context, data.likes.posts, isMember, stakeId, uid]);

  const handleToggleMediaLike = useCallback(async (item: GalleryMedia) => {
    if (!isMember || !navigator.onLine || contextRef.current !== context) throw new Error("Connettiti per mettere Mi piace.");
    const mediaLikeKey = `${item.galleryId}/${item.id}`;
    const liked = data.likes.media[mediaLikeKey] === true;
    await (liked ? feedService.unlikeMedia(stakeId, item.galleryId, item.id, uid) : feedService.likeMedia(stakeId, item.galleryId, item.id, uid));
    if (contextRef.current !== context) return;
    const update = (entry: GalleryMedia) => entry.id === item.id ? { ...entry, likeCount: Math.max(0, entry.likeCount + (liked ? -1 : 1)) } : entry;
    setState(previous => previous.key !== context ? previous : ({ ...previous,
      likes: { ...previous.likes, media: { ...previous.likes.media, [mediaLikeKey]: !liked } },
      media: { ...previous.media, [item.galleryId]: (previous.media[item.galleryId] ?? []).map(update) },
    }));
    setLightbox(previous => previous?.key === context ? { ...previous, media: previous.media.map(update) } : previous);
  }, [context, data.likes.media, isMember, stakeId, uid]);

  function handleUpload(gallery: Gallery, files: File[]) {
    if (!files.length || !canUpload || !navigator.onLine || !isGalleryUploadOpen(null, gallery) || contextRef.current !== context || !gallery.activityId) return;
    pickMedia(files, gallery, gallery.mediaCount);
    navigate(activityMediaPath(gallery.activityId));
  }

  async function handleReport(reason: GalleryReportReason) {
    if (!reporting || !isMember || !navigator.onLine) throw new Error("Connettiti per inviare la segnalazione.");
    if (reportPending.current) return;
    const run = ++reportRun.current;
    reportPending.current = true;
    try {
      await galleriesService.reportMedia(stakeId, reporting.galleryId, reporting.id, reason);
      if (contextRef.current !== context || reportRun.current !== run) return;
      setLightbox(null);
      setReporting(null);
      setNotice("Segnalazione inviata. Un responsabile controllerà il contenuto.");
      await refresh(true);
    } finally {
      if (reportRun.current === run) reportPending.current = false;
    }
  }

  const filtered = data.posts.filter(post => filter === "all" || (filter === "media" ? post.type === "gallery" : post.type !== "gallery"));
  const lightboxMediaIsLiked = useCallback((id: string) => data.likes.media[`${lightbox?.galleryId ?? ""}/${id}`] === true, [data.likes.media, lightbox?.galleryId]);

  if (!isMember && access !== "loading") return <MemberLockedNote access={access} kind="foto" />;
  return <div className="social-feed">
    <div className="social-filters" role="group" aria-label="Filtra i contenuti">
      {([["all", "Tutto"], ["media", "Foto e video"], ["updates", "Aggiornamenti"]] as const).map(([value, label]) =>
        <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
    </div>
    {!online ? <p className="social-notice" role="status">Sei offline. Riconnettiti per inviare commenti e Mi piace.</p> : null}
    {notice ? <p className="social-notice" role="status">{notice}</p> : null}
    {data.error ? <div className="notice notice--warning" role="alert"><p>{data.error}</p><button className="button button--soft" type="button" onClick={() => void refresh()}>Riprova</button></div> : null}
    {data.loading ? <div className="social-skeleton" role="status" aria-label="Carico le novità"><span /><span /><span /></div> : null}
    {!data.loading && !data.error && filtered.length === 0 ? <div className="social-empty">
      <img src={giovani} alt="" />
      <h3>{data.posts.length ? "Nessun contenuto in questo filtro" : "Qui arriveranno le novità delle attività"}</h3>
      {data.posts.length ? <button className="button button--soft" type="button" onClick={() => setFilter("all")}>Tutto</button> : <p>Foto, ricordi e aggiornamenti del tuo palo.</p>}
    </div> : null}
    <div className="feed-stack">
      {filter !== "media" && data.checklist.slice(0, 2).map(({ event }) => <CampChecklistFeedCard key={`camp-${event.id}`} event={event} />)}
      {filtered.map(post => {
        const liked = data.likes.posts[post.id] === true;
        const common = { post, liked, canLike: isMember, onToggleLike: () => handleTogglePostLike(post) };
        if (post.type === "announcement") return <AnnouncementCard key={post.id} {...common} />;
        if (post.type === "activity_reminder") return <ActivityReminderCard key={post.id} {...common} activity={post.activityId ? data.activities[post.activityId] : undefined} />;
        if (!post.galleryId) return null;
        const media = post.mediaIds.map(id => (data.media[post.galleryId!] ?? []).find(item => item.id === id)).filter((item): item is GalleryMedia => Boolean(item));
        return <GalleryCard key={`${context}:${post.id}:${post.galleryId}`} {...common} gallery={data.galleries[post.galleryId]} media={media} access={access} canUpload={canUpload}
          onOpenMedia={index => setLightbox({ key: context, galleryId: post.galleryId!, media, index })} isMediaLiked={lightboxMediaIsLiked} onUpload={files => { const gallery = data.galleries[post.galleryId!]; if (gallery) handleUpload(gallery, files); }} />;
      })}
    </div>
    {!data.loading && filtered.length > 0 ? <p className="social-feed-end">Sei arrivato alle ultime novità</p> : null}
    {lightbox?.key === context && isMember ? <MediaLightbox key={context} media={lightbox.media} initialIndex={lightbox.index} isMediaLiked={lightboxMediaIsLiked}
      onClose={() => setLightbox(null)} onToggleMediaLike={handleToggleMediaLike}
      onDismissOverlay={() => { if (!reporting) return false; if (!reportPending.current) setReporting(null); return true; }}
      renderExtraActions={item => item.uploadedBy !== uid ? <button type="button" className="media-lightbox__report" disabled={!online} onClick={() => setReporting(item)}><AppIcon name="flag" /> Segnala</button> : null} /> : null}
    {reporting && isMember && lightbox?.key === context ? <ReportMediaSheet mediaType={reporting.type} onCancel={() => { if (!reportPending.current) setReporting(null); }} onConfirm={handleReport} /> : null}
  </div>;
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
        Apri la tua scheda per vedere le assegnazioni, i comitati, il menu e una checklist delle
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
      <PostHeader post={post} label="Aggiornamento" />
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
      <PostHeader post={post} label="Attività" />
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
            to={getActivityPath(post.activityId, post.stakeId)}
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
  canLike: boolean;
  access: MemberAccess;
  onToggleLike: () => Promise<void>;
  onOpenMedia: (index: number) => void;
  onUpload: (files: File[]) => void;
  canUpload: boolean;
  isMediaLiked: (mediaId: string) => boolean;
}

function GalleryCard({
  post,
  gallery,
  media,
  liked,
  access,
  canLike,
  onToggleLike,
  onOpenMedia,
  onUpload,
  canUpload,
}: GalleryCardProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isMember = access === "member";
  const totalBatches = useMemo(() => {
    if (!gallery) return null;
    if (gallery.mediaCount === 0) return null;
    return Math.max(1, Math.ceil(gallery.mediaCount / Math.max(1, gallery.batchSize || 10)));
  }, [gallery]);

  return (
    <article className="card feed-card feed-card--gallery">
      <PostHeader post={post} label="Foto e video" />
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

      {isMember && post.activityId ? <div className="social-gallery-links">
        {media.length > 0 ? <button type="button" onClick={() => onOpenMedia(0)}>Apri foto e commenti <span aria-hidden="true">↗</span></button> : null}
        <Link to={activityMediaPath(post.activityId)}>Vedi tutte</Link>
        {canUpload && gallery && isGalleryUploadOpen(null, gallery) ?
          <><input type="file" ref={inputRef} accept="image/*,video/*" multiple hidden onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; onUpload(files); }} />
            <button className="social-upload-link" type="button" disabled={!navigator.onLine} onClick={() => inputRef.current?.click()}>Aggiungi foto o video</button></> : null}
      </div> : null}
      {isMember && canLike ? (
        <footer className="feed-card__footer">
          <LikeButton liked={liked} count={post.likeCount} onToggle={onToggleLike} />
        </footer>
      ) : null}
    </article>
  );
}

function PostHeader({ post, label }: { post: FeedPost; label: string }) {
  return <header className="social-post-head">
    <span className="social-author-mark" aria-hidden="true"><img src="/brand-logo.png" alt="" /></span>
    <div><strong>Staff del palo</strong><span>{label} · <time>{formatPostDate(post)}</time>{post.pinned ? " · In evidenza" : ""}</span></div>
  </header>;
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
