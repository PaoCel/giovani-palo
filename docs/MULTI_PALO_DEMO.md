# Ambienti, multi-palo e demo

Un solo codice, tre ambienti: **produzione** (`giovani-palo`), **staging/demo**
(progetto separato, es. `giovani-palo-staging`, dominio `demo.gugditalia.it`) ed
**emulatori** (`demo-*`). Un ambiente diverso da produzione non puo' scrivere
su produzione ne' mandare email a persone vere.

## Client (Vite)

- Produzione: `npm run build` (nessun `.env` necessario, valori in
  `src/services/firebase/productionSettings.ts`).
- Staging: `cp .env.staging.example .env.staging`, compila i valori del progetto
  di staging, poi `npm run build -- --mode staging`.
- La build fallisce se manca un valore, se un valore coincide con quello di
  produzione (anche nelle forme `<id>.appspot.com`/`<id>.firebaseapp.com`) o se
  `--mode staging` non ha `VITE_APP_ENV=staging`
  (`src/services/firebase/environment.ts`, controllato in `vite.config.ts`). La
  build di produzione rifiuta a sua volta ogni `VITE_FIREBASE_*`,
  `VITE_WEB_PUSH_PUBLIC_KEY`, `VITE_DEFAULT_STAKE_*` e `VITE_APP_ENV` diverso da
  `production`, anche se arrivano dalla shell o da `.env.local`. Il bundle di
  staging non contiene la chiave di produzione (verificato con grep su `dist/`).
- Il bundle si lega all'host che lo serve (`assertHostMatchesEnvironment`): un
  bundle di produzione su `demo.gugditalia.it`/`*-staging.web.app` o uno di
  staging su `gugditalia.it`/`giovani-palo.web.app` non parte. Aggiornare le liste
  in `environment.ts` se nasce un nuovo host di staging. Prima di ogni deploy su
  staging controlla comunque che `dist/` contenga il project id di staging.
- `VITE_DEFAULT_STAKE_ID` (con `_NAME`/`_SLUG`) e' il palo mostrato sulle pagine
  pubbliche; in produzione resta `roma-est`. Le collection legacy `events/` e
  `settings/organization` restano di `roma-est` (`LEGACY_DATA_STAKE_ID`).

## Functions

- Il progetto si legge da `GCLOUD_PROJECT`/`FIREBASE_CONFIG` (la CLI li imposta
  su ogni funzione deployata); se non e' determinabile, email e link
  **falliscono** (mai un ripiego a caso). Un emulatore delle functions
  (`FUNCTIONS_EMULATOR=true`) e' sempre "non produzione", anche se parte col
  progetto di default; lo script `serve` usa comunque `--project demo-room-planner`.
- Produzione: invariata. Fuori da produzione serve `functions/.env.<projectId>`
  (modello: `functions/.env.staging.example`, ignorato da git):
  `APP_PUBLIC_URL` (mai un host di produzione), `EMAIL_ALLOWLIST`,
  `EMAIL_SUBJECT_PREFIX`, `EMAIL_SENDER_ADDRESS`, `WEB_PUSH_PUBLIC_KEY`.
- **Allowlist email** (`functions/lib/emailPolicy.js`, applicata in `deliver()` di
  `functions/lib/brevo.js`): To e BCC valutati uno per uno, indirizzi esatti o
  `@dominio`, niente wildcard; ogni destinatario deve essere UN indirizzo semplice
  (niente virgole, spazi, `<>`: l'email del genitore arriva dal client non
  validata) e a Brevo va la forma normalizzata. Se nessun To e' ammesso la mail e' "simulata"
  (log con indirizzi mascherati, nessuna chiamata a Brevo, nessuna chiave
  necessaria). Lista vuota o assente = non esce niente. Oggetto con prefisso
  e banner nel corpo.
- Secret per progetto: `BREVO_API_KEY` e `WEB_PUSH_PRIVATE_KEY` vanno creati nel
  progetto di staging (chiavi separate da produzione).

## Creare un palo

```sh
node tools/create-stake.mjs --project <id> --id palo-napoli --name "Palo di Napoli" \
  --unit "Rione Vomero" --unit "Ramo Posillipo:ramo" \
  --admin-email presidente@example.org --admin-first Mario --admin-last Rossi \
  --admin-unit "Rione Vomero"            # dry-run; aggiungi --apply per scrivere
```

- Rifiuta di sovrascrivere un palo esistente. Id unita' = `<palo>-<slug>` (unico
  fra pali).
- L'admin va assegnato a un'unita' (non puo' cambiarla da solo e il
  completamento profilo la richiede) e ha la data di nascita `1980-01-01`
  come segnaposto (modificabile da `/me`). Niente password: lo script stampa il
  link per sceglierla (con gli emulatori `--admin-password`).
- Produzione: `--production` e `CONFIRM_PROJECT=giovani-palo`.

## Seed demo (4 ruoli)

`tools/seed-demo.mjs` scrive il palo `palo-demo` con admin, dirigente di unita',
partecipante e genitore (2 figli: uno gia' autorizzato, uno in attesa per
provare "Autorizza ora" e il link di firma), 2 attivita' e 25 iscrizioni.
Rifiuta produzione e qualsiasi progetto che non sia emulatore `demo-*` o
`*-staging`/`*-demo`. Deterministico: ids fissi, date relative a `--today`.

```sh
# Emulatori (multi-palo, con Storage): firebase.multistake-test.json
firebase emulators:start --config firebase.multistake-test.json --project demo-room-planner
GCLOUD_PROJECT=demo-room-planner FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9199 FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9299 \
  node tools/seed-demo.mjs --reset --apply
# UI: config "vite-demo-emulators" in .claude/launch.json (VITE_DEFAULT_STAKE_ID=palo-demo)

# Staging (ADC attive)
DEMO_PASSWORD=... DEMO_PARENT_EMAIL=tuo+genitore@... node tools/seed-demo.mjs \
  --project giovani-palo-staging --reset --apply
```

`--reset` cancella tutto il palo demo (documenti, profili e account Auth con
`stakeId` demo, token, cache firme dei genitori demo, prefissi Storage del palo).
Login: `admin|dirigente|partecipante|genitore.demo@example.invalid`; password
`Demo-2026!` solo negli emulatori, altrove `DEMO_PASSWORD` (min 12 caratteri).
`DEMO_PARENT_EMAIL` e' l'unica casella vera (copia firmata del modulo) e deve
stare in `EMAIL_ALLOWLIST` di staging.

## Rischi noti, non ancora chiusi

- **Mail di Firebase Auth fuori dall'allowlist.** Sulla demo la registrazione e'
  pubblica: reset password e verifica li manda Firebase a qualunque indirizzo
  scritto da un visitatore. L'allowlist copre solo Brevo. Opzioni: registrazione
  chiusa su staging (Identity Platform + blocking function) o rischio accettato.
- `validRegistrationCreate` non controlla ne' il palo dell'utente ne' `unitId`: chi
  e' loggato puo' iscriversi a qualunque attivita' pubblica aperta di qualunque
  palo con un `unitId` a scelta (probabilmente voluto, da decidere col punto 5).
- Il link di firma di Matteo nella demo e' derivato da una stringa fissa del
  repo pubblico: chiunque sappia la regola puo' firmare la demo (la copia va a
  `DEMO_PARENT_EMAIL`). Accettato; non usarlo per dati veri.
- `--reset` cancella anche chi si e' registrato da solo nel palo demo (profilo e
  account Auth): il dry-run elenca `nonSeedUsers`, leggilo prima di `--apply`.
  La cache firme e' globale per hash email: un `DEMO_PARENT_EMAIL` uguale a quello
  di un genitore vero di un altro palo gli cancellerebbe la firma salvata.
- `users/{genitore}/children` e' elencabile dall'admin del palo solo con
  `where("stakeId","==",...)`.

- `canCreateOwnUser` accetta qualsiasi `stakeId`: prima di aprire a pali veri
  serve `exists(/stakes/$(stakeId))` (punto 5 del piano).
- Un partecipante o genitore puo' cambiare `stakeId` del proprio profilo (le
  rules lo consentono); con piu' pali il selettore va protetto.
- `parentAuthorizationSignatureCache` e' per hash dell'email, non per palo: la
  stessa email riusa la firma in pali diversi (accettabile: e' lo stesso
  genitore).
