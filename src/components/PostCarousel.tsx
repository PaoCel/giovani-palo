import { useEffect, useRef, useState } from "react";

import type { GalleryMedia } from "@/services/firestore/galleriesService";

interface PostCarouselProps {
  media: GalleryMedia[];
  onSelect?: (media: GalleryMedia, index: number) => void;
}

export function PostCarousel({ media, onSelect }: PostCarouselProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    function onScroll() {
      if (!node) return;
      const { scrollLeft, clientWidth } = node;
      const index = Math.round(scrollLeft / clientWidth);
      setActiveIndex(index);
    }
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, []);

  function scrollTo(index: number) {
    const node = containerRef.current;
    if (!node) return;
    node.scrollTo({ left: index * node.clientWidth, behavior: "smooth" });
  }

  if (media.length === 0) return null;

  return (
    <div className="post-carousel">
      <div className="post-carousel__track" ref={containerRef}>
        {media.map((item, index) => {
          const src =
            item.optimizedUrl ?? item.thumbnailUrl ?? item.posterUrl ?? item.storageUrl ?? "";
          return (
            <button
              type="button"
              key={item.id}
              className="post-carousel__slide"
              onClick={() => onSelect?.(item, index)}
            >
              {item.type === "video" ? (
                <>
                  {src ? <img src={src} alt={item.filename} loading="lazy" /> : null}
                  <span className="post-carousel__video-badge">▶</span>
                </>
              ) : src ? (
                <img src={src} alt={item.filename} loading="lazy" />
              ) : null}
            </button>
          );
        })}
      </div>

      {media.length > 1 ? (
        <>
          <button
            type="button"
            className="post-carousel__nav post-carousel__nav--prev"
            aria-label="Foto precedente"
            disabled={activeIndex === 0}
            onClick={() => scrollTo(Math.max(0, activeIndex - 1))}
          >
            ‹
          </button>
          <button
            type="button"
            className="post-carousel__nav post-carousel__nav--next"
            aria-label="Foto successiva"
            disabled={activeIndex === media.length - 1}
            onClick={() => scrollTo(Math.min(media.length - 1, activeIndex + 1))}
          >
            ›
          </button>

          <div className="post-carousel__dots" aria-hidden="true">
            {media.map((_, index) => (
              <span
                key={index}
                className={
                  index === activeIndex
                    ? "post-carousel__dot post-carousel__dot--active"
                    : "post-carousel__dot"
                }
              />
            ))}
          </div>

          <span className="post-carousel__counter">
            {activeIndex + 1} / {media.length}
          </span>
        </>
      ) : null}
    </div>
  );
}
