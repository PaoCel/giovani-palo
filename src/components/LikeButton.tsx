import { useState } from "react";

interface LikeButtonProps {
  liked: boolean;
  count: number;
  busy?: boolean;
  size?: "small" | "medium";
  onToggle: () => Promise<void> | void;
  ariaLabel?: string;
}

export function LikeButton({
  liked,
  count,
  busy,
  size = "medium",
  onToggle,
  ariaLabel,
}: LikeButtonProps) {
  const [animating, setAnimating] = useState(false);

  async function handleClick() {
    setAnimating(true);
    try {
      await onToggle();
    } finally {
      setTimeout(() => setAnimating(false), 320);
    }
  }

  return (
    <button
      type="button"
      className={[
        "like-button",
        `like-button--${size}`,
        liked ? "like-button--liked" : "",
        animating ? "like-button--animating" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={handleClick}
      disabled={busy}
      aria-pressed={liked}
      aria-label={ariaLabel ?? (liked ? "Togli mi piace" : "Metti mi piace")}
    >
      <span className="like-button__heart" aria-hidden="true">
        {liked ? "♥" : "♡"}
      </span>
      <span className="like-button__count">{count}</span>
    </button>
  );
}
