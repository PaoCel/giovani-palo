---
id: gugd-admin-iscritti
title: "Admin: iscrizione a mano e correzione dei dati di un iscritto"
status: ready
impact: 2
urgency: 2
effort: M
delivery: deploy
surface: [web, rules]
source: paolo
opened: 2026-10-20
started_at:
touched: 2026-10-20
due:
blocked_by: []
branch:
worktree:
session:
stopped_at: ""
next: "Spec breve con stati e ritorni (cosa succede ai consensi se cambiano data di nascita, unità o nome), mockup con i token reali, poi codice nella tab Iscritti"
verified: ""
links: [docs/AUTONOMIA_MULTI_PALO.md]
done_at:
---

## Contesto

Audit del 2026-10-20: le iscrizioni `manual_` si creano solo con l'Admin SDK
(13 sul viaggio al tempio) e l'admin non può correggere nome, unità o data di
nascita di un iscritto, solo stato ed email del genitore. Sono le richieste
più frequenti di un admin che non tocca ruoli né appartenenza, quindi non
aspettano S2 (il collegamento all'account con "Mostra codice" arriva con S3).
Le rules danno già `create` e `update` all'admin del palo senza controllo del
payload (`firestore.rules:1498-1504`).

## Fatto quando

- "Aggiungi a mano" nella tab Iscritti crea `manual_<id>` con `createdBy`;
  "Chiedi l'autorizzazione" usa il flusso esistente se c'è l'email del genitore;
- "Modifica dati" su un'iscrizione: nome, cognome, unità, data di nascita,
  categoria, note; un cambio che sposta minore/adulto o l'unità dice cosa
  succede a consensi e visibilità del dirigente prima di salvare;
- un'iscrizione a mano si annulla e si riattiva come le altre;
- deciso se l'update admin delle iscrizioni va limitato a una allowlist di
  campi (oggi può riscrivere anche i consensi firmati), verificando quali
  scritture usano le build in giro;
- test unitari e rules nell'emulatore da un altro agente, collaudo nel browser.

## Da fare

- dopo `gugd-admin-dialoghi` se rientra: tocca lo stesso
  `AdminEventDetailPage.tsx` (4509 righe); estrarre la tab Iscritti in un file
  suo mentre ci si lavora.

## Verificato
