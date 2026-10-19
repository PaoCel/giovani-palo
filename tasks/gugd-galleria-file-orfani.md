---
id: gugd-galleria-file-orfani
title: "Galleria: file in Storage dei media cancellati"
status: backlog
impact: 1
urgency: 1
effort: S
delivery: merge
surface: [functions]
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
next: ""
verified: ""
links: []
done_at:
---

## Contesto

Review finale di `gugd-finitura-famiglia`: la cancellazione di un media
toglie i file in Storage dal client (`deleteMediaFolder`) dopo il documento.
Se l'app si chiude prima che la scrittura offline arrivi al server, i file
restano orfani (c'era già); dal branch il client li toglie quando la
scrittura in coda viene confermata, ma solo con la pagina aperta.

## Fatto quando

- Trigger gen2 `europe-west1` sulla cancellazione di
  `stakes/{s}/galleries/{g}/media/{m}` che toglie il prefisso Storage del
  media, idempotente, con guardia anti-bulk; test nell'emulatore.
- Censimento in sola lettura dei prefissi orfani in produzione prima di
  decidere se ripulirli (decide Paolo).

## Da fare

- trigger, test, censimento.

## Verificato

