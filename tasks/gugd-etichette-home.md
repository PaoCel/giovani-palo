---
id: gugd-etichette-home
title: "Finitura della home /me, della scheda attività e della firma"
status: backlog
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
blocked_by: []
branch:
worktree:
session:
stopped_at: ""
next: "CSS mirato per home, scheda e firma, poi collaudo con .claude/qa-finitura/qa.mjs"
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

- Etichette della home: fatte il 2026-10-20 (variante B scelta da Paolo,
  13 px mono maiuscolo, spaziatura 0.08em), in produzione con il service
  worker v29.
- Home `/me`: "Condividi il sito" 43 px, "Iscriviti"/"Dettagli attività"
  42 px, chip di stato 12,8 px.
- Scheda `/me/activities/:id`: "Condividi" e tasto senza nome 42 px, chip
  10,6 px ("Annullata", "Congiunta", "Dati iscrizione").
- Pagina di firma: passi a 11,2 px, "Cancella" 42 px, "Non autorizzo" 29 px.
- Collaudo a 320/390/430 con `.claude/qa-finitura/qa.mjs` (scenari home,
  scheda, firma: oggi "rilievo fuori perimetro").

## Da fare

- CSS mirato per pagina; collaudo.

## Verificato

