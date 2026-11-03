---
id: gugd-i18n
title: Versione inglese e spagnola
status: needs-paolo
impact: 2
urgency: 1
effort: L
delivery: deploy
surface: [web, functions]
source: paolo
opened: 2026-10-18
started_at:
touched: 2026-11-03
due:
blocked_by: ["decisione: lingua per account o per dispositivo", "decisione: chi traduce i testi legali e le email", "decisione: cosa resta solo in italiano"]
branch:
worktree:
session: 324c0270-ecd5-4491-ac05-a5580bd6c85f
stopped_at: ""
next: "Tre decisioni di Paolo, poi impostazione su componenti del restyling: lingua per account o per dispositivo; chi traduce testi legali (autorizzazione, consensi foto, privacy) ed email; cosa resta solo in italiano"
verified: ""
links: []
done_at:
---

## Contesto

Giovani in Italia che parlano solo inglese, alcuni solo spagnolo. Non urgente: prossima attività a dicembre o gennaio, ma va impostato ora. Oggi nessun catalogo: copy inline in ogni componente, index.html lang=it. Da decidere: lingua per account (profilo) o per dispositivo (browser), chi traduce i testi legali (autorizzazione genitore, consensi foto S1, privacy) e le email delle functions, cosa resta solo in italiano. Prima fase consigliata: estrarre le stringhe per schermata partendo da quelle che il flusso genitore riscrive comunque (fase 1, parole), con la chiave = stringa italiana (regola §9 dell'handbook).

Avviato dalla fase 1 del flusso genitore (2026-10-18): i testi toccati stanno
in `src/copy/<schermata>.ts`, un oggetto `as const` per schermata con le frasi
italiane come valori (saranno le chiavi del catalogo), i termini del glossario
in `src/copy/parole.ts` riusati per riferimento, le parti variabili come
segnaposto `{nome}` riempiti da `fillCopy`. Oggi ci sono `accedi.ts`,
`iscrizione.ts` e `famiglia.ts`; tutto il resto è ancora inline. Prima di
estendere la struttura alle altre schermate serve l'ok di Paolo.

## Fatto quando

- criteri di accettazione: cosa deve essere vero, osservabile, perché il task
  sia chiuso (e cosa resta fuori, se serve dirlo)

## Da fare

- passi concreti, nell'ordine in cui vanno fatti

## Verificato

Cosa è stato provato davvero e come (configurazione, account, data). Vuoto
finché non c'è niente di provato: "dedotto dal codice" si scrive così.
