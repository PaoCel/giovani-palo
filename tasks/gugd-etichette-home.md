---
id: gugd-etichette-home
title: "Finitura della home /me, della scheda attività e della firma"
status: needs-paolo
impact: 1
urgency: 1
effort: S
delivery: merge
surface: [web]
source: review
opened: 2026-10-20
started_at:
touched: 2026-10-20
due:
blocked_by: ["decisione: quale variante per le etichette della home"]
branch:
worktree:
session:
stopped_at: ""
next: "Paolo sceglie A, B o C per le etichette (confronto in side-session-notes local_554ce4c8/qa-finitura/out/etichetta-confronto.png); poi stesso giro sui rilievi"
verified: ""
links: []
done_at:
---

## Contesto

Dal collaudo di `gugd-finitura-famiglia` (2026-10-20): fuori da Famiglia la
spec "Finitura" (testo secondario ≥ 13 px, target ≥ 44 px) non è rispettata
in tre pagine. Le etichette mono maiuscole della home toccano tutta la home,
quindi prima la scelta di Paolo.

## Fatto quando

- Etichette `.dash-section__eyebrow` (10,9 px) e `.dash-head__eyebrow`
  (11,2 px) secondo la scelta: A com'è, B 13 px mono maiuscolo
  (consigliata), C 13 px testo normale. Confronto:
  `side-session-notes/local_554ce4c8…/qa-finitura/out/etichetta-confronto.png`.
- Home `/me`: "Condividi il sito" 43 px, "Iscriviti"/"Dettagli attività"
  42 px, chip di stato 12,8 px.
- Scheda `/me/activities/:id`: "Condividi" e tasto senza nome 42 px, chip
  10,6 px ("Annullata", "Congiunta", "Dati iscrizione").
- Pagina di firma: passi a 11,2 px, "Cancella" 42 px, "Non autorizzo" 29 px.
- Collaudo a 320/390/430 con `.claude/qa-finitura/qa.mjs` (scenari home,
  scheda, firma: oggi "rilievo fuori perimetro").

## Da fare

- scelta di Paolo; CSS mirato per pagina; collaudo.

## Verificato

