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
stopped_at: "fasi 1-4 in produzione dal 2026-10-19; ultimo deploy: reiscrizione di un'annullata con link nuovo (function onRegistrationPendingParentAuth + hosting da 18982f7, service worker v26)"
next: "fase 5: guardia G e tabella «Account già esistente»"
verified: "fase 4 in produzione (servito sw v24 e bundle index-BUqffvZx.js uguale alla build su gugditalia.it e web.app, home senza errori; flusso loggato in prod non provato): sul mini 629 test unitari (118 nuovi di un altro agente), tsc e build verdi; rules nell'emulatore 46 nuovi + 105 di parentCancel verdi senza rule nuove (altro agente); collaudo Playwright contro emulatori con functions 200/200 a 320/390/430; review di un altro agente BLOCKED → PASS dopo le correzioni. Non provati: tastiera vera su iOS/Android, produzione"
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
   - ~~Fase 4: «Chi iscrivi?» con foglio «Aggiungi» e modulo aperto senza
     figli, bozze per figlio, passo genitore dai dati dell'account, «Iscrizione
     inviata» con «Autorizza ora»~~ (in produzione dal 2026-10-19: solo
     hosting, service worker v24). Dettaglio e cose trovate nella spec,
     sezione "Fasi".
   - ~~Reiscrizione di un'annullata senza link valido~~ (corretto su `main` il
     2026-10-19, opzione scelta da Paolo: il passaggio annullata → in attesa
     manda sempre link e mail nuovi, anche dopo un rifiuto; banner
     `nuovo_link`; 10 annullate su 22 in produzione sarebbero rimaste senza
     link). Test `parentAuthorizationRestartEmulator.test.mjs` e
     `tests/parentStepNotice.test.mjs`, di altri agenti. **In produzione dal
     2026-10-19** con l'ok di Paolo, da una copia isolata di `18982f7`:
     `onRegistrationPendingParentAuth` (sorgente scaricato uguale al commit),
     poi hosting (service worker v26, bundle `index-BIs2B9SO.js` con sha
     uguale alla build su gugditalia.it e web.app, home senza errori). Non
     provata in produzione una reiscrizione vera.
   - ~~Fase 3: «Chi partecipa?» e «Il tuo account» dentro l'iscrizione,
     account nuovo da genitore con `per=figlio`, «Chi sei?» in Accedi, via i
     dialoghi del browser~~ (in produzione dal 2026-10-19: solo hosting,
     service worker v23). Dettaglio e scelte provvisorie fino alle fasi 5-6
     nella spec, sezione "Fasi".
3. ~~Illustrazioni: WebP 2× nel repo~~ (`src/assets/flusso-genitore/`: io,
   genitore, giovani, dirigente, genitore-figlia e inviata a 240 px).

## Verificato

2026-10-19, fase 4 in produzione con l'ok di Paolo: solo hosting da una copia
isolata di `4809680` (service worker v24), insieme alla correzione
dell'ospite che collega un account (`1fb665d`, `c6ad1e4`, test `882d04a`).
Servito su gugditalia.it e giovani-palo.web.app: `sw.js` v24, bundle
`index-BUqffvZx.js` con sha256 uguale alla build, home senza errori in
console. Non provato: il flusso da loggati in produzione.

2026-10-19, fase 4 su `main`. Sul mini: `npm test` 629 verdi
(118 nuovi scritti da un altro agente: `childChoice`, passo `inviata`,
`writeTimeout`, glossario dei testi nuovi; uno ha trovato le date d'inizio
impossibili), `tsc` e build verdi (bundle iniziale 387 kB). Nell'emulatore,
da un altro agente, `functions/tests/parentChildFlowRulesEmulator.test.mjs` 46
verdi (figli, "Salva" ripetuto con lo stesso id, `child_` mancante leggibile,
iscrizione pesante e risalvataggio sotto le 1000 espressioni, ascolto dal vivo,
lista di Famiglia, con `parent`, `participant` adulto e `unit_leader`) e
`parentCancelRulesEmulator` 105 verdi: nessuna rule nuova. Collaudo Playwright
sul mini contro emulatori auth, firestore e functions (`.claude/qa-fase4/`),
200/200: genitore nuovo senza figli (C → D → E con il modulo aperto → F con
i dati dell'account → H → "Autorizza ora" apre la firma con il link di 60
minuti → indietro mostra "Riprendi da «Autorizza ora»" → E con "Già
iscritto") a 320, 390 e 430; due figli, una già iscritta e uno sotto gli 11
anni, matita con "Annulla" che non scrive, foglio con X e trascinamento che
non salvano, doppio tocco su "Salva" e "Salva e continua" (un figlio solo),
"Apri"; bozze separate per figlio, uscita e cambio di account che le
cancellano, matita con la bozza aperta; attività solo per Giovani Donne;
iscrizioni chiuse; un figlio solo con invio senza rete, doppio tocco su
"Continua" che non invia, H senza autorizzazione e riapertura con "Già
iscritto"; "Partecipo io" di un ragazzo con l'esito della mail (in invio,
mandata, fallita → "Modifica") e di un adulto. Finitura misurata in ogni
schermata (campi 16 px, target 44, testo ≥ 13 px, titoli 27-32 px, niente
scroll orizzontale, foglio ≤ 90 dvh con pagina ferma e inerte), console pulita,
nessun dialogo del browser. Confronti affiancati con i mockup in
`.claude/qa-fase4/out/confronto-*.png`. Review del diff da un altro agente:
BLOCKED (bozza vecchia dopo la matita, caricamento fallito senza uscita,
"Autorizza ora" e "Cambia account" senza foglio d'uscita, banner del link in
modifica), poi PASS dopo le correzioni. Non provati: tastiera vera su Safari
iOS e Android, produzione.

2026-10-19, rilascio fase 3 con l'ok di Paolo: hosting da una copia isolata di
`d38fe36` (build sul Mac mini, `firebase deploy --only hosting`), service
worker v23. Su gugditalia.it e giovani-palo.web.app il bundle servito è quello
della build (`index-BuVMsq2w.js`) e `sw.js` è v23. Da non entrato: `/register`
del viaggio al tempio (iscrizioni chiuse) mostra la scheda "Iscrizioni chiuse"
con la freccia del percorso e senza quella del sito; `/login?scheda=crea` con
le due schede; console senza errori. Oggi nessuna attività ha le iscrizioni
aperte: «Chi partecipa?» e un account nuovo veri sono provati solo contro gli
emulatori.

2026-10-19, fase 3 su `main` (non deployata). Sul Mac mini: `npm ci && npm
test && npm run build` verdi (511 test, di cui 155 nuovi scritti da un altro
agente: `registerFlow`, `profileCompletion`, `authErrors`); bundle iniziale
da 495 a 385 kB («Chi sei?» e "I tuoi dati" caricati quando servono).
Review del diff da un altro agente (PASS WITH CONCERNS), correzioni applicate
e riviste: "Gestisci" in Famiglia perdeva il figlio, "Iscrivi un'altra
persona" da ospite finiva su "Il tuo account", passo nuovo non in alto,
testi che promettevano la fase 4, account esistenti incompleti trattati come
nuovi, foglio "Esci dall'iscrizione?" (con l'indietro del browser) che
mancava; nel collaudo, la prima lettera digitata nel modulo si perdeva e,
una volta su qualche giro, un Google nuovo da "Iscrivo mio figlio" restava
`participant`: all'accesso la seconda lettura del profilo riscriveva il ruolo
letto prima (`ensureProfileForUser` ora scrive `role` e `mustChangePassword`
solo se mancano; 3 giri su 3 verdi dopo).
Nell'emulatore, da un altro agente, `functions/tests/accountTypeRulesEmulator.test.mjs`
19 verdi + 3 `todo`: le scritture del profilo della fase 3 (creazione, tipo di
account, "I tuoi dati" da genitore e da partecipante, accesso che non tocca
più il ruolo) passano con le rules di oggi, un dirigente o un ragazzo non si
danno ruoli. I 3 `todo`: un profilo senza `role` o `mustChangePassword` non
si aggiorna (le rules li leggono senza `get`); in produzione sono 0 su 180
(lettura del 2026-10-19). Collaudo con Playwright sul mini
contro emulatori e vite, a 320, 390 e 430 px: 297 controlli verdi su non
entrato (io e figlio), ragazzo che sceglie il figlio per sbaglio, adulto
partecipante, genitore, ragazzo minorenne (anche col telefono usato dal
genitore), ospite, dirigente, «Chi sei?» con uscita, iscrizioni chiuse,
passo senza prerequisiti, Google chiuso, Google nuovo e Google di un account
esistente (non convertito), "Gestisci" da Famiglia, foglio d'uscita dal
modulo, passo nuovo dall'alto a 320 px, cambio di tipo di account dal
profilo; nessun dialogo del browser, console pulita,
niente scroll orizzontale, campi a 16 px, target da 44 px, titoli 27-32 px.
Confronti affiancati con i mockup in `.claude/qa-fase3/out/confronto-*.png`.
Non provati: tastiera aperta su Safari iOS e Android veri, produzione.

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
