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
touched: 2026-11-05
due:
blocked_by: []
branch: task/gugd-crea-attivita
worktree: .claude/worktrees/gugd-crea-attivita-56e185
session:
stopped_at: "5/11 sera: foglio a 6 step su task/gugd-crea-attivita (8ed1168), collaudo e review fatti; merge e deploy in attesa della conferma di Paolo"
next: "Conferma di Paolo per merge su main e deploy hosting (service worker v45, porta anche 89722b7); poi prova su iPhone (Safari) e in produzione col browser loggato"
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
- [ ] merge su main e deploy hosting con service worker v45, dopo conferma di Paolo
- [ ] decidere: «Consenso foto e video» acceso di default sui tipi rafforzati (mockup) o spento (oggi)
