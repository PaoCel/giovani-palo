---
id: gugd-galleria-file-orfani
title: "Galleria: file in Storage dei media cancellati"
status: needs-paolo
impact: 1
urgency: 1
effort: S
delivery: merge
surface: [functions]
source: review
opened: 2026-10-20
started_at:
touched: 2026-11-03
due:
blocked_by: ["decisione: cancellare i 34 doppioni dai due bucket (soft delete 7 giorni) e tenere i 7 senza copia visibile"]
branch:
worktree:
session: 324c0270-ecd5-4491-ac05-a5580bd6c85f
stopped_at: Classificazione in sola lettura dei 41 prefissi orfani fatta; trigger di cleanup onGalleryMediaDeleted live (gen2 europe-west1); nessun file cancellato
next: "Con l'ok di Paolo: script riprendibile e idempotente che cancella i 34 doppioni da entrambi i bucket, ricontrollando ogni prefisso prima di toccarlo"
verified: "2026-11-03 sola lettura (Storage JSON API e Firestore batchGet): 41 prefissi senza media né hiddenMedia né mediaLifecycle, tutti in gallerie esistenti, presenti in UE e USA, 52,7 MB per bucket. 34 del campeggio sono doppioni di foto già visibili (caricamenti ripetuti di luglio, 30 optimized+thumb e 4 poster). 7 senza copia visibile: 2 foto del campeggio e 5 video del viaggio al tempio di maggio (4 solo poster, 1 originale .mov da 5,7 MB). Soft delete 7 giorni attivo su entrambi i bucket. functions:list conferma onGalleryMediaDeleted e onGalleryMediaLifecycle live"
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
