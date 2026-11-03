---
id: gugd-etichette-home
title: "Finitura della home /me, della scheda attività e della firma"
status: in-progress
impact: 1
urgency: 1
effort: S
delivery: merge
surface: [web]
source: review
opened: 2026-10-20
started_at: 2026-11-03
touched: 2026-11-03
due:
blocked_by: []
branch:
worktree:
session: 324c0270-ecd5-4491-ac05-a5580bd6c85f
stopped_at: "Pagina di firma sistemata il 2026-11-03 (Non autorizzo e Cancella a 44 px, passi a 13 px con solo il passo attivo etichettato su schermo stretto); home /me e scheda passano a gugd-restyling; non deployato"
next: "Deploy hosting con gli altri fix del 2026-11-03, poi tasks done"
verified: "2026-11-03: CSS reale incorporato in una copia statica della pagina di firma, misurato nel pannello browser a 320/390/430: Non autorizzo 44 px, Cancella 44 px, etichetta del passo attivo 13 px, passi non attivi a pallino (etichetta ancora nel DOM per gli screen reader), nessuno sbordo. Non provato sulla pagina vera con un token di firma"
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
- La home `/me` verrà rifatta da `gugd-home-social` (dopo S2): se questo task
  parte prima, conviene limitarsi a scheda e firma.

## Verificato

