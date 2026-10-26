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
touched: 2026-10-26
due:
blocked_by: []
branch:
worktree:
session:
stopped_at: "Cleanup server media pronto nel passaggio Storage UE; censimento readonly completato, nessun file cancellato"
next: "Dopo integrazione B classificare 41 prefissi senza scheda; nessuna cancellazione senza piano e conferma"
verified: "Censimento prod readonly EXIT0: 1196 oggetti, 4 gallerie esistenti, 328 prefissi media, 41 senza media/hiddenMedia, zero nascosti; cleanup nuovo verificato da test indipendenti, non ancora deployato"
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
