---
id: gugd-consenso-eta-fuso
title: "Consenso e maggiore età: data vuota e giorno italiano"
status: backlog
impact: 3
urgency: 2
effort: S
delivery: deploy
surface: [functions]
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

Trovato dalla review indipendente dell'11 novembre 2026 sul task gugd-crea-attivita-rapida, in codice non toccato da quel task. Dati di minori: prima di cambiare, decide Paolo.

1. functions/lib/officialConsentPdf.js, isMinorBirthDate: fa Number(calculateAge(...)) e l'età vuota («», quando la nascita manca o non è leggibile) diventa 0, cioè minorenne: sul modulo ufficiale la casella dell'età resta vuota e la firma va sul rigo del minore. Rules (commento a firestore.rules 501-503) e client (src/utils/age.ts) fanno l'opposto: data vuota o non YYYY-MM-DD vuol dire maggiorenne e l'autorizzazione non si chiede. Chiamanti: parentAuthorization.js (firma, rigenerazione, backfill dei PDF legacy). Da decidere: età vuota = non minorenne come il client, oppure il PDF non si firma finché l'età non è un numero.
2. functions/lib/adultAge.js, isAdultByAge: il giorno di «adesso» è quello UTC. Fra le 00:00 e le 02:00 italiane del diciottesimo compleanno (fino alle 01:00 d'inverno) la persona risulta ancora minorenne in parentAuthorizationStillNeeded, recordNight.js e campManagement.js, mentre il modulo ufficiale e il piano stanze dall'11 novembre contano sul giorno italiano. Correzione: giorno Europe/Rome, come italyDayParts in officialConsentPdf.js e referenceDay in roomPlannerCore.mjs.
3. La guardia dateFormattersMissingTimeZone in functions/tests/italyTimeZone.test.mjs legge solo i .js di functions/lib e index.js: non vede i .mjs né i getUTC* usati come giorno di calendario.
4. Pagina di firma del genitore (src/pages/public/parentPageShared.tsx, formatDateRange): usa il fuso del dispositivo, l'email Europe/Rome. In Italia coincidono.

Test da scrivere (altro agente): isMinorBirthDate con nascita vuota, invalida e ISO completo; isAdultByAge alle 00:30 italiane del compleanno, estate e inverno.

## Fatto quando

- criteri di accettazione: cosa deve essere vero, osservabile, perché il task
  sia chiuso (e cosa resta fuori, se serve dirlo)

## Da fare

- passi concreti, nell'ordine in cui vanno fatti

## Verificato

Cosa è stato provato davvero e come (configurazione, account, data). Vuoto
finché non c'è niente di provato: "dedotto dal codice" si scrive così.
