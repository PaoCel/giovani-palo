---
id: gugd-flusso-genitore
title: "Flusso genitore chiaro: chi iscrivi, figlio in contesto, un verbo per accedere"
status: in-progress
impact: 2
urgency: 2
effort: L
delivery: deploy
surface: [web, rules]
source: paolo
opened: 2026-10-18
started_at: 2026-10-18
touched: 2026-10-18
due:
blocked_by: []
branch:
worktree:
session:
stopped_at: "fase 1 (parole e pagina Accedi) su main, non deployata"
next: "deploy hosting della fase 1 con ok di Paolo (bump del service worker), poi fase 2: «Annulla l'iscrizione» in Famiglia"
verified: "fase 1: 327 test unitari e build sul Mac mini; Chrome headless a 320/390/430 contro emulatori demo (schede, Sei già dentro, redirect dopo l'accesso, Esci e cambia account, Famiglia); review di un altro agente; non in produzione, tastiera iOS non provata"
links: []
done_at:
---

## Contesto

Fase 1 del piano autonomia (2026-10-18). Spec stati/uscite/annullamenti + mockup 390px prima del codice. Niente codice applicativo finché Paolo non approva i mockup.

## Fatto quando

- In produzione le sei fasi di `docs/FLUSSO_GENITORE.md` (o quelle approvate):
  scelta "per chi" come primo passo, account e figlio creati dentro
  l'iscrizione, guardia adulto, glossario applicato, "Annulla l'iscrizione"
  per il genitore, schermata "Iscrizione inviata".
- Nessun `window.confirm` nel flusso di accesso.
- Rules provate nell'emulatore con `parent`, `participant` adulto e
  `unit_leader`; collaudo nel browser di ogni riga di "Utente che sbaglia".
- Fuori: codici di collegamento e "Non ricordo l'account" (S3).

## Da fare

1. ~~Paolo approva mockup e scelte G1-G6~~ (2026-10-18, come consigliate; in più
   illustrazioni proprie e finitura, sezioni "Illustrazioni" e "Finitura").
2. Fasi 1-6 della spec, una alla volta, ognuna rilasciabile.
   - ~~Fase 1, parole e pagina Accedi~~ (2026-10-18, su `main`, **non
     deployata**). Testi toccati in `src/copy/<schermata>.ts` (`parole.ts` per
     il glossario, `accedi.ts`, `iscrizione.ts`, `famiglia.ts`); guardia in
     `tests/glossary.test.mjs`. `npm test` ora esiste
     (`node --test tests/*.test.mjs`, 327 test).
   - Trovato: nell'area pubblica l'intestazione non ha "Accedi"
     (`PublicLayout`, `showDefaultAuthAction={false}`), quindi il `redirect`
     aggiunto a `ShellLayout` vale solo nelle aree protette. Da una pagina
     attività si accede dal pulsante della pagina, che il `redirect` lo aveva
     già. Mostrarlo anche nell'area pubblica è una scelta di Paolo.
   - Dati in produzione: `stakes/roma-est.guestRegistrationHint` contiene
     ancora "Se non fai il login, i tuoi dati verranno salvati solo per questa
     attività." (letto il 2026-10-18) e vince sul default del codice. Da
     cambiare da Impostazioni o con una scrittura confermata da Paolo.
   - Fase 2: «Annulla l'iscrizione» del genitore in Famiglia e «Riprendi da
     «Autorizza ora»».
3. Illustrazioni: WebP 2× da `.claude/mockups/flusso-genitore/img/` nel repo
   quando si costruisce la prima schermata che le usa.

## Verificato

2026-10-18, fase 1: build e 327 test unitari verdi sul Mac mini
(`npm ci && npm test && npm run build`), di cui 27 nuovi scritti da un altro
agente (`tests/glossary.test.mjs`, `tests/loginPath.test.mjs`). Collaudo con
Chrome headless (Playwright) a 320×640, 390×844 e 430×844 contro gli emulatori
`demo-room-planner` sul mini, con utenti sintetici: nessuno scroll orizzontale,
campi a 16 px, nessun target sotto i 44 px, titoli Fraunces 27-32 px; da
`/login?redirect=/activities` l'accesso porta a `/activities`; `/login` da già
entrato mostra "Sei già dentro" e resta lì; "Vai alla tua pagina" porta a
`/family` per un genitore; "Esci e cambia account" torna sulla scheda
"Accedi"; `?scheda=crea` apre "Crea un account"; Famiglia mostra i testi
nuovi; un errore dopo il tocco sulla CTA resta visibile sopra il piede
fisso. Confronto affiancato con il mockup 03-accesso. Review del diff da un
altro agente (PASS WITH CONCERNS): corretti errore sotto la CTA, avviso che si
allungava e le forme rimaste ("Richiedi login" nelle schermate admin, "un
secondo figlio", "minori" in home, default `guestRegistrationHint`). Non
provati: tastiera aperta su Safari iOS e Android veri, produzione.

2026-10-18: spec scritta leggendo il codice (mappa del flusso di oggi),
rivista da Codex (`gpt-6-astra`, PASS WITH CONCERNS, correzioni recepite;
verificati nel codice: token "Autorizza ora" 60 minuti che invalida il link
della mail, nessun annullamento per il genitore). Mockup renderizzati a 390 px
con i token di `base.css`, approvati da Paolo; set di 6 illustrazioni generato
con Codex (versione campeggio scartata: le attività sono di ogni tipo). "Nessuna rule nuova" dedotto dal codice, non
provato nell'emulatore.
