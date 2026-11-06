---
id: gugd-crea-attivita
title: "Crea attività: flusso a step, senza ripetizioni"
status: in-progress
impact: 2
urgency: 2
effort: L
delivery: deploy
surface: [web]
source: paolo
opened: 2026-11-05
started_at: 2026-11-05
touched: 2026-11-06
due:
blocked_by: []
branch: task/gugd-crea-attivita
worktree: .claude/worktrees/gugd-crea-attivita-56e185
session:
stopped_at: "6/11: in produzione (hosting da copia pulita di 98c8202 sul mini, service worker v45, index-Cq5eqzxb.js uguale su gugditalia.it e web.app); con il deploy è uscito anche cfb180e (tasto Fallback legacy solo se serve)"
next: "Paolo: prova nel browser loggato in produzione e su iPhone (Safari) la creazione con locandina; decidere se Consenso foto e video parte acceso sui tipi rafforzati come nel mockup"
verified: "5/11: test puri del foglio 55/55 (altro agente); suite client sul mini 1872/1882, unico rosso il test git non eseguibile nella copia del mini e verde sull'Air; tsc e build verdi; rules Togli dal catalogo 8/8 sull'emulatore; collaudo Playwright su emulatori col seed demo a 320/390/430/1440 (flusso, uscite, indice, cambio tipo, Togli dal catalogo con 17 iscritti e catalogo anonimo, ingresso Alloggio), 3 difetti trovati e corretti, ricontrollati a mano a 320 e 390; review indipendente PASS WITH CONCERNS, 8 rilievi corretti; censimento prod requireLoginForEdit: 6/6 accese. Non provati: Safari iOS, produzione, conflitto di revisione nel browser."
links: []
done_at:
---

## Contesto

Paolo, 5 novembre 2026, creando il «Gran galà di gennaio»: caricata la
locandina non riusciva ad arrivare a salvare, «mi portava sempre su in alto».
Poi: la parte di crea attività va rifatta a fondo, più snella e intuitiva, a
step veri che chiedono ogni cosa chiaramente e senza ripetizioni.

Oggi: «Dati essenziali» (nome, tipo, date, luogo + dettagli facoltativi) →
riepilogo bozza → «Locandina e altre opzioni» (editor vecchio con stepper
interno Dettagli/Date/Locandina che richiede di nuovo titolo, date, luogo,
descrizione, destinatari) → «Modulo d'iscrizione» → «Controlla e pubblica».

## Fatto quando

- flusso nuovo a step scelto da Paolo sui mockup, ogni dato chiesto una volta;
- bozza salvata a ogni passo, ritrovabile, pubblicazione esplicita (spec
  docs/ATTIVITA_MODULARI.md, primo incremento) e ingressi esistenti conservati;
- locandina caricabile e salvabile su telefono (Safari iOS compreso);
- collaudo a 320/390/430/1440 su emulatori e nel browser loggato, review
  indipendente, deploy hosting con service worker incrementato.

## Da fare

- [x] salto in alto riprodotto a 375 su Chrome e corretto: scroll anchoring
  del corpo del modale dopo il caricamento (`overflow-anchor: none`);
  tolto il campo che mostrava l'URL dello Storage
- [ ] confermare con Paolo il dispositivo (Safari iOS non ha scroll anchoring)
- [x] mappa campi e ripetizioni (titolo, tipo, date, luogo, descrizione,
  destinatari, finestra iscrizioni, programma, cosa portare chiesti due volte;
  account ospite chiesto sia nelle opzioni sia nel modulo)
- [x] stati e ritorni del flusso nuovo (docs/ATTIVITA_MODULARI.md, Sesto incremento)
- [x] mockup v2 del flusso nuovo, review UX di un altro agente recepita
- [x] mockup v2 approvato e 4 decisioni prese (5/11)
- [x] contratto «Togli dal catalogo» (rules invariate, 8/8 emulatore) e censimento requireLoginForEdit (6/6 accese)
- [x] costruzione, test, collaudo, review (5/11)
- [x] merge su main e deploy hosting con service worker v45 (6/11, conferma di Paolo; build del v44 = bundle live prima del deploy)
- [ ] prova nel browser loggato in produzione e su iPhone (Safari) con locandina
- [ ] decidere: «Consenso foto e video» acceso di default sui tipi rafforzati (mockup) o spento (oggi)
