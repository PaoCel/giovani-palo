// Navigazione della testata comune (task gugd-restyling, fase 4): voce attiva
// delle barre e iniziali dell'avatar.
//
// Questo file lo carica anche Node (tests/): niente alias "@/" sui valori.

export interface NavMatchLink {
  to: string;
  /** Solo il percorso esatto (la home dell'area), non le pagine sotto. */
  end?: boolean;
  /**
   * Altri percorsi che accendono la voce: «Altro» nella barra in basso
   * dell'admin resta acceso su Gallerie e Feed, che stanno dentro Altro.
   */
  alsoActive?: string[];
}

function trimSlash(path: string) {
  return path.length > 1 ? path.replace(/\/+$/u, "") : path;
}

function matchesPath(pathname: string, to: string, end: boolean) {
  const current = trimSlash(pathname);
  const target = trimSlash(to);
  if (current === target) return true;
  if (end) return false;
  // "/" senza `end` copre tutto, come NavLink: il suo prefisso è "/" e non "//".
  return target === "/" ? current.startsWith("/") : current.startsWith(`${target}/`);
}

export function isNavLinkActive(link: NavMatchLink, pathname: string) {
  if (matchesPath(pathname, link.to, Boolean(link.end))) return true;
  return (link.alsoActive ?? []).some((path) => matchesPath(pathname, path, false));
}

/**
 * Iniziali per l'avatar: prima lettera del primo e dell'ultimo nome
 * ("Maria Antonietta Rossi" → "MR"); una sola parola → una lettera; niente
 * nome → stringa vuota (l'avatar mostra l'icona).
 */
export function getInitials(name: string | null | undefined) {
  const words = (name ?? "")
    .split(/[\s@._-]+/u)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (words.length === 0) return "";
  const first = Array.from(words[0])[0] ?? "";
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] ?? "" : "";
  return `${first}${last}`.toLocaleUpperCase("it-IT");
}
