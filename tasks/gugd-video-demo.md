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
blocked_by: ["prova generale da loggato sulla demo (la password la digita Paolo)"]
branch:
worktree:
session:
stopped_at: "11/11 sera: demo a main 30b16a6 (service worker v48, functions ridistribuite) con la modalità rapida; riga 0:15-0:40 della scaletta riscritta: creare un'attività con la rapida sta nei 25 secondi a stima (tre gesti, 10-15 s), da cronometrare"
next: "Paolo: prova generale da loggato con i quattro ruoli sulla demo, compresa «Nuova attività» in rapida col cronometro; poi seed col --reset --apply e --today del giorno (porta anche le tre annunciate) e registrazione"
verified: "11/11 sera: index.html, sw.js (v48), bundle JS e CSS con sha uguale alla build su demo.gugditalia.it e giovani-palo-staging.web.app; nel bundle ci sono le stringhe della rapida; / e /activities aperte nel browser dopo reset di service worker e cache, titolo [DEMO], nessun errore in console. La rapida è stata collaudata sugli emulatori col seed demo a 320/390/430/1440, non sulla demo vera da loggato (la password la digita Paolo). Non provati: pagina di firma del genitore, percorsi da loggato dei quattro ruoli"
links: []
done_at:
---

Video di 3 minuti da dare ad altri pali, scaletta in docs/KIT_DEMO.md (Video di 3 minuti). Si registra solo su demo.gugditalia.it.

Dall'11/11 c'è anche la versione promozionale per i pali (90 s in 16:9 e teaser verticale di 30 s), in docs/VIDEO_PROMO_PALI.md: stesse riprese, montaggio diverso.

## Fatto quando

- demo.gugditalia.it serve main (fatto il 2026-11-11, hosting da 2c3ae38, service worker v46)
- prova generale da loggato sulla demo vera con i quattro ruoli, a 390 e desktop (la password la digita Paolo)
- seed riapplicato con --reset --apply e --today uguale al giorno della registrazione
- scaletta riletta: la home è quella nazionale con selettore del palo; la riga 0:15-0:40 ora usa la modalità rapida (fatto l'11/11, da cronometrare nella prova generale)
- video registrato (giro guidato e versione promozionale)

## Decisioni di Paolo

Prese l'11/11, dettaglio in docs/VIDEO_PROMO_PALI.md:
- nome e numeri del Palo di Roma Est: sì (riletti l'11/11: 326 iscrizioni, 116 autorizzazioni firmate online)
- contatto finale: Paolo Celestini, nessuna frase personale
- solo testo, nessuna voce; musica bassa consigliata, da confermare
- sottotitoli in italiano, più una versione in inglese con gli stessi tempi (interfaccia ancora in italiano)

## Trovato il 2026-11-11

- corretto in 7d86357: le pagine pubbliche nuove (PublicSiteLayout) e quelle del genitore sostituivano il titolo della scheda e sulla demo spariva il prefisso [DEMO]. In produzione il fix non cambia nulla ed esce col prossimo deploy hosting (service worker v46)
- la home pubblica dice «Iscriviti, anche senza account», ma le attività demo non ammettono l'iscrizione senza account
- con due attività future la home mostra quattro segnaposto «In arrivo»
- corretto in `e23d09f` (task gugd-allineamento-tema-2026): le card della home senza locandina mostravano un riquadro grigio vuoto; ora c'è il paesaggio disegnato del dettaglio. Tutta l'app ha colori e font del tema dell'anno, sulla demo e in produzione dall'11/11 (service worker v47)
