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
touched: 2026-10-20
due:
blocked_by: []
branch: task/gugd-s2-appartenenza
worktree: /Users/paolocelestini/Developer/giovani-palo/.claude/worktrees/epic-northcutt-1a7fb6
session: 5fe59c7c-e31b-461e-858e-ea93b1ccc3e6
stopped_at: "Test del contratto scritti da un altro agente (1591 verdi, 45 rossi sugli anonimi con profilo staff, chiusi in currentUserExists); batteria completa sul mini in corso"
next: "Leggere l'esito della batteria (job mini 20261020-114140-21054, log in s2logs/), committare test e tool, seconda review Codex sul diff completo"
verified: ""
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

- dopo la fase B di `gugd-storage-eu` per la parte Storage (il contratto e le
  rules Firestore possono partire prima);
- contratto scritto e test (da un altro agente) prima delle callable;
- callable `stakeMembership`, trigger, script `migrateStakeMembers.js`;
- client: banner in attesa, coda nell'admin e in `/unit`, push dopo 48 ore;
- elenco delle letture che smettono di funzionare per chi ha la PWA vecchia;
- `unlockGalleryWithCode` e `setGallerySecretCode` sono live in produzione
  senza sorgente nel repo (codici galleria tolti da Paolo, note del
  2026-10-07; il client le chiama ancora da `galleryUnlockService.ts` e
  `gallerySecretsService.ts`): il contratto deve dire che nessuna delle due
  apre la galleria a un non membro, e proporre a Paolo di cancellarle insieme
  al codice client morto.

## Verificato
