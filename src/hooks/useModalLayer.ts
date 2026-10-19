import { useLayoutEffect, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Foglio o modale aperto: la pagina sotto non si raggiunge con la tastiera né
// con uno screen reader (`inert` sugli altri figli di <body>), come in
// register/BottomSheet. Si toglie in fase di layout, prima che il focus torni
// al pulsante di partenza; torna attivo solo ciò che questo strato ha reso
// inerte, così due strati aperti uno sull'altro si chiudono in ordine.
export function useInertBackground(layerRef: RefObject<HTMLElement | null>) {
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
  }, [layerRef]);
}

// Tab e Maiusc+Tab girano fra i controlli dello strato, senza uscire verso il
// browser.
export function keepTabInside(event: ReactKeyboardEvent<HTMLElement>, container: HTMLElement | null) {
  if (event.key !== "Tab" || !container) return;
  const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === container)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
