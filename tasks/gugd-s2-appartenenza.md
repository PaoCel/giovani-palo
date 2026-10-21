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
touched: 2026-10-21
due:
blocked_by: []
branch: task/gugd-s2-appartenenza
worktree: /Users/paolocelestini/Developer/giovani-palo/.claude/worktrees/kind-rosalind-0307da
session: c7c7a22a-2ea7-445c-83f3-8f6620283c8a
stopped_at: "Fase 2 chiusa e main unito nel branch (092e7e6): budget delle iscrizioni rimisurato, batteria completa verde; niente deployato"
next: "Fase 3: client (banner in attesa, coda Richieste in admin e /unit, membro da members in useGalleryAccess, testi) e nota dello staff"
verified: "2026-10-20 sul mini dopo il merge di main (092e7e6, codice a 7faa832): 35 file emulatore a 0 fail (adminRegistrationCallables 39/39 col comando del doc, con Storage), contratto 1724/0, 107 test della fase, budget iscrizioni 48/48 con massimo reale 914→924 (margine 76) e sonda 954 invariata, rules py 5/5, puri functions 409/409, client 1289/1290 (accenti senza git, locale 55/55), build ok; all'indietro 5/13 rossi con galleria e record di main; review Fable e Codex recepite; niente in produzione"
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

Prossime fasi:

- client: banner in attesa, coda nell'admin e in `/unit`, "membro" dal
  documento members e non da `users.stakeId` (`useGalleryAccess`), testi al
  posto dei messaggi inglesi della tabella "PWA vecchia", push dopo 48 ore;
- nota dello staff "stesso nome e data di un membro attivo" e risposta "Ha già
  un account" (spec, «Utente che sbaglia»): non ancora nella callable;
- cleanup di `members` (con `history` e `staff`) alla cancellazione account
  (nel repo non c'è ancora un flusso di cancellazione);
- rules Storage dopo la fase B di `gugd-storage-eu` (celle già scritte, si
  sbloccano con `S2_STORAGE_CONTRACT=1`);
- rilascio nell'ordine della spec, ogni passo con conferma di Paolo: dry-run
  della migrazione con `--report` contro 31/108/41, `--apply`, rules Firestore
  e trigger, callable (`activityGallery`, `recordNightParticipant`,
  `stakeMembership`), client. Per S2-1 nello stesso rilascio: dry-run di
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
