---
id: gugd-crea-attivita-rapida
title: "Crea attività: modalità rapida (bozza o annunciata)"
status: in-progress
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
blocked_by: []
branch:
worktree:
session: 0220df00-d49f-47b4-9dfc-265bfa86f9e6
stopped_at: "11/11: in main con squash (rapida, annunciata, giorno italiano nelle functions, service worker v48). Prossimo: staging"
next: "Deploy sullo staging (functions, poi hosting) e verifica di demo.gugditalia.it; produzione solo con conferma di Paolo"
verified: "11/11 sul mini, copia QA ~/qa/gugd-rapida, sul branch prima del secondo merge di main: tsc e build verdi; suite client 1960/1961 (il rosso chiede git, 55/55 sull'Air); functions unitari 776/776; rules invariate nell'emulatore: announced + unpublish 16/16, seed e isolamento fra pali 164/164; collaudo Playwright col seed demo a 320/390/430/1440: rapida e scheda admin 0 KO, pagine pubbliche 0 KO (181 + 21 controlli per larghezza). Test nuovi scritti da Grok (publicCatalog, italyTimeZone, roomPlannerCore), rossi 5 su 8 contro il codice di prima. Mockup B approvati da Paolo il 6/11 («Approvo, vai», sessione daadcc0a). NON fatto: seconda review letta, test stanze nell'emulatore letti, merge in main, deploy staging, verifica demo. Non provati: Safari iOS, tastiera vera, errore di rete nel foglio, produzione"
links: ["[docs/ATTIVITA_MODULARI.md#settimo-incremento-modalità-rapida-e-attività-annunciata-6-novembre]"]
done_at:
---

## Contesto

Spec «Settimo incremento» in docs/ATTIVITA_MODULARI.md, mockup in .claude/mockups/crea-attivita-rapida/, poi codice dopo la scelta di Paolo tra A e B.

## Fatto quando

- criteri di accettazione: cosa deve essere vero, osservabile, perché il task
  sia chiuso (e cosa resta fuori, se serve dirlo)

## Da fare

- passi concreti, nell'ordine in cui vanno fatti

## Verificato

Cosa è stato provato davvero e come (configurazione, account, data). Vuoto
finché non c'è niente di provato: "dedotto dal codice" si scrive così.
