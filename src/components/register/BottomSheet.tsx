import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { AppIcon } from "@/components/AppIcon";

import "@/styles/registerFlow.css";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Trascinamento oltre questa soglia (o abbastanza veloce) chiude il foglio.
const DRAG_CLOSE_PX = 96;
const DRAG_CLOSE_VELOCITY = 0.6;

interface BottomSheetProps {
  title: string;
  lead?: string;
  // Etichetta del pulsante in alto: dice cosa succede chiudendo.
  closeLabel: string;
  // Chiudere (X, "Annulla", sfondo, Esc, trascinamento) è sempre la stessa cosa.
  onClose: () => void;
  // Durante il salvataggio il foglio non si chiude.
  busy?: boolean;
  children: ReactNode;
  footer: ReactNode;
}

// Foglio dal basso (docs/FLUSSO_GENITORE.md, "Finitura"): al massimo 90 dvh,
// scroll interno che non passa alla pagina, pagina sotto bloccata e inerte,
// chiusura col trascinamento uguale a "Annulla".
export function BottomSheet({
  title,
  lead,
  closeLabel,
  onClose,
  busy = false,
  children,
  footer,
}: BottomSheetProps) {
  const ids = useId();
  const titleId = `${ids}-title`;
  const layerRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const busyRef = useRef(busy);
  const dragRef = useRef<{ pointerId: number; startY: number; startTime: number } | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  // La pagina sotto non si raggiunge con la tastiera né con uno screen reader.
  useLayoutEffect(() => {
    const layer = layerRef.current;
    const changed: HTMLElement[] = [];
    for (const element of Array.from(document.body.children)) {
      if (element === layer || !(element instanceof HTMLElement) || element.inert) continue;
      element.inert = true;
      changed.push(element);
    }
    return () => {
      for (const element of changed) element.inert = false;
    };
  }, []);

  // Pagina ferma sotto il foglio; focus sul titolo all'apertura e ritorno al
  // pulsante di partenza alla chiusura.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const { overflow } = document.body.style;
    const rootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    titleRef.current?.focus({ preventScroll: true });

    return () => {
      document.body.style.overflow = overflow;
      document.documentElement.style.overflow = rootOverflow;
      if (opener?.isConnected && !opener.hasAttribute("disabled")) {
        opener.focus({ preventScroll: true });
      }
    };
  }, []);

  function requestClose() {
    if (!busyRef.current) {
      onClose();
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      requestClose();
      return;
    }

    if (event.key !== "Tab" || !sheetRef.current) return;
    const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || active === titleRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // Trascinamento dalla maniglia e dall'intestazione, mai dai campi.
  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (busyRef.current || (event.pointerType === "mouse" && event.button !== 0)) return;
    if ((event.target as HTMLElement).closest("button, a, input, select, textarea")) return;
    dragRef.current = { pointerId: event.pointerId, startY: event.clientY, startTime: Date.now() };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setDragOffset(Math.max(0, event.clientY - drag.startY));
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    const distance = Math.max(0, event.clientY - drag.startY);
    const velocity = distance / Math.max(1, Date.now() - drag.startTime);
    setDragOffset(0);

    if (event.type === "pointerup" && (distance > DRAG_CLOSE_PX || velocity > DRAG_CLOSE_VELOCITY)) {
      requestClose();
    }
  }

  const layer = (
    <div className="bottom-sheet-layer" onKeyDown={handleKeyDown} ref={layerRef}>
      <div aria-hidden="true" className="bottom-sheet-scrim" onClick={requestClose} />
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className={dragOffset > 0 ? "bottom-sheet bottom-sheet--dragging" : "bottom-sheet"}
        ref={sheetRef}
        role="dialog"
        style={dragOffset > 0 ? { transform: `translateY(${dragOffset}px)` } : undefined}
      >
        <div
          className="bottom-sheet__head"
          onPointerCancel={handlePointerEnd}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
        >
          <span aria-hidden="true" className="bottom-sheet__grab" />
          <div className="bottom-sheet__top">
            <button
              className="bottom-sheet__close"
              disabled={busy}
              onClick={requestClose}
              type="button"
            >
              <AppIcon name="x" />
              <span>{closeLabel}</span>
            </button>
          </div>
          <h2 className="bottom-sheet__title" id={titleId} ref={titleRef} tabIndex={-1}>
            {title}
          </h2>
          {lead ? <p className="bottom-sheet__lead">{lead}</p> : null}
        </div>
        <div className="bottom-sheet__body">{children}</div>
        <div className="bottom-sheet__foot">{footer}</div>
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return layer;
  }

  return createPortal(layer, document.body);
}
