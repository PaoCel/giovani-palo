import { useEffect, useRef, useState } from "react";

interface LikeButtonProps {
  liked: boolean;
  count: number;
  onToggle: () => Promise<void>;
  ariaLabel?: string;
  small?: boolean;
}

export function LikeButton({ liked, count, onToggle, ariaLabel, small }: LikeButtonProps) {
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  async function handleClick() {
    if (busyRef.current || !navigator.onLine) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try { await onToggle(); }
    catch { setError("Mi piace non aggiornato. Riprova."); }
    finally { busyRef.current = false; setBusy(false); }
  }

  return <span className="social-like-control">
    <button type="button" className={`like-button${liked ? " is-liked" : ""}${small ? " is-small" : ""}`}
      onClick={() => void handleClick()} aria-pressed={liked}
      aria-label={ariaLabel ?? (liked ? "Rimuovi like" : "Metti like")} disabled={busy || !online} aria-busy={busy}>
      <svg viewBox="0 0 24 24" width={small ? 16 : 20} height={small ? 16 : 20} aria-hidden="true" focusable="false">
        <path fill={liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round"
          d="M20.5 4.8a5.6 5.6 0 0 0-8.5 1 5.6 5.6 0 0 0-8.5-1C-2 10 6 16 12 21c6-5 14-11 8.5-16.2Z" />
      </svg>
      {!small ? <span>Mi piace</span> : null}
      {count > 0 ? <span className="like-button__count">{count}</span> : null}
    </button>
    {error ? <span className="form-error" role="alert">{error}</span> : null}
  </span>;
}
