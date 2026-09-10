# Piano stanze

Il piano stanze è una bozza operativa per attività con `overnight: true`. Vive in
`stakes/{stakeId}/activities/{activityId}/management/rooms` e non viene pubblicato
ai partecipanti. Il documento contiene stanze, ID delle iscrizioni assegnate,
blocchi manuali, sesso dichiarato dallo staff e coppie confermate. Non copia nomi,
note o altri dati dei partecipanti e non scrive `assignedRoomId` nelle iscrizioni.

## Ownership e accesso

- Lettura client: `admin` dello stesso palo e `super_admin`.
- Scrittura client: sempre negata dalle Firestore Rules.
- Scrittura server: callable `roomManagementSave`, dopo verifica del profilo,
  dell'attività, di tutte le iscrizioni e della revisione nella stessa transazione.
- Dirigenti di unità, staff, partecipanti e account anonimi non possono leggere il
  piano.

Il salvataggio usa optimistic concurrency: il client invia `expectedRevision` e
il server incrementa `revision`. Un salvataggio basato su una versione superata
fallisce con `aborted`. La cancellazione di un'iscrizione rimuove i suoi
riferimenti da assegnazioni, blocchi, sesso staff e coppie; se occupava una
matrimoniale, libera anche il coniuge per una nuova sistemazione. La revisione aumenta.
La cancellazione dell'attività elimina il documento del piano.

## Regole di assegnazione

- Sono ammesse solo iscrizioni `submitted`, `confirmed`, `active` e
  `pending_parent_authorization`; uno stato legacy cancellato prevale.
- Ogni ID iscrizione può apparire una volta. Identità stabili coincidenti
  (`userId`, account collegato, oppure coppia `parentUid`/`childId`) non possono
  essere assegnate due volte. Il nome non viene usato per deduplicare.
- Giovani uomini e giovani donne restano in stanze separate. Limiti di età e
  capienza sono sempre applicati.
- Lo staff richiede `adultGenders` esplicito; il sesso non viene inferito dal
  nome. Le stanze coppia hanno esattamente due posti e accettano soltanto una
  coppia adulta di sesso diverso confermata.
- Un piano con stanze conserva almeno una stanza staff non coppia.
- L'assegnazione automatica tocca solo i giovani. Conserva tutto se non si chiede
  il ricalcolo; col ricalcolo conserva blocchi manuali e adulti. Le note stanza
  lasciano la persona alla revisione umana. Le preferenze reciproche hanno peso
  maggiore, ma l'algoritmo non promette un ottimo globale.

Le preferenze vengono risolte prima con un nome completo normalizzato e univoco,
poi con un match salvato ancora coerente con il testo corrente. Un nome ambiguo
non viene collegato automaticamente.

## Query e indici

La callable legge la collection completa
`stakes/{stakeId}/activities/{activityId}/registrations` senza filtri o
ordinamenti, con `limit(2001)` per rifiutare eventi oltre il tetto, dentro la
transazione. L'admin legge il piano con `getDocFromServer` e le iscrizioni con
`getDocsFromServer`, anche quando ricarica dopo un conflitto. Non servono nuovi indici Firestore. Il limite
server è 200 stanze, 2.000 iscrizioni e 900 KiB per richiesta.

## Verifica locale

Test del core, dell'importazione e del modulo Foresteria:

```sh
node --test functions/tests/roomPlannerCore.test.mjs tests/roomImport.test.mjs tests/foresteriaModule.test.mjs tests/roomLayout.test.mjs
```

Rules, Auth e callable (solo emulatori, progetto `demo-room-planner`):

```sh
firebase emulators:exec --config firebase.room-test.json \
  --project demo-room-planner \
  'node --test functions/tests/roomManagementEmulator.test.mjs functions/tests/roomManagementRulesEmulator.test.mjs'
```

I test rifiutano l'esecuzione se host o project ID non indicano emulatori locali.
`roomManagementRulesEmulator.test.mjs` prova ruolo per ruolo, con letture e
scritture identiche al client, che il piano lo leggono solo admin del palo e
`super_admin` e che nessun client lo scrive, nemmeno staff del campo, dirigenti
di unità o iscritti. Controlla anche che `management/camp` resti invariato.

## Interfaccia e importazione

La tab Stanze dell'attività offre importazione Excel/CSV, schede per stanza,
filtri, preferenze originali, proposta automatica da applicare, spostamento
manuale, blocchi, annullamento dell'ultima modifica, esportazione CSV e
compilazione del modulo della Foresteria.
Le modifiche restano locali fino a Salva bozza; l'uscita richiede di salvare
oppure scartare esplicitamente. Il CSV contiene la bozza, inclusi i non assegnati.

Il modulo Foresteria mantiene le colonne assolute C/G anche se il foglio inizia
da C3. Ogni riga letto conta la quantità indicata: una matrimoniale con valore
2 vale due posti. Il totale viene confrontato con Totale Posti. L'anteprima
consente di scegliere le categorie prima di importare; un duplicato di stanza
interrompe l'operazione senza modifiche parziali. I file originali sono letti
localmente, mai caricati in Storage o inclusi nel repository pubblico.

Compila modulo Foresteria restituisce alla Foresteria il suo stesso modulo con i
nomi. L'admin sceglie il file `.xlsx` ricevuto; il browser scrive nome e cognome
di chi occupa ogni letto nella colonna di ogni notte indicata accanto a Num.
Stanza (una riga per letto, anche nelle matrimoniali), svuota i letti liberi e
scarica una copia `- compilato.xlsx`. Cambiano solo quelle celle: logo,
formattazione e le altre parti del file restano come ricevute, e il file non
viene caricato da nessuna parte. Serve la bozza salvata e senza problemi. Se una
stanza con persone assegnate manca dal modulo o ha più persone che posti,
l'operazione si ferma senza produrre file. Il nome è ripetuto in tutte le notti:
chi partecipa solo ad alcune va corretto a mano nel file.

Per il collaudo UI isolato:

```sh
firebase emulators:start --only firestore,auth,functions --project demo-room-planner --config firebase.room-test.json
GCLOUD_PROJECT=demo-room-planner FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9199 node tools/seed-room-demo.mjs
VITE_USE_EMULATORS=true VITE_EMULATOR_PROJECT_ID=demo-room-planner npm run dev -- --host 127.0.0.1
```

Account esclusivamente sintetico: `room-admin@example.invalid`, password
`RoomDemo2026!`. Pagina `/admin/events/room-demo/rooms`. Le credenziali valgono
solo nell'Auth Emulator locale. La modalità emulatori richiede build DEV,
localhost e progetto `demo-*`; in produzione resta disabilitata.

Verificato il 2026-09-10: build Vite/TypeScript, test core e parser, test callable
e rules con utenti autenticati nell'Auth Emulator, trigger di cleanup, browser
admin con importazione del file ricevuto (20 stanze, 80 posti), ricaricamento,
spostamenti senza duplicati, blocchi manuali, coppia esplicitamente confermata
e layout mobile 390 px senza overflow. Nessuna scrittura di collaudo in produzione.

## Pianta della struttura

La vista Pianta mostra le stanze della bozza sulla piantina della struttura. La
pianta vive in `stakes/{stakeId}/roomLayouts/{layoutId}` e contiene solo
geometria: piani, stanze (numero e rettangolo), spazi di servizio, zone con altre
funzioni, corte e segnaposto. Nessun dato personale. La leggono e la salvano
solo gli admin del palo e i `super_admin`; la cancellazione dal client è negata.
Le rules controllano l'id (`[a-z0-9-]`), le chiavi `version`, `name`, `floors`,
`updatedAt`, la versione 1, da 1 a 6 piani e `updatedAt` impostato dal server; la
forma di piani e stanze la valida `src/utils/roomLayout.ts` prima del
salvataggio. La lettura è la collection del palo senza filtri: nessun indice.

Le stanze si abbinano per numero: il nome della stanza nella bozza è il numero
sulla pianta. Le stanze della pianta assenti dalla bozza appaiono come “non
prenotata”; quelle della bozza assenti dalla pianta sono elencate sotto.
Toccando una persona si accendono solo le stanze compatibili, con le stesse
regole dell'assegnazione manuale; toccando la stanza la persona viene assegnata
e bloccata. La modifica resta nella bozza fino a Salva bozza.

La pianta si carica da un file `.json` (versione 1: `id`, `name`, `floors` con
`id`, `name`, `width`, `height`, `outline`, `rooms`, `spaces`, `markers`). Il file
della Foresteria del Tempio è privato: non va nel repository pubblico e si carica
con Carica pianta dalla vista Pianta.

## Pubblicazione

In produzione dal 2026-09-10: Firestore Rules (ruleset live identico a `main`),
`roomManagementSave`, `onRoomRegistrationDeleted`, `onRoomActivityDeleted` e
hosting. Compila modulo Foresteria è online dallo stesso giorno con service
worker `gugd-shell-v6`, verificato con curl su gugditalia.it e
giovani-palo.web.app. I deploy successivi richiedono conferma esplicita, da main
pulito, nello stesso ordine: rules, functions, hosting.
Nessuna assegnazione dei ragazzi reali è stata eseguita durante l'implementazione.
