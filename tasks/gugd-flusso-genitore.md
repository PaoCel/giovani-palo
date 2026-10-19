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
touched: 2026-10-19
due:
blocked_by: []
branch:
worktree:
session:
stopped_at: "fasi 1 e 2 in produzione dal 2026-10-19 (rules, 6 functions di parentAuthorization, hosting con service worker v22)"
next: "fase 3: B e C dentro l'iscrizione, account nuovo parent con per=figlio, via il window.confirm, «Chi sei?» fuori dall'attività"
verified: "fase 2 in produzione: ruleset live uguale a git (03c3c01), 6 functions aggiornate e GetContext con canSignInApp live, bundle live index-DdMIgQ6d.js con sw v22, /login, /activities e /parent-confirm provati da non entrato senza errori; prima unit 356, emulatore rules 39 + 3 todo, callable 25, py 5/5, browser contro emulatori a 320/390/430, review di un altro agente"
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
   - ~~Fase 1, parole e pagina Accedi~~ (in produzione dal 2026-10-19,
     hosting con service worker v21). Testi toccati in `src/copy/<schermata>.ts` (`parole.ts` per
     il glossario, `accedi.ts`, `iscrizione.ts`, `famiglia.ts`); guardia in
     `tests/glossary.test.mjs`. `npm test` ora esiste
     (`node --test tests/*.test.mjs`, 327 test).
   - "Accedi" anche nell'intestazione pubblica (Paolo, 2026-10-19), per chi
     non è entrato, ospiti compresi, con ritorno alla pagina corrente; non su
     `/login`. Sul telefono, da non entrati, il nome del sito è quello corto
     ("Attività GU GD") su tutte le pagine pubbliche, `/login` compresa.
   - Dati in produzione: `stakes/roma-est.guestRegistrationHint` da "Se non
     fai il login…" a "Se non crei un account, i tuoi dati restano salvati
     solo per questa attività." (scritto il 2026-10-19 con l'ok di Paolo,
     letto prima e dopo).
   - ~~Fase 2: «Annulla l'iscrizione» del genitore in Famiglia e «Riprendi da
     «Autorizza ora»»~~ (in produzione dal 2026-10-19: rules, functions per nome,
     hosting con service worker v22). Trovati e
     corretti: annullamento del figlio oltre il limite di 1000 espressioni
     (`validOwnerCancellation`), link valido che rimetteva in `confirmed` o
     `rejected_by_parent` un'iscrizione annullata (anche da `/me` e admin),
     reinvio mail su iscrizioni annullate, errori Firebase in inglese e attesa
     infinita offline anche in `/me`.
   - Aperti, c'erano già prima: ~~risalvataggio di un'iscrizione figlio molto
     pesante oltre il budget delle rules~~ (corretto su `main` il 2026-10-19:
     `validRegistrationUpdate` da oltre 1000 a 650-780 espressioni, permessi
     invariati, i 3 `todo` di `parentCancelRulesEmulator.test.mjs` ora verdi;
     rules in produzione dal 2026-10-19 con l'ok di Paolo, ruleset live uguale
     a `8d08f8c`); ~~il reinvio
     dell'admin e il cambio email lasciano due link validi e mandano due mail~~
     (corretto su `main` il 2026-10-19: ogni emissione è una transazione che
     invalida tutti i link pendenti, anche alla firma; il reinvio rifiuta
     un'autorizzazione già decisa o senza dati del genitore; test in
     `parentAuthorizationCancelledEmulator.test.mjs` e
     `parentConsentEmulator.test.mjs`; da pubblicare con l'ok di Paolo:
     `onRegistrationPendingParentAuth`, `parentAuthorizationResend`,
     `…IssueOwnToken`, `…Confirm`, `…Reject`). Tutti e due in sessioni
     separate dal 2026-10-19.
3. Illustrazioni: WebP 2× da `.claude/mockups/flusso-genitore/img/` nel repo
   quando si costruisce la prima schermata che le usa.

## Verificato

2026-10-19, rilascio fase 2 con l'ok di Paolo, da una copia isolata di `main`
(le sessioni parallele lavorano nella stessa cartella): ruleset live scaricato
prima (uguale a git prima della fase 2) e dopo (uguale a `03c3c01`); 6
functions per nome (`onRegistrationPendingParentAuth`,
`parentAuthorizationGetContext`, `…Confirm`, `…Reject`, `…Resend`,
`…IssueOwnToken`), `GetContext` risponde con `canSignInApp`; hosting da
`6cd6ec8` (service worker v22), bundle live `index-DdMIgQ6d.js`; `/login`,
`/activities` e `/parent-confirm/…` provati da non entrato, nessun errore in
console né nei log recenti delle functions. Non provato in produzione con un
account vero: l'annullamento di un genitore (provato nell'emulatore e nel
browser contro gli emulatori).

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
provati: tastiera aperta su Safari iOS e Android veri.

2026-10-19, rilascio: deploy hosting da `main` pulito (`004542a`, service
worker v20) con l'ok di Paolo. Su gugditalia.it e giovani-palo.web.app il
bundle servito è quello della build (`index-C5mcL9mH.js`) e `sw.js` è v20.
Da non entrato, a 390 px: "Accedi" in alto su `/activities` porta a
`/login?redirect=%2Factivities`, la pagina Accedi ha le due schede e nessun
errore in console. Secondo deploy lo stesso giorno (`7f2e697`, service worker
v21): nome corto anche su `/login`; bundle live `index-WlbHwA4C.js`, provato
da non entrato a 320, 390 e 430 px su `/login` e `/activities`, nessun errore.

2026-10-18: spec scritta leggendo il codice (mappa del flusso di oggi),
rivista da Codex (`gpt-6-astra`, PASS WITH CONCERNS, correzioni recepite;
verificati nel codice: token "Autorizza ora" 60 minuti che invalida il link
della mail, nessun annullamento per il genitore). Mockup renderizzati a 390 px
con i token di `base.css`, approvati da Paolo; set di 6 illustrazioni generato
con Codex (versione campeggio scartata: le attività sono di ogni tipo). "Nessuna rule nuova" dedotto dal codice, non
provato nell'emulatore.
