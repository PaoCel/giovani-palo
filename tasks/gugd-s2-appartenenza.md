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
stopped_at: "Fase 1 chiusa: contratto, test (1724 verdi, Storage saltati) e rules Firestore di members sul branch, rivisti da Codex e Fable; niente deployato"
next: "Far scrivere a un altro agente i test della callable stakeMembership e del trigger su users dal contratto, poi il codice; S2-1 e S2-2 da Paolo"
verified: "2026-10-20 sul mini a aba2cd2: contratto 1724/0 (164 Storage saltati), migrazione 54+13, 26 file emulatore esistenti a 0 fail, registrationUpdateRules.py 5/5; review Codex e Fable recepite; niente in produzione"
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

Prossime fasi:

- test della callable `stakeMembership` e del trigger su `users` (staffRole,
  richiesta alla scelta del palo, cambio di palo) scritti da un altro agente
  dal contratto, poi il codice; transizioni dello staff e ultimo admin come
  dice la spec;
- `activityGallery` e `recordNightParticipant` da `members` (S2-2 per i
  record);
- cleanup di `members` e note dello staff alla cancellazione account (nel repo
  non c'è ancora un flusso di cancellazione);
- client: banner in attesa, coda nell'admin e in `/unit`, "membro" dal
  documento members e non da `users.stakeId`, testi al posto dei messaggi
  inglesi della tabella "PWA vecchia", push dopo 48 ore;
- rules Storage dopo la fase B di `gugd-storage-eu` (celle già scritte, si
  sbloccano con `S2_STORAGE_CONTRACT=1`);
- rilascio nell'ordine della spec, ogni passo con conferma di Paolo; prima
  dell'`--apply` un dry-run con `--report` contro 31/108/41.

Scelte aperte per Paolo (tabella "Scelte per Paolo" della spec): S2-1
cancellare `unlockGalleryWithCode`, `setGallerySecretCode`, il codice client
morto e i documenti di sblocco; S2-2 Notte dei Record solo da membro.

## Verificato

2026-10-20, sul mini, branch a `aba2cd2`: test del contratto 1724 pass, 0 fail,
164 Storage saltati; migrazione 54 pura + 13 nell'emulatore (con `--apply`
vero); 26 file di emulatore esistenti a 0 fail; `registrationUpdateRules.py`
5/5; client 969/970 (il rosso è il test degli accenti senza git sul mini, in
locale passa). Controllo all'indietro: con le rules di `main` 360 celle
diventano rosse. Review: Codex BLOCKED (6 punti) e Fable PASS WITH CONCERNS (4
punti), tutti recepiti. Non provato: niente in produzione, nessun account vero.
