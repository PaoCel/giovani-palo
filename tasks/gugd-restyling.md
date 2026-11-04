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
touched: 2026-11-04
due:
blocked_by: []
branch: task/gugd-restyling
worktree: /Users/paolocelestini/Developer/giovani-palo/.claude/worktrees/elastic-lalande-32c93d
session: 3b312056-24e6-4dab-a4bf-78d70e42f776
stopped_at: "Fase 3 fatta (4/11), sul branch e non in produzione: catalogo /activities e dettaglio /activities/:id sulle 5 scelte di Paolo; card PublicActivityCard anche in /me/activities; pill di stato da src/utils/publicEventState.ts (stessa regola del tasto); sondaggio solo ad attività finita e solo se aperto a tutti; EventCard tolto, 583 righe di CSS morto tolte da base.css."
next: "Deploy fase 3 su conferma fresca di Paolo: merge del branch in main, build e suite sul mini, hosting con service worker v41. Poi fase 4 (testata comune e navigazione admin, scelte già prese nel brief). Collaudo riusabile delle pagine pubbliche: .claude/qa-restyling-catalogo/ del checkout principale (run-public.sh <tag> sul mini dopo rsync di src/ in ~/qa/gugd-restyling-scheda/app/src/ e degli script in ~/qa/gugd-restyling-catalogo/; con zsh scrivere ${H}:qa, mai $H:qa)."
verified: "Fase 0 (3/11): build sul mini verde, bundle JS principale invariato; suite sul mini 1637 test verdi, accentApostrophes (git, non gira nel mirror di un worktree) verde sull'Air; tests/uiComponents.test.mjs 71 verdi, scritto da un altro agente; vetrina dei componenti a 320/390/1440 senza sbordi, testo minimo 13 px, nessun controllo sotto 44. Fase 1 (3/11): tipi, hook e handler della pagina identici a prima (diff vuoto su 382 righe); build sul mini verde; suite sul mini 1637 verdi, accentApostrophes 55/55 sull'Air; collaudo su emulatori sul mini con seed sintetico, 4 scenari (viaggio completo, campeggio, testi lunghi, bozza senza programma) a 320/390/430/1440, 60 foto per giro: prima 7-43 testi sotto 13 px e 2-5 controlli sotto 44 per foto, sbordo a 320 nel campeggio e a ogni larghezza coi testi lunghi (nascosto dalla cornice con overflow hidden); dopo 0 sbordi, 0 testi sotto 13 px, 0 controlli sotto 44 salvo la casella Invia in forma anonima delle Domande (13 px, dentro un'etichetta cliccabile alta 66), 0 errori in console. Review indipendente di un altro agente: PASS WITH CONCERNS, corretti cornice dei figli, anello di focus delle schede, ARIA delle schede, righe della checklist e tasti piccoli delle Domande, chiave React. Non provati: browser loggato in produzione (nessun account con iscrizione), Safari iOS, campCommitteesFreeBrowser con i selettori nuovi (servono emulatori con functions), card Notte dei record. Compagni nella card stanza (3/11, dopo il merge di main con roomMates): build sul mini verde (tsc compreso), suite 1648/1649 (unico rosso accentApostrophes, senza git nello specchio; 55/55 sull'Air); collaudo su emulatori con le functions, piano stanze pubblicato nel seed: 60 foto a 320/390/430/1440, 0 problemi, A mostra «Camera 3, secondo piano · 4 posti letto» e «Con Sofia Conti e Anna Neri (dirigente)», D (bozza) solo il nome della stanza. Non provati: errore della callable a schermo, account anonimo con stanza. Fase 2 (3/11): in homeSocial.css nessun colore esadecimale tranne il bianco, 7 token nuovi in tokens.css; build sul mini verde, suite 1648/1649 (solo accentApostrophes nello specchio, 55/55 sull'Air); collaudo su emulatori con due post nel feed, home di 4 scenari a 320/390/430/1440: prima 1-4 testi sotto 13 px e 1 controllo sotto 44 (Apri checklist, 41,5), dopo 0 e 0, nessuno sbordo; pagina 2-32 px più alta, a 1440 0,6% di pixel diversi. Review indipendente (altro agente): PASS WITH CONCERNS, corretto il radius dello skeleton; ombra della card prossima attività lasciata sul token --shadow-float (più grigia di prima, scelta voluta). Home /unit e /admin: cambiano solo sfumature del feed, non provate a schermo. Deploy fasi 0-2 (4/11): build e suite su main sul mini verdi (1658/1658); bundle e service worker v40 uguali su gugditalia.it e web.app, token nuovi nel CSS servito; /unit nel browser loggato a 390: feed con 2 post, nessuno sbordo, nessun testo sotto 13 px, console pulita. La home /me in produzione non l'ho vista loggato da giovane. Fase 3 (4/11): prima, produzione senza login a 320-1440 (16 foto): 24 testi sotto 13 px e 5-9 controlli sotto 44 per foto tra le passate, 3 attività finite su 5 con «Iscrizioni aperte». Dopo, emulatori sul mini con seed di attività in ogni stato (aperta con chiusura fra 3 giorni, apre a gennaio, chiusa, annullata, finita con e senza sondaggio) e tre pali per i vuoti, 17 viste a 320/390/430/1440 più /me/activities e dettaglio da giovane loggata: 68 foto, 0 sbordi, 0 testi sotto 13 px, 0 controlli sotto 44, 0 errori in console, attese sul testo tutte rispettate. tests/publicEventState.test.mjs 16 verdi, scritto da un altro agente; suite sul mini 1664 verdi, unico rosso accentApostrophes (senza git nello specchio, 55/55 sull'Air); build verde, bundle d'ingresso 139,96 kB gzip. Review indipendente: PASS WITH CONCERNS, corretti ordine del CSS rispetto a .page, sondaggio senza pagina, Annullata per gli iscritti, doppia azione su telefono, vuoto di Passate, iscrizione su attività finita, a capo dei tasti; lasciato Condividi solo icona senza conferma visibile (come nella scheda giovane). Non provati: browser loggato in produzione, Safari iOS."
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
  - [x] fase 3: catalogo `/activities` e dettaglio `/activities/:id`
    (4 novembre), scelte di Paolo: tutte e 5 le proposte del mockup
    (`.claude/mockups/restyling/catalogo-dettaglio.html`). Foto in
    `.claude/qa-restyling-catalogo/` del checkout principale (`prima/`,
    `dopo/`, tavola `confronto-390.png`).

### Fase 3: cosa c'è oggi e scelte aperte

Misure del 4 novembre su gugditalia.it, senza login. Catalogo: nessuna
attività in programma, quindi chi apre `/activities` vede solo «Nessuna
attività disponibile con questi filtri.» e niente da fare; etichette dei
filtri a 11,5 px. Tra le passate: 24 testi sotto 13 px per foto (pill
9,6 px, luogo 10,9), «Iscriviti» alto 33,6 px e presente anche sulle
attività finite, pill verde «Iscrizioni aperte» illeggibile sopra la foto,
tre attività concluse su cinque dicono «Iscrizioni aperte» (la pill legge
`event.status`), nessuna data sulla card. Dettaglio: hero scuro con pill a
12,8 px, «Iscrizioni aperte» nella pill e «Iscrizioni non disponibili» nel
tasto, sondaggio post-evento mostrato anche prima dell'attività, emoji
«⚠️ Consigliato leggere» in Cosa portare, «Luogo» ripetuto tra hero e
Informazioni principali. Nessuno sbordo, console pulita.

Proposta nel mockup, **scelta da Paolo il 4 novembre: tutte e 5**:

1. **Card del catalogo tutta cliccabile, senza «Iscriviti»**: foto 16:9,
   pill di stato vero (aperte, «Iscrizioni dal 10 gen», chiuse, conclusa,
   annullata), titolo, data, luogo, «Le iscrizioni chiudono tra 3 giorni».
   Una colonna su telefono, tre a desktop. Alternativa: «Iscriviti» solo
   sulle card con iscrizioni aperte (la card allora non è più un link unico).
2. **Periodo come tre pulsanti** (In programma, Passate, Tutte) sopra i tre
   menu Palo, Organizzazione, Iscrizioni. Alternativa: quattro menu come oggi.
3. **Catalogo vuoto** con illustrazione e «Mostra le attività passate» (o
   «Togli i filtri» se il vuoto viene dai filtri).
4. **Dettaglio come la scheda giovane**: foto sopra (a fianco da 980 px),
   pill, titolo, date e luogo, descrizione, Iscriviti e Condividi; a destra
   da 980 px la card «Iscrizione» (chiusura, apertura, serve un account,
   dati richiesti, link privacy) che sostituisce «Informazioni principali» e
   «Prima di compilare». Barra in basso solo su telefono. Notte dei record
   e Foto e video restano componenti loro.
5. **Sondaggio solo ad attività finita**, come azione principale al posto di
   Iscriviti. Oggi compare sempre.

Correzione che va comunque con la fase (non è una scelta): la pill di stato
di catalogo e dettaglio usa la stessa regola del tasto
(`getRegistrationAvailability`), più «Conclusa» dopo la data di fine.

Scarti dal mockup, decisi in implementazione:

- **Sondaggio solo se esiste per tutti.** `getSurveyHref` porta a
  `/sondaggio/:slug` solo per i sondaggi in `src/utils/surveyLinks.ts`; per
  le altre attività manda all'area del campeggio, che chiede l'accesso. Ad
  attività finita senza sondaggio pubblico non c'è azione né barra in basso.
- **Su telefono una sola azione.** Il mockup aveva Iscriviti nella testata e
  nella barra: sotto i 980 px restano solo nella barra (come la pagina di
  prima sotto i 720), a desktop nella testata e nella colonna «Iscrizione».
- **Foto e video e Notte dei record nella colonna principale**, non a
  destra: sono componenti loro, larghi, non rifatti.
- **/me/activities usa la stessa card**: era la variante poster di
  `EventCard`, tolta. Chi è iscritto vede lo stato dell'iscrizione al posto
  di quello dell'attività, salvo «Annullata»; lo staff vede «Bozza».

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
`base.css` è identico.

Fasi 0, 1 e 2 **in produzione dal 4 novembre**: fast-forward del branch su
`main`, solo hosting da una copia isolata di `ce41257`, service worker
`gugd-shell-v40`, bundle `index-DrZEbNhI.js` (sha uguale su gugditalia.it e
web.app). Il prossimo deploy hosting porta il service worker a v41.

## Verificato

Vuoto.
