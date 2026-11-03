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
stopped_at: "Brief riscritto con lo stato reale delle pagine (3/11), token mancanti e 5 componenti; mockup A/B di scheda attività giovane e testata admin con Persone in .claude/mockups/restyling/ del checkout principale, inviati a Paolo. Freccia gigante di /unit corretta sul branch (483d5dc), non ancora in produzione."
next: "Aspettare la scelta di Paolo (direzione A o B, barra admin a 5 voci, testata senza riga nome/ruolo); poi fase 0: src/styles/tokens.css e i 5 componenti in src/components/ui/ senza cambiare pagine, build e test sul mini"
verified: ""
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
- [ ] scelte di Paolo: direzione A o B; barra admin in basso a 5 voci con
  etichetta (Home, Attività, Persone, Calendario, Altro; Gallerie e Feed dentro
  Altro) al posto delle 7 a sola icona; testata senza la riga nome/ruolo (86
  px), con il cambio vista nel menu dell'avatar; barra laterale admin a desktop;
- [ ] fase 0: token in `src/styles/tokens.css` e i cinque componenti, senza
  cambiare pagine;
- [ ] le pagine una alla volta nell'ordine del brief, un commit per pagina.

Sul branch c'è già `483d5dc` (freccia gigante nelle righe attività di `/unit`,
in produzione da prima): si può portare su `main` da sola con un cherry-pick e
uscire col prossimo deploy hosting.

## Verificato

Vuoto.
