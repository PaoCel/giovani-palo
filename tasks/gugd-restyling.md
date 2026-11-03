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
stopped_at: "Fase 1 fatta (3/11): scheda /me/activities/:id sui componenti di src/components/ui/ (testata con foto e pill, avviso dell'autorizzazione del genitore con le frasi di Iscrizione inviata, La tua stanza con l'alloggio in colonna a destra da 980 px, schede a pill da 44, gruppo e comitati in Card, vuoti con illustrazione); CSS in src/styles/myActivity.css; tolte 734 righe di CSS della vecchia scheda (base, galleria, Notte dei record); test browser dei comitati passato da classi CSS a ruoli. Codice nei checkpoint 80963fb, 8f549a9, aaf052f, 9ea796c, cd0a2d8: allo squash in main diventano il commit della pagina."
next: "Fase 3: catalogo e dettaglio pubblico (brief, «Scope, in ordine»). Prima: screenshot a 390 e desktop delle pagine come sono oggi, poi mockup o proposta da far scegliere a Paolo. Collaudo riusabile: .claude/qa-restyling-scheda/ del checkout principale (dopo.sh <tag>, ora con la foto della home /me per ogni scenario; prima di un giro con functions nuove, rsync di functions/ in ~/qa/gugd-restyling-scheda/app/ sul mini, dopo.sh porta solo src/)."
verified: "Fase 0 (3/11): build sul mini verde, bundle JS principale invariato; suite sul mini 1637 test verdi, accentApostrophes (git, non gira nel mirror di un worktree) verde sull'Air; tests/uiComponents.test.mjs 71 verdi, scritto da un altro agente; vetrina dei componenti a 320/390/1440 senza sbordi, testo minimo 13 px, nessun controllo sotto 44. Fase 1 (3/11): tipi, hook e handler della pagina identici a prima (diff vuoto su 382 righe); build sul mini verde; suite sul mini 1637 verdi, accentApostrophes 55/55 sull'Air; collaudo su emulatori sul mini con seed sintetico, 4 scenari (viaggio completo, campeggio, testi lunghi, bozza senza programma) a 320/390/430/1440, 60 foto per giro: prima 7-43 testi sotto 13 px e 2-5 controlli sotto 44 per foto, sbordo a 320 nel campeggio e a ogni larghezza coi testi lunghi (nascosto dalla cornice con overflow hidden); dopo 0 sbordi, 0 testi sotto 13 px, 0 controlli sotto 44 salvo la casella Invia in forma anonima delle Domande (13 px, dentro un'etichetta cliccabile alta 66), 0 errori in console. Review indipendente di un altro agente: PASS WITH CONCERNS, corretti cornice dei figli, anello di focus delle schede, ARIA delle schede, righe della checklist e tasti piccoli delle Domande, chiave React. Non provati: browser loggato in produzione (nessun account con iscrizione), Safari iOS, campCommitteesFreeBrowser con i selettori nuovi (servono emulatori con functions), card Notte dei record. Compagni nella card stanza (3/11, dopo il merge di main con roomMates): build sul mini verde (tsc compreso), suite 1648/1649 (unico rosso accentApostrophes, senza git nello specchio; 55/55 sull'Air); collaudo su emulatori con le functions, piano stanze pubblicato nel seed: 60 foto a 320/390/430/1440, 0 problemi, A mostra «Camera 3, secondo piano · 4 posti letto» e «Con Sofia Conti e Anna Neri (dirigente)», D (bozza) solo il nome della stanza. Non provati: errore della callable a schermo, account anonimo con stanza. Fase 2 (3/11): in homeSocial.css nessun colore esadecimale tranne il bianco, 7 token nuovi in tokens.css; build sul mini verde, suite 1648/1649 (solo accentApostrophes nello specchio, 55/55 sull'Air); collaudo su emulatori con due post nel feed, home di 4 scenari a 320/390/430/1440: prima 1-4 testi sotto 13 px e 1 controllo sotto 44 (Apri checklist, 41,5), dopo 0 e 0, nessuno sbordo; pagina 2-32 px più alta, a 1440 0,6% di pixel diversi. Review indipendente (altro agente): PASS WITH CONCERNS, corretto il radius dello skeleton; ombra della card prossima attività lasciata sul token --shadow-float (più grigia di prima, scelta voluta). Home /unit e /admin: cambiano solo sfumature del feed, non provate a schermo."
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
- [x] testata senza la riga nome/ruolo (86 px), con il cambio vista nel menu
  dell'avatar: scelta da Paolo il 3 novembre, si fa nella fase 4;
- [x] barra laterale admin a desktop al posto della barra in alto: scelta da
  Paolo il 3 novembre, si fa nella fase 4;
- [x] fase 0: token in `src/styles/tokens.css` e i cinque componenti in
  `src/components/ui/` (più Pill e Icon), senza cambiare pagine;
- [ ] le pagine una alla volta nell'ordine del brief, un commit per pagina.
  - [x] fase 1: scheda attività giovane `/me/activities/:id` (3 novembre);
    foto prima e dopo e tavole affiancate in `.claude/qa-restyling-scheda/`
    del checkout principale (`prima/`, `dopo3/`, `confronti/`).
  - [x] fase 2: home giovani `/me` sui token (3 novembre), `1af3ca1`; foto
    in `prima-home/`, `dopo-home/` e `confronti-home/` dello stesso posto.
    Resta fuori il tasto «Invia» del lightbox (39 px, `MediaLightbox` è un
    portale fuori dalla home): va con il componente, in una fase successiva.

### Fase 1: scarti dal mockup, decisi

Paolo, 3 novembre: i quattro scarti qui sotto restano come sono (programma
sopra le schede, comitato senza azione, a destra solo genitore e stanza,
avviso del genitore tenuto).

- **Compagni di stanza: chiuso il 3 novembre.** Paolo li ha voluti
  (task `gugd-compagni-stanza`, callable `roomMates` in produzione). La card
  «La tua stanza» (`src/pages/me/MyRoomCard.tsx`) mostra subito il nome
  scritto sull'iscrizione, poi stanza e posti letto e «Con …» dalla
  callable, con gli stessi testi di Famiglia (`src/copy/stanza.ts`); account
  anonimi non chiamano, errore con la frase di Famiglia.
- **Programma come scheda.** Nel mockup «Programma» è la prima scheda. Resta
  sopra le schede, come prima: senza momenti pubblicati il componente non
  disegna nulla e la scheda sarebbe vuota.
- **«Scegli un comitato».** Il giovane non sceglie il comitato, lo assegna lo
  staff: lo stato vuoto tiene il testo di prima e nessuna azione.
- **Riepiloghi di gruppo e comitato nella colonna a destra.** Restano nelle
  loro schede; a destra vanno solo l'avviso del genitore e la stanza.
- **Avviso del genitore.** È nuovo in questa pagina (stava nel mockup):
  stesse frasi e stessa regola di «Iscrizione inviata»
  (`getParentEmailOutcome`), «Modifica» quando la mail non è partita. Provato
  a schermo solo nel caso «mail partita».

La freccia gigante nelle righe attività di `/unit` (`483d5dc` sul branch) è
in produzione dal 3 novembre: cherry-pick `a0d9dfe` su `main`, service worker
`gugd-shell-v38` (`8abd34f`). Al merge di `main` nel branch il cambio a
`base.css` è identico. Il prossimo deploy hosting porta il service worker a
v39.

## Verificato

Vuoto.
