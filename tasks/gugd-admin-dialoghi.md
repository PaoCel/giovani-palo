---
id: gugd-admin-dialoghi
title: "Admin: fogli al posto dei dialoghi ed errori nei modali"
status: in-progress
impact: 1
urgency: 1
effort: M
delivery: merge
surface: [web]
source: review
opened: 2026-10-20
started_at: 2026-10-20
touched: 2026-10-20
due:
blocked_by: []
branch: task/gugd-admin-dialoghi
worktree: /Users/paolocelestini/Developer/giovani-palo/.claude/worktrees/goofy-einstein-78f784
session: 3b5e6431-ed1b-420c-83ed-ae790b460974
stopped_at: "Codice fatto: 11 dialoghi sostituiti, errori nei modali, catch in AdminSettingsPage; guardia a zero"
next: "Test di un altro agente, review Codex del diff, collaudo da admin contro emulatori sul mini"
verified: ""
links: []
done_at:
---

## Contesto

Fuori dal perimetro di `gugd-finitura-famiglia` per scelta (l'admin non era
nel brief). Restano 11 dialoghi del browser nell'admin, guardati con i
conteggi esatti da `tests/browserDialogs.test.mjs`: `AdminEventDetailPage`
7 (rimuovi pattuglia, elimina domanda, elimina attività, moduli col vecchio
metodo, invio mail ai genitori, elimina iscrizione, annulla iscrizione),
`SurveyEditor` 1, `AdminFeedPage` 1, `GalleryAdminPanel` 2 (elimina media,
elimina galleria). Dalla review Codex, preesistenti nello stesso giro:
errori di comitati/pattuglie, iscrizioni ed export Excel mostrati solo nella
pagina dietro il modale aperto (`AdminEventDetailPage`), e in
`AdminSettingsPage` unità e admin senza `catch`/`finally` (`busyId` resta
acceso, nessun messaggio).

Decisione di Paolo (2026-10-20): **rientrano**. Ha avviato la sessione che li
sostituisce insieme a `gugd-admin-iscritti`.

## Fatto quando

- Paolo dice se rientrano (sì, 2026-10-20). Se sì: `ConfirmSheet` con `tone="danger"`, copy in
  `src/copy/admin.ts`, errori dentro il modale, conteggi della guardia a zero.
- Collaudo da admin contro emulatori (foglio, Esc, dati nel database).

## Da fare

- decisione; poi un file alla volta, la guardia scende a ogni passo.

## Verificato

