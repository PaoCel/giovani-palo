---
id: gugd-attivita-modulari
title: "Attività guidate: programma, gruppi, comitati e alloggi"
status: in-progress
impact: 2
urgency: 2
effort: L
delivery: deploy
surface: [web, functions, rules]
source: paolo
opened: 2026-10-26
started_at: 2026-10-26
touched: 2026-10-26
due:
blocked_by: []
branch: codex/gugd-creazione-essenziale
worktree:
session: 01a177a4-ce16-72d3-aedf-38c33a576cc0
stopped_at: "Spec e review registrate; prima implementazione avviata in chat e worktree isolati, S2 e home in chat separate"
next: "Completare e collaudare il primo incremento della creazione essenziale, poi integrare il branch e procedere con i moduli"
verified: "26 ottobre: confronto con editor/spec e secondo parere indipendente di prodotto PASS WITH CONCERNS, recepito nella spec; nessun nuovo flusso implementato o collaudato"
links: [docs/ATTIVITA_MODULARI.md, docs/PROGRAMMA_A_MOMENTI.md, docs/AUTONOMIA_MULTI_PALO.md]
done_at:
---

## Contesto

Paolo, 26 ottobre: rendere configurabili dall'app le operazioni oggi affidate
all'operatore con accesso completo ai dati. Creazione essenziale, sottoattività
con iscrizioni, comitati con incarichi, gruppi dal nome configurabile e alloggi;
gestione anche da un responsabile esplicitamente delegato all'attività.

Priorità esplicita di Paolo del 26 ottobre: iniziare autonomamente e aprire
nuove chat per i filoni indipendenti. Registrato il superamento del limite
WIP globale; nessun altro task è stato parcheggiato automaticamente.

## Fatto quando

- Un admin di un secondo palo supera gli scenari di autonomia della spec
  senza console, script né interventi di Paolo.
- Bozza essenziale, opzioni su richiesta e pubblicazione esplicita; eventi,
  link, iscrizioni e firme esistenti conservati.
- Delega, rules, indici e test dei ruoli verificati per ogni nuovo modulo;
  collaudo mobile e review indipendente.
- Blocchi mergiati e deployati dopo conferma fresca, senza dichiarare fatto
  ciò che è solo implementato.

## Da fare

- Blocchi e dipendenze in docs/ATTIVITA_MODULARI.md; primo incremento:
  semplificazione della creazione, senza nuovi dati.
- Home social nel task esistente; Persone e provisioning in S2/S4.

## Verificato

Analisi del codice e delle spec, 26 ottobre. Collaudo funzionale da eseguire.
