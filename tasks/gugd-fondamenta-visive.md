---
id: gugd-fondamenta-visive
title: "Fondamenta visive minime: token e componenti condivisi"
status: backlog
impact: 1
urgency: 1
effort: M
delivery: merge
surface: [web]
source: paolo
opened: 2026-10-20
started_at:
touched: 2026-10-20
due:
blocked_by: []
branch:
worktree:
session:
stopped_at: ""
next: "Elenco dei componenti che servono a coda Richieste, Persone e home (Card, Notice, EmptyState con azione, PageHeader) e dei token che mancano, senza sostituzioni globali"
verified: ""
links: [docs/REDESIGN_BRIEF.md, "~/dev/agent-handbook/projects/giovani-palo/piano-autonomia-2026-10-18.md"]
done_at:
---

## Contesto

Nell'ordine deciso il 2026-10-18 viene dopo il flusso genitore e prima di S2:
token completi (spaziatura, tipo, radius, z-index) e un vocabolario di
componenti, adottati solo nelle pagine che si toccano (parere Codex: niente
sostituzione meccanica globale prima di S2). Serve alle pagine admin nuove e
alla home social, così nascono con gli stessi pezzi.

## Fatto quando

- token e 4-5 componenti condivisi in uso in almeno una pagina vera;
- nessun cambio visivo nelle pagine non toccate (collaudo a 320/390/430).

## Da fare

- può girare in parallelo a S2 (file diversi: CSS e componenti contro rules,
  functions e servizi).

## Verificato
