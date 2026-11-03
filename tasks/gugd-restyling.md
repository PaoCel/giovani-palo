---
id: gugd-restyling
title: "Restyling dell'app: fondamenta visive e pagine principali"
status: in-progress
impact: 2
urgency: 2
effort: L
delivery: deploy
surface: [web]
source: paolo
opened: 2026-11-03
started_at: 2026-11-03
touched: 2026-11-03
due:
blocked_by: []
branch: task/gugd-restyling
worktree: /Users/paolocelestini/Developer/giovani-palo/.claude/worktrees/elastic-lalande-32c93d
session: 3b312056-24e6-4dab-a4bf-78d70e42f776
stopped_at: "Fase 0 fatta: direzione A scelta da Paolo il 3/11; token in src/styles/tokens.css (importato prima di base.css, solo nomi nuovi) e componenti PageHeader, Card, Notice, EmptyState, Button/ButtonLink, Pill, Icon in src/components/ui/ con CSS .ui-* in src/styles/ui.css, non ancora usati da nessuna pagina; test tests/uiComponents.test.mjs (71, scritti da un altro agente); build sul mini verde."
next: "Fase 1: scheda attività giovane /me/activities/:id sui componenti nuovi (programma, alloggio, squadra, comitati), prima e dopo a 320/390/430/desktop; per vederla serve un account QA con iscrizione o emulatori con dati di prova sul mini. Barra admin a 5 voci decisa; testata e barra laterale admin ancora da decidere, servono solo alla fase 4."
verified: "Fase 0 (3/11): build sul mini verde, bundle JS principale invariato; suite sul mini 1637 test verdi, accentApostrophes (git, non gira nel mirror di un worktree) verde sull'Air; tests/uiComponents.test.mjs 71 verdi, scritto da un altro agente; vetrina dei componenti renderizzata con i CSS veri a 320/390/1440: nessuno scroll orizzontale, testo minimo 13 px, nessun controllo sotto 44. Componenti non ancora visti nel browser loggato (nessuna pagina li usa)."
links: [docs/REDESIGN_BRIEF.md, tasks/gugd-fondamenta-visive.md, tasks/gugd-etichette-home.md]
done_at:
---
## Contesto

Paolo, 2026-11-03: «vorrei che finissi tutto quanto così possiamo passare al
restyling dell'app». Secondo parere Codex (gpt-6-astra, stesso giorno) sull'ordine:
prima si chiudono i rischi sul già pubblicato (consenso, select, firma), poi le
fondamenta del restyling, e solo su quelle S3, S4 e le traduzioni, così le pagine
nuove nascono coerenti invece di essere rifatte subito dopo.

Assorbe `gugd-fondamenta-visive` (token completi e vocabolario di componenti,
adottati pagina per pagina, niente sostituzione globale) e la parte non ancora
fatta di `gugd-etichette-home` (home `/me` e scheda `/me/activities/:id`: tasti
da 42-43 px e chip da 10,6-12,8 px). La pagina di firma è stata sistemata il
2026-11-03 fuori da questo task.

Vincoli già scritti: `docs/REDESIGN_BRIEF.md` (stack, niente framework CSS né
dipendenze UI nuove, mobile-first, accessibilità) e il gusto visivo
dell'handbook (gerarchia chiara, pill compatte, radius 16-22, niente emoji,
illustrazioni proprie). Componenti pensati anche per testi più lunghi, perché
dopo arrivano inglese e spagnolo (`gugd-i18n`).

## Fatto quando

- token completi (colore, spaziatura, tipo, radius, z-index, target 44 px,
  testo secondario ≥ 13 px) e 4-5 componenti condivisi (Card, Notice,
  EmptyState con azione, PageHeader, pulsanti) in uso nelle pagine rifatte;
- pagine principali rifatte e scelte da Paolo sui mockup: home giovani, scheda
  attività, catalogo e dettaglio pubblico, testata admin;
- collaudo a 320/390/430 e desktop nel browser loggato, nessuno sbordo, nessun
  cambio visivo nelle pagine non toccate;
- deploy hosting con service worker incrementato.

## Da fare

- [x] brief aggiornato con lo stato reale delle pagine (3 novembre, browser
  loggato da dirigente e codice): `docs/REDESIGN_BRIEF.md`;
- [x] mockup HTML con i token del brief, due direzioni (A continuità con la
  home social, B carta e sabbia) per la scheda attività giovane e per la
  testata admin con Persone, PNG a 320, 390 e 1440 in
  `.claude/mockups/restyling/` del checkout principale (fuori da git), tavola
  `png/confronto-390.png`; inviati a Paolo il 3 novembre;
- [x] direzione scelta da Paolo il 3 novembre: **A** (continuità con la home
  social), scritta in `docs/REDESIGN_BRIEF.md`;
- [x] barra admin in basso a 5 voci con etichetta (Home, Attività, Persone,
  Calendario, Altro; Gallerie e Feed dentro Altro) al posto delle 7 a sola
  icona: scelta da Paolo il 3 novembre, si fa nella fase 4;
- [ ] scelte di Paolo ancora aperte, servono alla fase 4: testata senza la
  riga nome/ruolo (86 px), con il cambio vista nel menu dell'avatar; barra
  laterale admin a desktop;
- [x] fase 0: token in `src/styles/tokens.css` e i cinque componenti in
  `src/components/ui/` (più Pill e Icon), senza cambiare pagine;
- [ ] le pagine una alla volta nell'ordine del brief, un commit per pagina.

La freccia gigante nelle righe attività di `/unit` (`483d5dc` sul branch) è
in produzione dal 3 novembre: cherry-pick `a0d9dfe` su `main`, service worker
`gugd-shell-v38` (`8abd34f`). Al merge di `main` nel branch il cambio a
`base.css` è identico. Il prossimo deploy hosting porta il service worker a
v39.

## Verificato

Vuoto.
