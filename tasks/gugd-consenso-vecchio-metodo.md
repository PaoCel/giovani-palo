---
id: gugd-consenso-vecchio-metodo
title: "Recupero vecchio metodo: parentConfirmed del titolare vale come firma"
status: done
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
stopped_at: "In produzione dal 2026-11-03: recupero solo con stato authorized del server, senza modulo caricato, data da authorizedAt"
next: ""
verified: "Deploy 2026-11-03 su conferma di Paolo dal clone pulito 88d16a7 sul mini (test 1562/1562, build): hosting con service worker v37, index.html, sw.js, index-C9H0GNY2.js e index-CncvBQr5.css identici alla build su gugditalia.it e web.app; parentAuthorizationBackfillLegacyApprovals ACTIVE, sorgente live (generateDownloadUrl) con parentAuthorization.js identico a main (sha256), chiamata senza parametri risponde INVALID_ARGUMENT strutturato. Test 33/33 scritti da un agente diverso. Censimento prod in sola lettura: dopo la stretta 1 candidata su 6 (viaggio al tempio, con authorizedAt). Residui nella sezione dedicata"
links: []
done_at: 2026-11-03
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
