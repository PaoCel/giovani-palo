---
id: gugd-etichette-home
title: "Finitura della home /me, della scheda attività e della firma"
status: done
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
stopped_at: Pagina di firma in produzione dal 2026-11-03; home /me e scheda passate a gugd-restyling
next: ""
verified: "Deploy 2026-11-03 su conferma di Paolo dal clone pulito 88d16a7 sul mini (test 1562/1562, build): hosting con service worker v37, index.html, sw.js, index-C9H0GNY2.js e index-CncvBQr5.css identici alla build su gugditalia.it e web.app. Misure a 320/390/430 su copia statica col CSS reale: Non autorizzo e Cancella 44 px, passo attivo 13 px, nessuno sbordo. Non provato sulla pagina vera con un token di firma"
links: []
done_at: 2026-11-03
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

