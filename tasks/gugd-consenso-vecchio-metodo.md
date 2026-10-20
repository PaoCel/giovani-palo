---
id: gugd-consenso-vecchio-metodo
title: "Recupero vecchio metodo: parentConfirmed del titolare vale come firma"
status: idea
impact: 2
urgency: 1
effort: S
delivery: merge
surface: [functions, rules]
source: review
opened: 2026-10-20
started_at:
touched: 2026-10-20
due:
blocked_by: []
branch:
worktree:
session:
stopped_at: ""
next: "Censire in sola lettura le iscrizioni con answers.parentConfirmed o parentalConsentAccepted senza pdfPath, poi decidere se la callable li accetta ancora"
verified: ""
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
