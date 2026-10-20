// Le frasi vietate dal glossario (docs/FLUSSO_GENITORE.md, "Parole"), una sola
// volta per tutti i test che le usano: la guardia su `src/` (glossary.test.mjs)
// e il controllo sui testi delle schermate admin (adminCopy.test.mjs).
//
// Ogni forma ha l'etichetta che compare nel rapporto e un'espressione che la
// riconosce anche spezzata su più righe (JSX) o con l'apostrofo scritto come
// entità HTML o preceduto da una barra (stringa con apice escapato). Le
// espressioni hanno il flag `g`: si usano con `matchAll`, mai con `test`.
//
// Stanno in `tests/support/`, che nessuna guardia legge: la forma vietata è
// scritta per intero.

const APOSTROPHE = "\\\\?(?:'|&apos;|&#39;|’)";

export const FORBIDDEN_FORMS = [
  ["Login o crea", /Login\s+o\s+crea/giu],
  ["Fai login", /Fai\s+login/giu],
  ["Vai al login", /Vai\s+al\s+login/giu],
  ["Login / Account", /Login\s*\/\s*Account/giu],
  ["Entra nell'app", new RegExp(`Entra\\s+nell${APOSTROPHE}app`, "giu")],
  ["Registrati con Google", /Registrati\s+con\s+Google/giu],
  ["Accedi con Google", /Accedi\s+con\s+Google/giu],
  ["figlio/a", /figlio\/a\b/giu],
  ["figli/e", /figli\/e\b/giu],
  ["ragazzo/a", /ragazzo\/a\b/giu],
  ["un secondo figlio", /\bun\s+secondo\s+figlio\b(?!\s+o\s+figlia)/giu],
  // Una frase sola per il concetto: "Annulla l'iscrizione", sempre con l'articolo.
  ["Annulla iscrizione", /\bAnnulla\s+iscrizione\b/giu],
  ["Crea account", /\bCrea\s+account\b/gu],
];
