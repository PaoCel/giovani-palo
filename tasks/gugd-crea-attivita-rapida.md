---
id: gugd-crea-attivita-rapida
title: "Crea attività: modalità rapida (bozza o annunciata)"
status: needs-paolo
impact: 2
urgency: 2
effort: L
delivery: deploy
surface: [web, rules]
source: paolo
opened: 2026-11-06
started_at: 2026-11-06
touched: 2026-11-11
due:
blocked_by: ["decisione: deploy in produzione (functions, poi hosting v48)"]
branch:
worktree:
session:
stopped_at: "11/11: in main (2da81f0..30b16a6) e sulla demo: staging con 39 functions ridistribuite e hosting da 30b16a6, service worker v48. Produzione ferma: serve la conferma di Paolo"
next: "Paolo: prova la rapida da loggato su demo.gugditalia.it e conferma il deploy in produzione (functions per nome: quelle di autorizzazione genitore, consenso e stanze; poi hosting v48). Dopo: tasks done, via il branch remoto task/gugd-crea-attivita-rapida. Finiture: gugd-rapida-finitura"
verified: "11/11 sul mini (copia QA, codice uguale a main 30b16a6 salvo docs e versione del service worker): tsc e build verdi; suite client 1983/1984 (il rosso chiede git, 55/55 sull'Air); functions unitari 779/779; rules invariate nell'emulatore: announced + unpublish 16/16, seed e isolamento fra pali 164 passati 0 falliti, stanze 48/48 e roomMates 19/19; collaudo Playwright col seed demo a 320/390/430/1440: rapida 0 KO, scheda admin 0 KO, pagine pubbliche 0 KO salvo tre controlli dello script superati dal ripiego locandina di main, visti a schermo. Test nuovi scritti da Grok. Review Grok sul codice finale: PASS WITH CONCERNS (residui in gugd-consenso-eta-fuso). Demo: sha di index.html, sw.js v48, bundle JS e CSS uguali alla build su demo.gugditalia.it e web.app, / e /activities senza errori in console. Mockup B approvati da Paolo il 6/11. Non provati: rapida da loggato sulla demo vera (password di Paolo), Safari iOS, tastiera vera, errore di rete nel foglio, produzione"
links: ["[docs/ATTIVITA_MODULARI.md#settimo-incremento-modalità-rapida-e-attività-annunciata-6-novembre]"]
done_at:
---

## Contesto

Spec «Settimo incremento» in docs/ATTIVITA_MODULARI.md (con «Ripresa e chiusura (11 novembre)»), mockup in .claude/mockups/crea-attivita-rapida/ (variante B, approvata da Paolo il 6 novembre). La sessione del 6/11 è morta prima del rilascio; ripreso e portato in main e sulla demo l'11/11.

## Fatto quando

- la rapida è in main e sulla demo, provata nel browser (fatto l'11/11: emulatori col seed demo; sulla demo vera solo le pagine anonime)
- in produzione, con la conferma di Paolo (da fare)

## Cosa c'è

- Foglio rapido «Nuova attività» dai quattro ingressi admin (elenco, calendario con «Aggiungi in <mese>», home admin, impostazioni): nome, tipo, giorno, ora e luogo facoltativi; giro con «Aggiungine un'altra», Correggi, Elimina e Rimetti; foglio d'uscita; «Aggiungi i dettagli adesso».
- Stato annunciata (planned + isPublic + isVisible), rules invariate; announceEvent, publishEvent da planned, Riapri verso lo stato di prima, deleteAnnouncedEvent e restoreAnnouncedEvent.
- Scheda admin con «Da completare per aprire le iscrizioni» e «Completa i dettagli»; passi che tengono l'annunciata; «Apri le iscrizioni» al passo 6.
- Superfici pubbliche: home e catalogo nuovi, scheda, /register, /me, unità, con «Iscrizioni a breve», «Luogo da definire» e niente «00:00» o «23:59».
- Functions: date ed età sul giorno italiano (email, PDF di audit, modulo ufficiale, piano stanze).

## Cosa manca rispetto alla spec

Rilievi minori, nel task gugd-rapida-finitura: annunciata con la data passata che allo staff resta «Annunciata», Riapri che onora solo planned, titolo del foglio d'uscita in «Correggi», avviso dei passi che scorre via, copy del riepilogo del passo 6, luogo mancante nei PDF, giorno precompilato da «Aggiungi in <mese>» (scelta di Paolo).

## Scelte fatte l'11/11, da confermare con Paolo

- In home la pill di stato compare solo su annunciate («Iscrizioni a breve») e annullate («Annullata»): le altre card restano senza pill, come nel disegno della home.
- Senza locandina resta il paesaggio disegnato di main; non c'è una resa diversa per l'annunciata.
- Email e moduli firmati scrivono ora di conferma e scadenza del link in ora italiana (prima UTC).

## Verificato

Vedi `verified` e docs/ATTIVITA_MODULARI.md, «Ripresa e chiusura (11 novembre)». Script di collaudo in .claude/qa-rapida/ (fuori da git).
