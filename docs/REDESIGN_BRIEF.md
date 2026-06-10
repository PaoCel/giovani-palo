# Brief redesign UI — gugditalia.it

Brief operativo per la sessione di redesign. Da usare come contesto di
partenza in una nuova chat (il prompt di kickoff è in fondo al file).

## Contesto prodotto

Webapp per le attività dei giovani (GU/GD) dei pali italiani della Chiesa di
Gesù Cristo dei Santi degli Ultimi Giorni. Utenti NON tecnici, perlopiù da
telefono (PWA installabile). Cinque ruoli: giovane (`/me`), genitore
(`/family`), dirigente unità (`/unit`), admin palo (`/admin`), super admin.
Pagine pubbliche: landing, catalogo attività, dettaglio, form iscrizione
(anche guest), login, pagina firma genitore via magic-link (standalone).

## Stack e vincoli tecnici (non negoziabili)

- Vite + React 19 + TS, react-router 7, CSS unico in `src/styles/base.css`
  (~7.5k righe, BEM-like, design token in `:root`). NIENTE framework CSS,
  niente CSS-in-JS, niente nuove dipendenze UI senza ok esplicito.
- Route lazy + vendor chunk: non re-importare pagine eagerly.
- I dati passano dai service in `src/services/firestore/*` con cache di
  sessione (`src/utils/sessionCache.ts`): non aggiungere fetch diretti.
- Skeleton + stati loading/error/empty onesti: mai dichiarare "vuoto"
  durante un caricamento.
- Accessibilità: focus visibile, aria-label su icon-button, contrasto AA,
  `prefers-reduced-motion` rispettato (pattern già in base.css).
- Build check: `npm run build` deve passare a ogni step.

## Direzione visiva già avviata (estendere, non reinventare)

- Brand: blu `--primary #235d90` / `--primary-strong`, accento sabbia
  `--accent #b58a50`, serif Fraunces per i titoli, Manrope per il resto.
- Landing: hero a gradiente brand con eyebrow/titolo/sottotitolo/2 CTA.
- Catalogo: card poster 3:4 con badge, griglia fluida (2 col su telefono),
  ingresso a cascata `card-rise`, hover lift, skeleton shimmer.
- Admin: header pagina con nome palo + azione primaria, metriche con icona
  e barra accento.
- Tono: sobrio, caldo, professionale. Niente dark pattern, niente densità
  da dashboard enterprise per gli utenti giovani/genitori.

## Metodo di lavoro obbligatorio

1. `npm run dev` via preview tool (`.claude/launch.json` → `vite-dev`),
   screenshot PRIMA di toccare una pagina, screenshot DOPO ogni iterazione.
   Niente redesign alla cieca.
2. Mobile-first: verifica ogni pagina anche a ~390px (preview_resize).
3. Un commit per pagina/area, messaggio chiaro, build verde prima del commit.
4. Le aree autenticate (me/family/unit/admin) non sono visitabili in preview
   senza credenziali: lavorare su CSS/markup con modifiche conservative e
   chiedere a Paolo screenshot di verifica, oppure fare verifiche con dati
   mock se la pagina lo consente.

## Scope, in ordine di valore

1. **Dettaglio attività pubblica** (`ActivityDetailPage`): hero immersivo
   full-bleed con immagine attività + gradiente, info chiave a chip (date,
   luogo, audience, stato iscrizioni), CTA iscriviti sticky su mobile,
   countdown chiusura iscrizioni se < 7 giorni.
2. **Dashboard giovane** (`MeDashboardPage`): "la tua prossima attività"
   come card hero, poi feed. Meno sezioni, più gerarchia.
3. **Dashboard famiglia** (`FamilyDashboardPage`): card figli più visive
   (avatar iniziali colorate), stato iscrizioni a colpo d'occhio.
4. **Form iscrizione** (`RegistrationEditor`, 1900+ righe): NON riscrivere
   la logica; solo ritmo visivo dello stepper, raggruppamento campi,
   progress più chiaro.
5. **Area admin**: tab evento più orizzontali (tabella/righe dense già
   avviate), gerarchia titoli, coerenza pulsanti.
6. **Micro-interazioni globali**: transizioni di pagina leggere, stati
   pressed dei bottoni, toast di conferma coerenti (oggi notice inline).

## Cosa NON fare

- Non toccare rules, services, functions, flussi di autorizzazione.
- Non cambiare i testi legali/consensi (sono allineati ai PDF ufficiali).
- Non introdurre rotture di route o di deep-link esistenti.
- Non superare ~30 kB gzip aggiunti al bundle principale.

## Prompt di kickoff (incollare in una nuova chat)

> Leggi docs/REDESIGN_BRIEF.md e AGENTS.md. Poi: git fetch origin && git
> status --short --branch; lavora da main aggiornato su branch
> codex/redesign-ui. Avvia la preview (launch config "vite-dev") e fai
> screenshot di landing, /activities e /activities/:id (prendi un id reale
> dal catalogo). Procedi nello scope del brief in ordine, una pagina per
> volta: screenshot prima/dopo, mobile 390px e desktop, build verde, un
> commit per pagina. Quando un'area richiede login chiedimi screenshot
> invece di tirare a indovinare. Alla fine: npm run build, merge ff su
> main, push, deploy hosting solo se te lo confermo.
