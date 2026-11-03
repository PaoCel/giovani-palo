---
id: gugd-galleria-file-orfani
title: "Galleria: file in Storage dei media cancellati"
status: done
impact: 1
urgency: 1
effort: S
delivery: merge
surface: [functions]
source: review
opened: 2026-10-20
started_at: 2026-11-03
touched: 2026-11-03
due:
blocked_by: []
branch:
worktree:
session: 324c0270-ecd5-4491-ac05-a5580bd6c85f
stopped_at: "Cancellati il 2026-11-03, su conferma di Paolo, i 34 doppioni dai due bucket; tenuti i 7 senza copia visibile"
next: ""
verified: "2026-11-03: script .claude/ops/galleria-orfani/doppioni.cjs (fuori da git) ricalcola dal vivo e cancella solo i prefissi orfani le cui foto esistono già come media visibile, con controllo sul conteggio atteso e checkpoint per prefisso. Prova a vuoto 34 su 41, poi 34 prefissi e 148 oggetti cancellati dai due bucket; ricontrollo: 294 prefissi media, 7 orfani, 0 doppioni. Galleria del campeggio dopo la pulizia: 139/139 immagini caricate nel browser. Soft delete di 7 giorni attivo su entrambi i bucket. Trigger onGalleryMediaDeleted provato live con un media sintetico"
links: []
done_at: 2026-11-03
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


## Censimento e passaggio UE, 26 ottobre

Lettura dello Storage sorgente e dei soli campi necessari a verificare
l'esistenza dei documenti, nessun download: 1196 oggetti, quattro gallerie
esistenti, 328 prefissi media; 41 non hanno documento visibile o nascosto.
Non sono automaticamente dati cancellabili: possono includere caricamenti
interrotti, vecchie cancellazioni o altri stati da classificare. Nessun file
rimosso e nessun piano di riparazione applicato.

Il passaggio B aggiunge cleanup gen2 dei singoli media, riprendibile sui due
bucket e protetto da tombstone server-only. Il censimento storico e la
cancellazione completa di una galleria restano separati: Firestore non
cancella le sottocollection con il documento padre. Il futuro cleanup della
galleria deve conservare mediaLifecycle finché il bucket USA è aperto,
altrimenti il sync potrebbe ricreare i file. La galleria legata a un'attività
può essere riaperta automaticamente da ensure: definire questo stato prima
di introdurre la cancellazione completa.
