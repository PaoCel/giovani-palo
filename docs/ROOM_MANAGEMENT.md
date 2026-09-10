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

Test del core:

```sh
node --test functions/tests/roomPlannerCore.test.mjs
```

Rules, Auth e callable (solo emulatori, progetto `demo-room-planner`):

```sh
firebase emulators:exec --config firebase.room-test.json \
  --project demo-room-planner \
  'node --test functions/tests/roomManagementEmulator.test.mjs'
```

Il test rifiuta l'esecuzione se host o project ID non indicano emulatori locali.

## Interfaccia e importazione

La tab Stanze dell'attività offre importazione Excel/CSV, schede per stanza,
filtri, preferenze originali, proposta automatica da applicare, spostamento
manuale, blocchi, annullamento dell'ultima modifica ed esportazione CSV.
Le modifiche restano locali fino a Salva bozza; l'uscita richiede di salvare
oppure scartare esplicitamente. Il CSV contiene la bozza, inclusi i non assegnati.

Il modulo Foresteria mantiene le colonne assolute C/G anche se il foglio inizia
da C3. Ogni riga letto conta la quantità indicata: una matrimoniale con valore
2 vale due posti. Il totale viene confrontato con Totale Posti. L'anteprima
consente di scegliere le categorie prima di importare; un duplicato di stanza
interrompe l'operazione senza modifiche parziali. I file originali sono letti
localmente, mai caricati in Storage o inclusi nel repository pubblico.

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

## Pubblicazione

Serve conferma esplicita per deploy da main pulito: prima Firestore Rules,
poi solo `roomManagementSave`, `onRoomRegistrationDeleted`,
`onRoomActivityDeleted`, infine hosting. Versione service worker preparata:
`gugd-shell-v5` (live verificato v4). Nessuna assegnazione dei ragazzi reali
è stata eseguita durante l'implementazione.
