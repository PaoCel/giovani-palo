---
id: gugd-me-calendario-appeso
title: Calendario /me fermo sullo scheletro (useAsyncData)
status: backlog
impact: 3
urgency: 2
effort: S
delivery: deploy
surface: [web]
source: agente
opened: 2026-11-11
started_at:
touched: 2026-11-11
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

Trovato l'11 novembre 2026 nel collaudo della rapida sugli emulatori del mini, su codice di main (src/hooks/useAsyncData.ts, non toccato dal task della rapida). /me/calendar resta su «Sto preparando il calendario...» oltre 60 s senza errori in console, si sblocca solo ricaricando: visto 4 volte (2 caricamenti su 16 in una ripetizione mirata) mentre altre sessioni scrivevano attività; a emulatore quieto 6 su 6 in meno di un secondo. Ipotesi letta nel codice, non provata: in useAsyncData un rilancio silenzioso (rilettura dopo la cache) che parte durante il primo caricamento disattiva il primo giro (active = false) e, essendo silent, non chiama mai setLoading(false). Correzione probabile: nel finally spegnere loading per ogni giro attivo, anche silenzioso. Vale per ogni pagina che usa useAsyncData, anche in produzione. Per riprodurlo: script mecal2.mjs in ~/qa/gugd-rapida/qa sul mini (node mecal2.mjs 1440 100 mentre girano rapida.mjs e scheda.mjs); screenshot in .claude/mockups/crea-attivita-rapida/collaudo3/1440-mecal-appeso-3.png. Serve un test che blocchi la corsa, scritto da un altro agente.

## Fatto quando

- criteri di accettazione: cosa deve essere vero, osservabile, perché il task
  sia chiuso (e cosa resta fuori, se serve dirlo)

## Da fare

- passi concreti, nell'ordine in cui vanno fatti

## Verificato

Cosa è stato provato davvero e come (configurazione, account, data). Vuoto
finché non c'è niente di provato: "dedotto dal codice" si scrive così.
