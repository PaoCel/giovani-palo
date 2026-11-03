---
id: gugd-consenso-vecchio-metodo
title: "Recupero vecchio metodo: parentConfirmed del titolare vale come firma"
status: in-progress
impact: 2
urgency: 1
effort: S
delivery: merge
surface: [functions, rules]
source: review
opened: 2026-10-20
started_at: 2026-11-03
touched: 2026-11-03
due:
blocked_by: []
branch:
worktree:
session: 324c0270-ecd5-4491-ac05-a5580bd6c85f
stopped_at: "Recupero ristretto allo stato authorized scritto dal server, senza modulo caricato e con data solo da authorizedAt (altrimenti salta); stessa regola nel conteggio client; non deployato"
next: "Deploy di parentAuthorizationBackfillLegacyApprovals e hosting con conferma di Paolo, poi tasks done"
verified: "Censimento prod in sola lettura 2026-11-03 (REST Firestore, nessuna scrittura): 348 iscrizioni, 6 candidate al vecchio recupero, tutte su attività concluse; 5 solo per le risposte del modulo (4 Escape Room aprile, 1 campeggio luglio con modulo caricato), 1 per stato authorized senza pdf (viaggio al tempio ottobre, con authorizedAt). Rules: parentAuthorization e campi del modulo manuale non scrivibili dal titolare. Review Codex: il recupero sovrascriveva il riferimento al modulo caricato e datava la firma col caricamento o con l'ora attuale; corretto escludendo chi ha un modulo e saltando senza authorizedAt. Dopo la stretta resta candidata 1 su 6. Decisione presa al posto di Paolo, reversibile prima del deploy: il recupero serve ancora solo per quel caso"
links: []
done_at:
---

## Contesto

Dalla review Codex di `gugd-admin-iscritti` (2026-10-20). La callable
`parentAuthorizationBackfillLegacyApprovals` (admin) genera il modulo
ufficiale e scrive `confirmed` per ogni iscrizione con
`answers.parentConfirmed === true` o `answers.parentalConsentAccepted ===
true` (`functions/lib/parentAuthorization.js`, intorno alla riga 667). Quei
campi stanno in `answers`, che il titolare scrive dal modulo: un client
modificato può segnarsi "approvato dal genitore" e diventare confermato al
prossimo recupero. Era il vecchio metodo, quindi preesistente; le iscrizioni
a mano nuove sono già chiuse dalle rules (`validAdminManualCreate`).

## Fatto quando

- Censimento delle iscrizioni che il recupero tratterebbe oggi.
- Deciso con Paolo se il recupero serve ancora; se sì, conta solo un
  documento caricato (`parentConsentDocumentPath`) o una firma vera.

## Da fare

## Verificato

## Residui accettati, 3 novembre

- La dry-run e il conteggio client contano anche le iscrizioni che la callable
  poi salta (`missing_parent_identity`, `missing_authorized_at`). Oggi in
  produzione c'è un solo candidato e ha `authorizedAt`: nessun effetto pratico.
- La scrittura finale della callable è un `set(..., { merge: true })` senza
  ricontrollo: un modulo caricato o un annullamento arrivati tra lettura e
  scrittura verrebbero sovrascritti. Preesistente, finestra stretta, azione
  avviata da un admin. Da chiudere con una transazione se il recupero torna a
  servire su molte iscrizioni.
