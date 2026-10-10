import type { RefObject } from "react";

import type { RecordNightCategory } from "@/types";
import { getRecordNightCategoryLabel } from "@/utils/recordNight";

import { getInitials } from "./helpers";

// Pezzi piccoli condivisi dalle parti della scheda admin "Record".

export function CategoryPill({ category }: { category: RecordNightCategory }) {
  return (
    <span className="rna-pill" data-category={category}>
      {getRecordNightCategoryLabel(category)}
    </span>
  );
}

export function Avatar({ name }: { name: string }) {
  return (
    <span aria-hidden="true" className="rna-avatar">
      {getInitials(name)}
    </span>
  );
}

// Rimette il focus sul tasto che ha aperto un pannello quando il pannello si
// chiude senza aver cambiato la pagina (Annulla, Esc).
export function useFocusReturn(ref: RefObject<HTMLElement | null>) {
  return () => {
    window.requestAnimationFrame(() => ref.current?.focus());
  };
}

const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

// Quando un'azione riuscita fa sparire l'elemento su cui si stava lavorando (una
// carta che esce dalla coda, una riga che cambia sezione) il focus finirebbe sul
// body e chi usa la tastiera o un lettore di schermo ripartirebbe dall'inizio della
// pagina. Da chiamare PRIMA dell'azione con l'elemento che sparirà; la funzione
// restituita si chiama a azione riuscita: se l'elemento non c'è più e il focus è
// finito sul body, lo porta sul primo controllo dell'elemento successivo (o del
// precedente), altrimenti sul titolo di riserva (`fallbackId`, con tabIndex -1).
// Se il focus è già altrove (l'utente è andato avanti) non lo tocca.
export function rememberFocusNeighbour(node: Element | null | undefined, fallbackId?: string) {
  const siblings = [node?.nextElementSibling ?? null, node?.previousElementSibling ?? null];
  return () => {
    let frames = 0;
    const settle = () => {
      frames += 1;
      // L'elemento sparisce al render dopo la rilettura: si aspetta qualche frame.
      if (node && node.isConnected) {
        if (frames < 30) window.requestAnimationFrame(settle);
        return;
      }
      const active = document.activeElement;
      if (active && active !== document.body && active !== document.documentElement) return;
      for (const sibling of siblings) {
        if (!sibling || !sibling.isConnected) continue;
        const target = sibling.matches(FOCUSABLE)
          ? (sibling as HTMLElement)
          : sibling.querySelector<HTMLElement>(FOCUSABLE);
        if (target) {
          target.focus();
          return;
        }
      }
      if (fallbackId) document.getElementById(fallbackId)?.focus();
    };
    window.requestAnimationFrame(settle);
  };
}
