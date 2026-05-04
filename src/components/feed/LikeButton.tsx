import { useState } from "react";

interface LikeButtonProps {
  liked: boolean;
  count: number;
  onToggle: () => Promise<void>;
  ariaLabel?: string;
  small?: boolean;
}

export function LikeButton({ liked, count, onToggle, ariaLabel, small }: LikeButtonProps) {
  const [busy, setBusy] = useState(false);
  const [optimisticLiked, setOptimisticLiked] = useState<boolean | null>(null);
  const [optimisticDelta, setOptimisticDelta] = useState(0);

  const effectiveLiked = optimisticLiked ?? liked;
  const effectiveCount = Math.max(0, count + optimisticDelta);

  async function handleClick() {
    if (busy) return;
    const wasLiked = effectiveLiked;
    setBusy(true);
    setOptimisticLiked(!wasLiked);
    setOptimisticDelta((delta) => delta + (wasLiked ? -1 : 1));
    try {
      await onToggle();
      setOptimisticLiked(null);
      setOptimisticDelta(0);
    } catch (error) {
      setOptimisticLiked(null);
      setOptimisticDelta(0);
      throw error;
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={`like-button${effectiveLiked ? " is-liked" : ""}${small ? " is-small" : ""}`}
      onClick={handleClick}
      aria-pressed={effectiveLiked}
      aria-label={ariaLabel ?? (effectiveLiked ? "Rimuovi like" : "Metti like")}
      disabled={busy}
    >
      <svg
        viewBox="0 0 24 24"
        width={small ? 16 : 20}
        height={small ? 16 : 20}
        aria-hidden="true"
        focusable="false"
      >
        <path
          fill={effectiveLiked ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          d="M12 20.5s-7.4-4.6-9.4-9.6C1.5 8 3 5 6 5c1.8 0 3.3 1 4 2.5C10.7 6 12.2 5 14 5c3 0 4.5 3 3.4 5.9-2 5-9.4 9.6-9.4 9.6z"
        />
      </svg>
      {effectiveCount > 0 ? <span className="like-button__count">{effectiveCount}</span> : null}
    </button>
  );
}
