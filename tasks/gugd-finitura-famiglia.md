---
id: gugd-finitura-famiglia
title: Finitura di Famiglia e via i dialoghi del browser dai percorsi utente
status: in-progress
impact: 2
urgency: 2
effort: M
delivery: merge
surface: [web]
source: agente
opened: 2026-10-19
started_at: 2026-10-19
touched: 2026-10-19
due:
blocked_by: []
branch: task/gugd-finitura-famiglia
worktree: /Users/paolocelestini/Developer/giovani-palo/.claude/worktrees/ecstatic-hodgkin-e6b647
session: dd94c8b9-2344-4ff7-a5b3-500246ad7983
stopped_at: ""
next: ""
verified: ""
links: []
done_at:
---

## Contesto

Collaudo della fase 6 del flusso genitore (G2): Famiglia ora la vedono tutti
gli adulti, e i 6 rossi rimasti sono finiture già esistenti (tasti
`button--small` da 42 px, badge da 12,8 px, etichetta delle sezioni di `/me`
a 10,9 px). La spec (`docs/FLUSSO_GENITORE.md`, "Finitura" e "mai un dialogo
del browser") vale anche fuori dal flusso d'accesso: restano
`window.confirm`/`alert` nella scheda attività, nella firma del genitore, nelle
domande, in galleria e nel lightbox. Solo client, nessun cambio ai dati.

## Fatto quando

- Famiglia a 320/390/430 px: target ≥ 44 px, testo secondario ≥ 13 px, nessuno
  scroll orizzontale (collaudo Playwright sul mini contro emulatori).
- Nessun dialogo del browser in `MyActivityDetailPage`, `ParentConfirmPage`,
  `QuestionsSection`, `ActivityGallery`, `MediaLightbox`: foglio in pagina,
  copy in `src/copy/`.
- Etichetta delle sezioni di `/me`: scelta di Paolo con screenshot prima/dopo.
- Dialoghi delle pagine admin elencati per Paolo (non toccati senza ok).
- Test e review di un altro agente o modello; merge in `main`. Nessun deploy.

## Da fare

- finitura Famiglia (CSS mirato alle schede dei figli);
- fogli al posto dei dialoghi nei cinque file;
- collaudo, test, review, merge.

## Verificato

