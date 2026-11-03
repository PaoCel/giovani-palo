# Brief restyling — gugditalia.it

Brief operativo del task `gugd-restyling` (assorbe `gugd-fondamenta-visive` e
la parte home/scheda di `gugd-etichette-home`). Prima versione: giugno 2026.
Riscritto il 3 novembre 2026 con lo stato reale delle pagine, misurato nel
browser loggato da dirigente di unità (Roma 5) e nel codice di `main`
(`98fdfee`). Stato del lavoro e prossimo passo: `tasks/gugd-restyling.md`.

## Decisioni di Paolo

- 2026-11-03, sui mockup: **direzione A**, continuità con la home social di
  ottobre (superfici fredde, primario blu, inchiostro per l'attività in
  evidenza, sabbia solo per conteggi e azioni speciali). La direzione B (carta
  calda, testata blu, sabbia sugli stati attivi) è scartata e i suoi valori
  non entrano nel codice.
- 2026-11-03: **barra admin in basso a 5 voci con etichetta** (Home,
  Attività, Persone, Calendario, Altro; Gallerie e Feed dentro Altro) al
  posto delle 7 a sola icona. Fase 4.
- 2026-11-03: **testata senza la riga nome/ruolo** (da 161 a circa 86 px a
  375), con il cambio vista nel menu dell'avatar. Fase 4.
- Ancora da decidere, serve alla fase 4: barra laterale admin a desktop.

## Contesto prodotto

Webapp per le attività dei giovani (GU/GD) dei pali italiani della Chiesa di
Gesù Cristo dei Santi degli Ultimi Giorni. Utenti non tecnici, quasi tutti da
telefono (PWA installabile), 100+ account reali. Aree: giovane (`/me`),
famiglia (`/family`, ora su ogni account adulto), dirigente di unità
(`/unit`), admin del palo (`/admin`), super admin. Pagine pubbliche: landing,
catalogo, dettaglio attività, iscrizione (anche ospite), login, firma del
genitore via link (`/parent-consent/:token`), sondaggi, Notte dei record.

Dopo il restyling arrivano inglese e spagnolo (`gugd-i18n`, lingua del
dispositivo con scelta manuale): ogni componente deve reggere testi più
lunghi del 30-40% senza tagliare né sbordare.

## Stack e vincoli tecnici (non negoziabili)

- Vite 7 + React 19 + TS, react-router 7. CSS a mano: `src/styles/base.css`
  (12.209 righe) più 17 fogli di funzione (22.527 righe in tutto), BEM-like,
  token in `:root`. Niente framework CSS, niente CSS-in-JS, niente dipendenze
  UI nuove.
- Route lazy e vendor chunk: non importare pagine in modo eager.
- Dati solo dai service in `src/services/firestore/*`: niente fetch diretti.
- Copy nei moduli di `src/copy/*.ts` (una frase per concetto): prima di
  scrivere un testo nuovo cercalo lì e riusalo identico.
- Skeleton e stati loading/error/empty onesti: mai «vuoto» durante un
  caricamento.
- Accessibilità: focus visibile, `aria-label` sugli icon-button, contrasto AA,
  `prefers-reduced-motion` rispettato.
- Verifica: `mini 'npm ci && npm test && npm run build'` (build e test sul Mac
  mini, non sull'Air).

## Stato reale delle pagine, 3 novembre 2026

Misure a 375 px nel browser loggato salvo dove indicato. «Piccolo» = testo
sotto 13 px; «target» = controlli sotto 44 px di altezza.

| Pagina | Route | Nata o cambiata | Stato |
| --- | --- | --- | --- |
| Home giovani social | `/me` | 26 ott | La più rifinita: testo minimo 13 px, target 44, radius 16-22, Fraunces 500 per i titoli, illustrazione propria (`giovani.webp`). Ma i colori sono esadecimali scritti in `homeSocial.css` (`#52687b`, `#1b3f67`, `#e8a857`, `#edece5`, `#edf1f2`), fuori da `:root`. È il riferimento della direzione. |
| Scheda attività giovane | `/me/activities/:id` | 31 ott (programma), 1 nov (alloggio) | Hero `camp-youth-*`, programma a momenti sopra le schede, schede a sentiero (Iscrizione, Gruppo, Comitati, Galleria, Sondaggio). Da `gugd-etichette-home`: tasti da 42-43 px, chip da 10,6-12,8 px. Non visibile con l'account di Paolo (nessuna iscrizione propria): ricostruita dal codice. |
| Programma a momenti | dentro la scheda | 31 ott | `moments-panel`, `moment-card`, pill «ci sei». Componente buono da portare sui token, non da ridisegnare. |
| Alloggi e stanze | scheda giovane, admin | 1 nov | Lato giovane è una riga «Alloggio» dentro «Informazioni utili» e «La tua stanza»: poco visibile per un'informazione che i ragazzi cercano. |
| Comitati e gruppi | scheda giovane, unità, admin | 31 ott | Card con iniziali, incarico, componenti. Sulla scheda unità i cinque comitati vuoti occupano mezza pagina. |
| Home dirigente | `/unit` | 20 ott (code Persone) | Card delle code Persone chiare. **Difetto in produzione:** la freccia delle righe attività era larga 155-228 px (fino a metà schermo a desktop), corretto in produzione il 3 novembre (`a0d9dfe` su `main`, service worker v38). Quattro riquadri numerici in fila che a 375 tagliano l'ultima etichetta. |
| Persone (unità e admin) | `/unit/persone`, `/admin/persone` | 3 nov | Stesso pannello `StakePeoplePanel` per dirigente e admin. Pulita: nessun piccolo salvo 1, target tutti 44, nessuno sbordo a 320. Testata con `PageHero`. È la base della pagina admin del mockup. |
| Scheda attività unità | `/unit/activities/:id` | 20 ott | La peggiore: 124 testi piccoli su 190 (10,9-12,8 px), 8 controlli su 14 sotto 44 («Reinvia email» 24 px, trasporto 22 px). Nome e ruolo incollati senza spazio nel testo («Mario RossiGiovane uomo»). |
| Catalogo pubblico | `/activities` | giugno | Filtri chiari. Vuoto senza azione: «Nessuna attività disponibile con questi filtri» e nient'altro, nemmeno «Mostra tutto il periodo». |
| Dettaglio pubblico | `/activities/:id` | giugno | Hero con foto e pill. La pill di stato legge `event.status` e non lo stato effettivo: su un'attività finita il 17 ottobre dice «Iscrizioni aperte» mentre il tasto in basso dice «Iscrizioni non disponibili» (stesso difetto in `EventCard`). Da sistemare a parte, non è restyling. |
| Firma genitore | `/parent-consent/:token` | 3 nov | Target 44 sistemati fuori da questo task. Da portare sui token solo quando ci saranno. |
| Testata comune | tutte le aree | — | A 375 la testata è alta 161 px: marchio e azioni, poi una riga con l'occhiello del palo e due pill (nome, ruolo) alta 86 px. Un quinto dello schermo prima del contenuto. |
| Navigazione admin | `/admin/*` | — | Barra in basso con 7 voci a sola icona (etichette solo per lettori di schermo): Dashboard, Attività, Persone, Calendario, Gallerie, Feed, Altro. |
| Notte dei record | `/record`, `/activities/:id/record` | ott | Pelle sua (`rn-skin`, tabellone). Fuori dal restyling: non si tocca. |

### Censimento del CSS (3 novembre)

| Proprietà | Dichiarazioni | Valori diversi | Con token |
| --- | --- | --- | --- |
| `font-size` | 827 | 168 | 24 (`var` o `clamp`) |
| di cui sotto 13 px | 223 | — | — |
| `border-radius` | 578 | 70 | 32 |
| spaziature (`padding`, `margin`, `gap`) | 2.139 | — | 0 |
| `z-index` | 50 | 19 (da -2 a 1300) | 0 |

Altri numeri utili: `.button--small` è alto 39-42 px e compare 153 volte;
`notice` 69 usi, `EmptyState` 19 (nessuno con illustrazione, pochi con
azione), `PageHero` 11, `SectionCard` 12, `AppIcon` 71 file. I toast
(`mship-toast` 60, `rn-toast-region` 70) stanno sotto ai fogli
(`bottom-sheet-layer` 80) e alle modali (1250).

## Token: cosa c'è e cosa manca

Esistono in `:root`: colori (`--bg`, `--surface*`, `--text`, `--heading`,
`--muted`, `--primary*`, `--accent*`, `--success/warning/danger` e `-soft`),
due ombre, tre radius (`--radius-xl` 32 px, `--radius-lg` 23 px,
`--radius-md` 18 px).

Mancavano. Dalla fase 0 (3 novembre) stanno in `src/styles/tokens.css`,
importato in `src/main.tsx` prima di `base.css`, con nomi nuovi per non
cambiare di colpo le pagine che usano quelli vecchi (adozione pagina per
pagina, niente sostituzione globale). `tokens.css` non ridefinisce mai un
token storico: i componenti nuovi usano `--bg`, `--text`, `--heading` e
`--primary` di `base.css`, che hanno già i valori della direzione A.

- **Spaziatura** su base 4: `--space-1` 4, `-2` 8, `-3` 12, `-4` 16, `-5` 20,
  `-6` 24, `-7` 32, `-8` 48. Margine di pagina `--gutter` 16 px sotto 768,
  24 sopra; larghezza `--content-max` 1100 px.
- **Tipo**: `--font-display` Fraunces, `--font-body` Manrope (fallback
  `system-ui`). Scala `--text-xs` 13 (minimo assoluto, testo secondario),
  `--text-sm` 14, `--text-md` 16 (lettura e campi: sotto, Safari zooma),
  `--text-lg` 18, titoli `--title-sm` 22, `--title-md` 26, `--title-lg` 30,
  `--title-xl` `clamp(32px, 7vw, 44px)`; interlinea `--leading-tight` 1,15 e
  `--leading-body` 1,5.
- **Colore**, i valori già usati dalla home social messi in `:root`:
  `--text-secondary` `#52687b` (5,8:1 su bianco, 5,2:1 su `--bg`),
  `--ink` `#1b3f67`, `--action-sand` `#e8a857` (testo `--ink` sopra: 5,2:1),
  `--surface-card` bianco, `--surface-cool` `#edf1f2`, `--surface-warm`
  `#edece5`, `--focus-ring` `#bb7626`, `--line` `#dae1e6` (bordi), sabbia
  tenue `--sand-soft` `#f8e3c4` con testo `--on-sand-soft` `#6b4a14` (pill
  dei conteggi). Toni in coppia testo/fondo per Notice e Pill: `--info-ink` e
  `--info-surface`, poi `--success-*`, `--warning-*`, `--danger-*`; non si
  usano `--warning` e `--danger` storici perché sul loro fondo tenue non
  arrivano ad AA (3,9:1 e 4,2:1; le coppie nuove vanno da 5,2 a 5,9:1). Le
  pagine vecchie che li usano così hanno lo stesso difetto: sparisce quando
  passano a Pill e Notice. Tutti AA misurati.
- **Radius**: `--radius-inset` 12, `--radius-control` 16, `--radius-card` 20,
  `--radius-sheet` 22, `--radius-pill` 999.
- **Target**: `--target` 44 px (minimo per ogni controllo, anche «small»),
  `--control` 48 px (azione principale).
- **Z-index**, una scala sola: `--z-raised` 1, `--z-sticky` 30 (testata),
  `--z-dock` 40 (barra in basso, CTA fissa, FAB), `--z-popover` 60 (menu a
  tendina), `--z-sheet` 1000 (fogli e lightbox), `--z-modal` 1250, `--z-toast`
  1400 (sempre sopra, anche ai fogli).
- **Ombre e movimento**: `--shadow-card` `0 4px 18px rgba(27,63,103,.05)`;
  `--duration-fast` 150 ms, `--duration` 220 ms, `--ease`
  `cubic-bezier(.2,.7,.2,1)`, azzerati con `prefers-reduced-motion`.
- **Icone**: `AppIcon` non ha una dimensione sua; dove manca una regola CSS
  prende tutto lo spazio (il difetto di `/unit`). Il componente nuovo dà
  `1.25em` di default e lascia al CSS la sovrascrittura.

## Componenti condivisi

Cinque, in `src/components/ui/` (fase 0, 3 novembre), importati da
`@/components/ui`. Il loro CSS è `src/styles/ui.css`, importato da ogni
componente come fanno gli altri fogli di funzione, e usa solo i token. Ogni
classe inizia con `.ui-`: `.card`, `.notice`, `.empty` e `.hero` esistono già
in `base.css` e restano alle pagine non ancora rifatte. Sostituiscono i
vecchi pagina per pagina; i vecchi restano finché qualcuno li usa.

1. **PageHeader** (al posto di `PageHero`, `UserPageIntro`, `hero`):
   occhiello, titolo, descrizione, azioni, indietro opzionale. Titolo che va a
   capo (mai `nowrap`), azioni che scendono sotto il testo quando non c'è
   spazio. Nessuna altezza fissa.
2. **Card**: contenitore unico con varianti `default`, `cool`, `warm`, `ink`
   (scura, per l'attività in evidenza) e `link` (tutta cliccabile, freccia da
   20 px a destra). Slot testata, corpo, piede; padding `--space-5`, radius
   `--radius-card`.
3. **Notice**: toni `info`, `success`, `warning`, `danger`; icona, titolo,
   testo, azione. `role="status"` o `role="alert"` secondo il tono. Il tono si
   passa esplicito, non si deduce dal titolo.
4. **EmptyState con azione**: illustrazione propria opzionale, titolo, testo,
   azione principale obbligatoria (o `null` esplicito quando davvero non c'è
   niente da fare) e link secondario. Esempi: catalogo vuoto → «Mostra tutto il
   periodo»; nessun comitato → «Scegli un comitato».
5. **Button**: `primary`, `secondary`, `ghost`, `danger`; altezze 48 e 44
   (mai sotto), icona a sinistra o a destra, `block` su telefono, stato
   «in corso». Il testo va a capo su due righe invece di uscire dal bordo.

Con questi due pezzi piccoli che servono a tutti: **Pill** (stato e conteggi:
testo 13 px, alta 28 se non si tocca, 44 se è un filtro) e **Icon** (la
dimensione di default sopra).

Come sono fatti nel codice:

- `Button` ha `busy` (disabilitato, `aria-busy`, rotella al posto
  dell'icona); `ButtonLink` è lo stesso aspetto su un `Link` del router;
  `buttonClassName()` per i casi in cui serve solo la classe.
- `Card` con `to` diventa un link intero con la freccia: niente controlli
  dentro. Livello del titolo con `titleAs` (h2 di default). Dentro la Card
  `ink` i pulsanti cambiano pelle da soli: primario sabbia (il blu su
  inchiostro fa 1,2:1), secondario e ghost bianchi, danger su fondo tenue;
  l'anello di focus diventa sabbia (l'arancio su inchiostro fa 2,9:1).
- `Notice` ha il tono obbligatorio; `live` sceglie tra `alert` (default per
  danger), `status` (default per gli altri) e `none` per gli avvisi fissi già
  presenti all'apertura. Icona di tono: `info` (aggiunta ad `AppIcon`),
  `check`, `alert`.
- `EmptyState` ha `action` obbligatoria (`null` scritto apposta quando non
  c'è niente da fare) e `illustration` per le immagini di
  `src/assets/flusso-genitore/`. Non è `components/EmptyState`, il vecchio
  senza azione, che resta finché qualcuno lo usa.
- `Pill` non si tocca. Un filtro toccabile è un `Button`, così arriva a
  44 px.

## Regole per i testi lunghi (inglese e spagnolo)

- Niente larghezze fisse su pulsanti, pill e schede; niente `nowrap` sulle
  etichette (solo su numeri e date brevi).
- Le schede segmentate scorrono in orizzontale o vanno a capo; mai etichette
  troncate con i puntini.
- Ogni componente nuovo si prova con un testo lungo il 40% in più (il mockup lo
  fa con le schede e i pulsanti).
- Date e numeri con `Intl`, non stringhe composte a mano.

## Cosa la rende nostra

- **Scheda attività**: la foto dell'attività nella testata, il programma come
  un sentiero di momenti, l'alloggio come «la tua stanza» con i nomi dei
  compagni; illustrazioni del set `src/assets/flusso-genitore/` negli stati
  vuoti, mai icone di libreria.
- **Area admin**: il marchio del palo nella testata, i numeri delle code come
  pill sabbia, la stessa carta e lo stesso inchiostro delle pagine dei giovani:
  lo staff vede l'app che vedono i ragazzi, non un gestionale.

## Scope, in ordine

0. Token e cinque componenti, senza cambiare pagine (commit a sé).
1. Scheda attività giovane `/me/activities/:id`, con programma e alloggio.
2. Home giovani `/me`: porta la home social sui token (cambio visivo minimo).
3. Catalogo e dettaglio pubblico.
4. Testata comune e navigazione admin, poi Persone e home dirigente `/unit`.
5. Scheda attività unità `/unit/activities/:id` (la più densa di testo
   piccolo).
6. Il resto pagina per pagina: famiglia, admin eventi, form iscrizione (solo
   ritmo visivo, la logica di `RegistrationEditor` non si riscrive).

Un commit per pagina, prima e dopo a 320, 390, 430 e desktop.

## Metodo di lavoro

1. Prima di toccare una pagina: screenshot nel browser loggato a 390 e
   desktop. Il pannello dell'app è loggato da dirigente di unità; per le pagine
   admin serve che Paolo dia l'accesso admin; la vista giovane serve un account
   QA con un'iscrizione (quello di Paolo non ne ha) oppure il dev server con
   emulatori e dati di prova sul mini.
2. Mockup in `.claude/mockups/restyling/` del checkout principale (ignorato da
   git, non nello scratchpad), con i token di questo brief, scelti da Paolo
   prima del codice.
3. Collaudo: niente scroll orizzontale a 320 (`scrollWidth` contro
   `clientWidth`), testo secondario mai sotto 13 px, controlli mai sotto 44,
   nessun cambio visivo nelle pagine non toccate.
4. Build e test sul mini; deploy hosting con service worker incrementato solo
   con conferma fresca di Paolo.

## Cosa non fare

- Non toccare rules, services, Functions, flussi di autorizzazione.
- Non cambiare i testi legali e dei consensi (allineati ai moduli ufficiali).
- Non rompere route o deep link esistenti.
- Non toccare la pelle della Notte dei record.
- Non superare circa 30 kB gzip aggiunti al bundle principale.
- Niente emoji nella UI, niente icone di libreria dove l'utente sceglie,
  aspetta o festeggia.
