---
id: gugd-i18n
title: Versione inglese e spagnola
status: ready
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
blocked_by: []
branch:
worktree:
session: 324c0270-ecd5-4491-ac05-a5580bd6c85f
stopped_at: ""
next: "Dopo le fondamenta di gugd-restyling: catalogo per schermata (chiave = frase italiana), selettore della lingua, poi traduzione di tutti i testi con un agente specializzato"
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

## Decisioni di Paolo, 3 novembre 2026

- **Lingua**: si parte da quella del dispositivo (browser), e l'utente può
  sempre scegliere la sua lingua preferita; la scelta vince sul dispositivo.
  Proposta tecnica da confermare nel lavoro: preferenza salvata nel profilo per
  chi ha un account e nel browser per gli ospiti.
- **Chi traduce**: tutti i testi, compresi quelli legali (autorizzazione del
  genitore, consensi foto, privacy) e le email delle Functions, li traduce un
  agente specializzato nelle traduzioni.
- **Cosa resta solo in italiano**: niente, si traduce tutto.
- **Ordine** (parere Codex, non contestato): dopo le fondamenta del restyling,
  così i componenti nascono già pronti per testi più lunghi.
