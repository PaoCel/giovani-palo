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
