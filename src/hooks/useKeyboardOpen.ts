import { useEffect, useState } from "react";

// Tastiera aperta (iOS e Android riducono il visual viewport, non il layout):
// il piede con la CTA torna nel flusso, così non copre il campo attivo e non
// resta a metà schermo sopra la tastiera.
export function useKeyboardOpen() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const viewport = typeof window === "undefined" ? null : window.visualViewport;

    if (!viewport) {
      return;
    }

    const update = () =>
      setOpen(viewport.scale <= 1.01 && window.innerHeight - viewport.height > 150);

    update();
    viewport.addEventListener("resize", update);
    return () => viewport.removeEventListener("resize", update);
  }, []);

  return open;
}
