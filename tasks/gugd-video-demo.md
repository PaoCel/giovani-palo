---
id: gugd-video-demo
title: "Video demo per gli altri pali: preparazione e registrazione"
status: needs-paolo
impact: 2
urgency: 2
effort: S
delivery: merge
surface: [web]
source: paolo
opened: 2026-11-11
started_at:
touched: 2026-11-11
due:
blocked_by: ["decisione: nome e numeri di Roma Est nel video, lingua dei sottotitoli; prova generale da loggato sulla demo"]
branch:
worktree:
session:
stopped_at: "11/11: demo riallineata a main (hosting 2c3ae38, service worker v46) con il fix del titolo [DEMO]; home, attività e accedi viste nel browser senza errori in console"
next: "Paolo: prova generale da loggato con i quattro ruoli sulla demo; poi seed col --today del giorno e registrazione"
verified: "11/11: suite client sul mini 1896/1896 (9 test nuovi del titolo scritti da un altro agente); index.html, sw.js e bundle con sha uguale alla build su demo.gugditalia.it e giovani-palo-staging.web.app; titolo [DEMO] su /, /activities e /login dopo reset di service worker e cache. Non provati: pagina di firma del genitore, percorsi da loggato dei quattro ruoli"
links: []
done_at:
---

Video di 3 minuti da dare ad altri pali, scaletta in docs/KIT_DEMO.md (Video di 3 minuti). Si registra solo su demo.gugditalia.it.

## Fatto quando

- demo.gugditalia.it serve main (fatto il 2026-11-11, hosting da 2c3ae38, service worker v46)
- prova generale da loggato sulla demo vera con i quattro ruoli, a 390 e desktop (la password la digita Paolo)
- seed riapplicato con --reset --apply e --today uguale al giorno della registrazione
- scaletta riletta: la home è quella nazionale con selettore del palo; la riga 0:15-0:40 è scritta prima di Crea attività a step
- video registrato

## Decisioni di Paolo

- citare nome e numeri del Palo di Roma Est nel titolo finale (domanda 4 del kit)
- sottotitoli solo in italiano o anche in inglese

## Trovato il 2026-11-11

- corretto in 7d86357: le pagine pubbliche nuove (PublicSiteLayout) e quelle del genitore sostituivano il titolo della scheda e sulla demo spariva il prefisso [DEMO]. In produzione il fix non cambia nulla ed esce col prossimo deploy hosting (service worker v46)
- la home pubblica dice «Iscriviti, anche senza account», ma le attività demo non ammettono l'iscrizione senza account
- con due attività future la home mostra quattro segnaposto «In arrivo»
