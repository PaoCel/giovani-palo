---
id: gugd-s2-appartenenza
title: "S2: appartenenza al palo verificata e coda Richieste"
status: in-progress
impact: 2
urgency: 2
effort: L
delivery: deploy
surface: [web, rules, functions, storage]
source: paolo
opened: 2026-10-20
started_at: 2026-10-20
touched: 2026-10-22
due:
blocked_by: []
branch: task/gugd-s2-appartenenza
worktree: /Users/paolocelestini/Developer/giovani-palo/.claude/worktrees/kind-rosalind-0307da
session: c7c7a22a-2ea7-445c-83f3-8f6620283c8a
stopped_at: "Scelta S2-3 (Non lo conosco del dirigente agli admin) costruita sul branch a eb1d4fd: test e batteria verdi, verifica Codex; niente deployato"
next: "Decisione di Paolo sul punto aperto: previous leggibile dal richiedente (proposta: spostarlo in members/{uid}/staff/previous); poi rilascio nell'ordine della spec con conferma fresca per ogni passo"
verified: "2026-10-22 sul mini, eb1d4fd (S2-3): batteria dei file toccati verde (callable 70/0, trigger 18/0, fase 3 server 28/0, accesso 16/0, query del client 93/0, contratto 1724/0), puri functions 409/409, client 1389/1390 (accenti senza git; in locale 55/55), tsc e build ok; collaudo Playwright 103/103 (S2-3: dirigente, Annulla che rimette l'unità, coda dell'admin, banner senza unità); Codex PASS WITH CONCERNS sulla scelta e sulle correzioni (resta aperto previous leggibile). 2026-10-21, 6935f79: batteria completa 37 file a 0 fail, 3973 pass. Niente in produzione"
links: [docs/APPARTENENZA_AL_PALO.md, docs/ROADMAP_PALI.md]
done_at:
---

## Contesto

Oggi il palo lo sceglie l'utente (`users.stakeId`) e basta per vedere foto di
minori, record e sondaggi. S2 introduce `stakes/{s}/members/{uid}` scritto solo
dal server, con la coda "Richieste di accesso" per admin e dirigenti di unità.
È la base di tutta la gestione admin (S4) e di qualunque home "social": un feed
del palo su un'appartenenza autodichiarata mostrerebbe i ragazzi a chiunque
scelga il palo. Scelte A1-A3 approvate il 2026-10-16 (A3 come proposta da
Claude: attivi staff e iscritti, questi ultimi da confermare).

## Fatto quando

- rules Firestore e Storage leggono `members/{uid}` al posto di
  `users.stakeId` per galleria, media, like, commenti, segnalazioni, record,
  sondaggi; Storage legge un solo documento Firestore per richiesta;
- coda Richieste con approva, rifiuta, "Non è della mia unità", toast Annulla
  con `version`; stato "in attesa" per l'utente con le sue uscite;
- migrazione A3 eseguita con dry-run e poi reale, prima delle rules;
- cleanup di `members` nella cancellazione account;
- matrice provata nell'emulatore con l'SDK client, le query esatte e la PWA
  vecchia; collaudo nel browser per ogni stato.

## Da fare

Fase 1 (fatta il 2026-10-20): numeri A3 riletti, contratto ruolo × stato ×
dato nella spec, test dell'emulatore scritti da un altro agente, rules
Firestore di `members` e di ciò che è dei membri, logica e script della
migrazione con dry-run e `--expect-create`, `members` del primo admin in
`create-stake` e nel seed demo. Niente deployato.

Fase 2 (fatta il 2026-10-20): interfaccia di callable e trigger scritta nella
spec prima del codice («Callable e trigger: interfaccia»); test dell'emulatore
scritti da un altro agente (Fable) dalla spec; callable `stakeMembership`
(richiesta, ritiro, uscita, approva, rifiuta, "Non è della mia unità", "Lo
conosco"/"Non lo conosco", rimuovi, blocca, sblocca, riattiva, Annulla con
`version`) e trigger `onUserStakeMembership` in `europe-west1`;
`activityGallery` e `recordNightParticipant` da `members` (S2-2); S2-1 sul
branch (client senza codici galleria, script `cleanupGalleryCodes.js`).
Niente deployato.

Fase 3 (fatta il 2026-10-21, sessione nata dalla "top" nel worktree
`kind-rosalind-0307da`): `main` unito (`2a1fa42`, service worker v30) e
batteria verde; stati e ritorni del client e aggiunte server scritti nella spec
prima del codice («Aggiunte server della fase 3», «Client della fase 3»);
mockup mostrato a Paolo (cartella note del gruppo, `mockups/01-fase3.png`).
Server: nota "stesso nome e data" in `members/{uid}/staff/note`, azione
`hasAccount` (per il richiedente resta `decline`), promemoria
`stakeMembershipQueueReminder` (ogni giorno alle 18, solo se consegnato).
Client: "membro" da `members/{uid}` con un ascolto condiviso
(`useStakeMembership`), banner in `/me` e `/family`, superfici dei membri
chiuse senza letture negate (galleria, card in home, record, sondaggi,
commenti, like, campeggio, certificato), uscita dal palo nel profilo, pagina
Persone (`/admin/persone`, `/unit/persone`: Richieste, Da confermare,
Rifiutate) con toast "Annulla", numero nel menu e card in dashboard. Test di
Fable dalla spec; review Codex BLOCKED (7 punti), recepita; verifica Codex
sulle correzioni. Niente deployato.

Scelte di prodotto proposte a Paolo il 2026-10-21 (costruite con la proposta,
reversibili): 1) niente "Hai un codice?" e "chiedi un codice" finché i codici
non esistono (S3), al loro posto "parlane con un dirigente della tua unità";
2) contatto = `supportContact` del palo (risolta: il campo esiste); 3) "Non lo conosco" del dirigente su un migrato da confermare passa la
richiesta agli admin come "Non è della mia unità" (scelta S2-3, Paolo il
2026-10-22: `markUnknown` del dirigente svuota `claimedUnitId`, l'admin lo vede
con "Il dirigente non lo conosce", "Annulla" rimette l'unità); 4) illustrazione della porta di "Iscrizione inviata" nel
banner; 5) voce "Persone" nel menu di admin e dirigenti.

Prossime fasi:

- da decidere prima del rilascio (review Codex del 2026-10-22): il richiedente
  legge `previous` del proprio members (ultima azione e uid di chi l'ha fatta);
  proposta: spostarlo in `members/{uid}/staff/previous`, solo staff;
- "Ho sbagliato palo" e "Hai un codice?" con S3; uscita dello staff, dopo tre
  rifiuti e oltre i 30 giorni con S4 (Persone);
- cleanup di `members` (con `history` e `staff`) alla cancellazione account
  (nel repo non c'è ancora un flusso di cancellazione);
- rules Storage dopo la fase B di `gugd-storage-eu` (celle già scritte, si
  sbloccano con `S2_STORAGE_CONTRACT=1`);
- rilascio nell'ordine della spec, ogni passo con conferma di Paolo: dry-run
  della migrazione con `--report` contro 31/108/41, `--apply`, rules Firestore
  e trigger, callable (`activityGallery`, `recordNightParticipant`,
  `stakeMembership`) e `stakeMembershipQueueReminder` (crea un job di Cloud
  Scheduler: API attiva sul progetto), client con il service worker a v31. Per S2-1 nello stesso rilascio: dry-run di
  `cleanupGalleryCodes.js` (atteso 1 galleria), `--apply --expect-galleries
  --expect-deletes`, poi `firebase functions:delete unlockGalleryWithCode
  setGallerySecretCode` per nome. Prima del deploy, in sola lettura su prod, la
  query dell'ultimo admin (`users` con `stakeId` e `role == admin`);
- dopo che la PWA vecchia è uscita dalle cache: togliere dalle rules i match
  di `galleries/{g}/members`, `users/{uid}/unlockedGalleries` e
  `gallerySecrets`.

Scelte S2-1 e S2-2 approvate da Paolo il 2026-10-20 ("sì, vai con la fase
2"): cancellare `unlockGalleryWithCode`, `setGallerySecretCode`, il codice
client morto, il pulsante del codice e i documenti di sblocco (la cancellazione
in produzione resta un passo del rilascio, con conferma fresca); Notte dei
Record solo da membro (`propose`/`challenge`), ritirarsi sempre.

## Verificato

2026-10-20, sul mini, branch a `aba2cd2`: test del contratto 1724 pass, 0 fail,
164 Storage saltati; migrazione 54 pura + 13 nell'emulatore (con `--apply`
vero); 26 file di emulatore esistenti a 0 fail; `registrationUpdateRules.py`
5/5; client 969/970 (il rosso è il test degli accenti senza git sul mini, in
locale passa). Controllo all'indietro: con le rules di `main` 360 celle
diventano rosse. Review: Codex BLOCKED (6 punti) e Fable PASS WITH CONCERNS (4
punti), tutti recepiti. Non provato: niente in produzione, nessun account vero.

Fase 2, 2026-10-20, sul mini in una copia isolata (`~/qa/giovani-palo-s2f2`):
batteria completa a `0367e29` (prima delle correzioni di review, che toccano
solo callable, trigger e script) con 33 file di emulatore a 0 fail (contratto 1724/0 con 164 Storage
saltati, migrazione 13/0, i 26 esistenti), `registrationUpdateRules.py` 5/5,
test puri delle functions 409/409, client 969/970 (accenti senza git sul mini;
in locale 55/55) e build verde. Test della fase scritti da Fable dalla spec:
callable, trigger, accesso a galleria e record, script S2-1 (vedi «verified»
per i numeri finali). Controllo all'indietro: il file di accesso contro
`activityGallery.js` e `recordNight.js` di `main` dà 5 test rossi su 13 (N, P,
F, X ammessi). Primo giro della batteria: 3 file rossi per seed senza members e
una gara di tempi in `familyAnyAdultRulesEmulator`, corretti. Review: Fable
PASS WITH CONCERNS (9 punti, recepiti 1-7 e 9; l'8 sono residui pianificati),
poi Codex sulle correzioni PASS WITH CONCERNS (3 punti, recepiti). Non
provato: niente in produzione, nessun account vero, rules Storage.
