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
branch:
worktree:
session:
stopped_at: "5/11: mockup v2 del flusso a 6 step pronto (.claude/mockups/crea-attivita/png/board-1400.png), stati e ritorni nella spec, review UX recepita"
next: Paolo sceglie sui mockup e risponde alle 4 decisioni aperte in docs/ATTIVITA_MODULARI.md (Sesto incremento); poi costruzione su branch task/gugd-crea-attivita
verified: "Fix (5/11): emulatori sul mini con il seed demo, admin a 375: prima del fix dopo un caricamento della locandina lo scroll del modale si fermava a 1409 su 1719 e Salva modifiche restava fuori schermo; con overflow-anchor none sul corpo del modale scroll reale fino a 1719, clic su Salva, Modifiche salvate, console pulita; campo URL assente, nessun label annidato. Suite client sul mini 1827/1827, build verde. Non provati: Safari iOS (WebKit non fa scroll anchoring: se Paolo era su iPhone la causa può essere un'altra), produzione."
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
- [ ] scelta di Paolo e 4 decisioni aperte
- [ ] costruzione, test, collaudo, deploy
