---
id: gugd-select-etichette
title: Select con nome accessibile pulito in tutta l'app
status: backlog
impact: 1
urgency: 1
effort: S
delivery: deploy
surface: [web]
source: paolo
opened: 2026-10-31
started_at:
touched: 2026-10-31
due:
blocked_by: []
branch:
worktree:
session:
stopped_at: ""
next: "Censire le select dentro una label (41, 20 file), applicare aria-labelledby come in ActivityProgram e aggiornare i locator getByLabel dei test"
verified: ""
links: [src/components/activities/ActivityProgram.tsx]
done_at:
---

## Contesto

Collaudo del programma a momenti, 31 ottobre: una `<select>` dentro la sua
`<label class="field">` prende come nome accessibile anche il testo delle
opzioni («Per chi vuoi iscriverti? Scegli un partecipante Genitore Figlio»).
Uno screen reader legge un'etichetta sporca e `getByLabel(..., { exact: true })`
non la trova. Corretto solo in `src/components/activities/ActivityProgram.tsx`
con `aria-labelledby`; nel resto dell'app ci sono 41 select in 20 file.

## Fatto quando

- Ogni select dentro una label ha come nome accessibile solo il testo della
  label (controllo con Playwright `getByLabel` esatto o `accessibleName`).
- Nessun cambiamento visivo.

## Da fare

- Censire le select dentro una label (`rg '<select' src`).
- Applicare lo stesso schema di `ActivityProgram.tsx` (`useId` + `aria-labelledby`).
- Una guardia in `tests/` che segnali una select nuova dentro una label senza
  `aria-labelledby`.

## Verificato

Vuoto.
