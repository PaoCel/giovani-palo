---
id: gugd-select-etichette
title: Select con nome accessibile pulito in tutta l'app
status: done
impact: 1
urgency: 1
effort: S
delivery: deploy
surface: [web]
source: paolo
opened: 2026-10-31
started_at: 2026-11-03
touched: 2026-11-03
due:
blocked_by: []
branch:
worktree:
session: 324c0270-ecd5-4491-ac05-a5580bd6c85f
stopped_at: In produzione dal 2026-11-03
next: ""
verified: "Deploy 2026-11-03 su conferma di Paolo dal clone pulito 88d16a7 sul mini (test 1562/1562, build): hosting con service worker v37, index.html, sw.js, index-C9H0GNY2.js e index-CncvBQr5.css identici alla build su gugditalia.it e web.app. Prima: client 1562/1562 (guardia 13/13), guardia scritta da un agente diverso e resa severa dopo la review Codex; id delle domande personalizzate univoci. Non provato: lettura con screen reader vero"
links: [src/components/activities/ActivityProgram.tsx]
done_at: 2026-11-03
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
