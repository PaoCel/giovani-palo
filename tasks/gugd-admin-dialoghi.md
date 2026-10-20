---
id: gugd-admin-dialoghi
title: "Admin: fogli al posto dei dialoghi ed errori nei modali"
status: done
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
stopped_at: "Fatto e mergiato in main; non deployato (prossimo hosting: service worker v30)"
next: "Deploy hosting con conferma di Paolo, insieme al resto pronto"
verified: "Test: 1131 sul mini (1121 verdi, 9 skipped, accentApostrophes verde in locale), 140+22 test nuovi scritti da un altro agente con mutazioni di src/. Review: Codex (BLOCKED, 4 punti corretti: doppio decremento mediaCount, guardie di contesto, messaggi delle callable, pulizia Storage dopo timeout) e secondo giro con un altro modello (PASS WITH CONCERNS, navigazione da pagina lasciata corretta in 7a1a3be). Collaudo da admin contro emulatori sul mini (Playwright, 390 e 1280): 494/494 dopo 9ea3cf4, script e screenshot in side-session-notes/local_0456cb35…/qa-admin-dialoghi/. Non provati: cambio account con foglio aperto, 320/430 px, Safari iOS."
links: []
done_at: 2026-10-20
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

Vedi `verified`. Oltre al perimetro, sistemati nello stesso giro (stessa
classe): Esc che chiudeva insieme due modali impilati (`isTopLayer`),
`mediaCount` che scendeva due volte con un "Elimina" ripetuto dopo il timeout
(anche nella galleria degli utenti: ora transazione), `catch` mancanti su
cover e ordine dei media, pubblica/bozza dei post, salvataggio di Profilo e
Moduli senza timeout. Restano: il foglio azioni dei media non sposta il focus
né ha un nome accessibile (preesistente); una scrittura scaduta offline parte
comunque al ritorno della rete (ora il foglio lo dice).

