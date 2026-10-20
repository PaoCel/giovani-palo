---
id: gugd-admin-iscritti
title: "Admin: iscrizione a mano e correzione dei dati di un iscritto"
status: needs-paolo
impact: 2
urgency: 2
effort: M
delivery: deploy
surface: [web, rules, functions]
source: paolo
opened: 2026-10-20
started_at: 2026-10-20
touched: 2026-10-20
due:
blocked_by: ["decisione: scelte I1-I8, R e F in docs/ADMIN_ISCRITTI.md"]
branch: task/gugd-admin-iscritti
worktree: /Users/paolocelestini/Developer/giovani-palo/.claude/worktrees/goofy-einstein-78f784
session: 3b5e6431-ed1b-420c-83ed-ae790b460974
stopped_at: "Spec e mockup pronti, rivisti da un secondo modello; aspettano le scelte di Paolo"
next: "Con le scelte di Paolo: censimento in sola lettura delle iscrizioni in prod, rules con test nell'emulatore (budget), trigger che invalida i link, poi estrazione della tab Iscritti e UI"
verified: ""
links: [docs/ADMIN_ISCRITTI.md, docs/AUTONOMIA_MULTI_PALO.md]
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

- `gugd-admin-dialoghi` è chiuso (2026-10-20): si parte da `main`; estrarre
  la tab Iscritti di `AdminEventDetailPage.tsx` (4800 righe) in un file suo.
- spec `docs/ADMIN_ISCRITTI.md`: stati e ritorni, effetti di data di
  nascita, unità e nome su consensi e visibilità, rules, functions, scelte.
- serve anche un deploy delle functions (trigger che invalida i link quando
  un'iscrizione esce da "in attesa" senza firma): `delivery: deploy` vale per
  rules, functions e hosting, nell'ordine.

## Verificato
