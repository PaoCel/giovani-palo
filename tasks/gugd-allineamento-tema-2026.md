---
id: gugd-allineamento-tema-2026
title: Allineare l'app al tema 2026 delle pagine pubbliche
status: in-progress
impact: 2
urgency: 2
effort: M
delivery: deploy
surface: [web]
source: paolo
opened: 2026-11-11
started_at: 2026-11-11
touched: 2026-11-11
due:
blocked_by: []
branch: task/gugd-allineamento-tema-2026
worktree: /Users/paolocelestini/Developer/giovani-palo/.claude/worktrees/gugd-allineamento-tema-2026
session: 12edb8fa-c95b-429f-8bda-fe3b3d8ba3df
stopped_at: "11/11: tavola con le tre direzioni su home e dettaglio a 375 px mostrata a Paolo"
next: "Dopo la scelta: applicare la direzione a dettaglio, iscrizione e pagine del genitore, poi alle aree con login, con foto prima e dopo sugli emulatori col seed demo"
verified: ""
links: []
done_at:
---

Home, catalogo e accedi (PR #10, tema 2026 «Cammina con me») piacciono a Paolo e restano il riferimento: non si toccano. Il resto dell'app parla un'altra lingua visiva (Fraunces e Manrope, blu #235d90, pill, card arrotondate) e il passaggio si vede al primo tap, dalla home al dettaglio attività. Paolo, 11 novembre: «Allineamento va bene ma va fatto con senso, perché mi piace. Deve essere tutto almeno graficamente perfetto per la demo, deve sembrare tutto così intuitivo».

## Fatto quando

- direzione scelta da Paolo sui mockup renderizzati (.claude/mockups/allineamento-tema-2026/)
- dettaglio attività, iscrizione e pagine del genitore nella stessa famiglia visiva di home, catalogo e accedi
- aree con login (giovani, famiglia, dirigente, admin) coerenti con la direzione scelta, viste a 320/390/430 e desktop
- nessun cambio a home, catalogo e accedi
- demo aggiornata; produzione solo con conferma di Paolo

## Misurato l'11 novembre sulla demo, a 375 px

- pubbliche nuove: Roboto, blu #005581, ambra #fcb448, pulsanti radius 4, card piatte, testata col solo nome
- dettaglio e app: Fraunces + Manrope, blu #235d90, pill, card con radius 20, testata con logo e pill Accedi

## Mockup dell'11 novembre

Tavola `.claude/mockups/allineamento-tema-2026/tavola.png` (fuori da git, con `tavola.html`, le foto in `img/` e `direzioni.css`): home e dettaglio attività a 375 px, fotografati sulla demo con il CSS delle tre direzioni iniettato sulla pagina vera.

- Direzione 1, tutto verso il tema 2026: home invariata; dettaglio e app con Roboto, blu e ambra del tema, angoli da 4 px, sezioni piatte.
- Direzione 2, tutto verso lo stile dell'app: dettaglio invariato; home, catalogo e accedi con Fraunces e Manrope, pill, card arrotondate.
- Direzione 3, ibrido: colori, font e testata del tema 2026 ovunque; forme morbide dell'app ovunque.

L'app è già a token (`tokens.css`, variabili di `base.css`): colori e font delle direzioni 1 e 3 si ottengono quasi solo cambiando variabili; le forme della direzione 1 chiedono regole per componente.

Trovato fotografando: sulla home nuova le card delle attività senza locandina mostrano un riquadro grigio vuoto, mentre il dettaglio ha l'illustrazione di ripiego.

## Scelta di Paolo, 11 novembre

**Direzione 3**: «i colori li prenderemo sempre dal tema dell'anno». Quindi il tema è uno strato che si cambia ogni anno, non una ricolorazione una tantum.

## Fatto

- `src/styles/yearTheme.css`: unica fonte di blu, ambra, inchiostro, grigi, font e logo (`--theme-*`). `tokens.css`, il `:root` di `base.css` e `.pub26` leggono da lì.
- Colori e font scritti a mano sostituiti con token in 17 file CSS (circa 235 righe). Fuori di proposito: Notte dei Record, certificato, illustrazioni SVG.
- Testata comune: fondo bianco, filo, striscia blu e ambra del tema, nome scritto come nella home («Attività» leggero, «GU GD» in grassetto) e senza logo da non entrati.
- Pagine pubbliche: pulsanti, scelta del palo e stati a pill, copertine col radius delle card.
- Home e catalogo: paesaggio di ripiego sulle attività senza locandina, al posto del riquadro grigio.
- Dettaglio pubblico: «Iscrizioni aperte» nel blu tenue del catalogo, «Accedi» pieno.
- Testo sopra l'ambra con `--on-sand` (sei punti usavano `--ink`, che col blu 2026 fa 4,495:1).
- `theme-color` e manifest sul blu del tema.
- Regola e procedura per l'anno nuovo in `docs/REDESIGN_BRIEF.md`, «Tema dell'anno».
