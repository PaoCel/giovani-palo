import { useLayoutEffect, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";

import { createLayerStack } from "@/utils/modalLayers";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Una pila sola per tutta l'app: AppModal, BottomSheet, GuestSheet e i fogli
// della galleria si coordinano anche quando si chiudono fuori ordine.
const layers =
  typeof document === "undefined"
    ? null
    : createLayerStack<HTMLElement>({
        children: () =>
          Array.from(document.body.children).filter(
            (element): element is HTMLElement => element instanceof HTMLElement,
          ),
      });
let observer: MutationObserver | null = null;

// Foglio o modale aperto: la pagina sotto (e ogni strato più basso) non si
// raggiunge con la tastiera né con uno screen reader. Si toglie in fase di
// layout, prima che il focus torni al pulsante di partenza. Un portale che
// nasce dopo (dock dei caricamenti, avvisi) entra nel calcolo da solo.
export function useInertBackground(layerRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layers || !layer) return undefined;
    const close = layers.open(layer);
    if (!observer && typeof MutationObserver !== "undefined") {
      observer = new MutationObserver(() => layers.sync());
      observer.observe(document.body, { childList: true });
    }
    return () => {
      close();
      if (layers.size() === 0) {
        observer?.disconnect();
        observer = null;
      }
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
