# Preparazione del bucket europeo

Questi strumenti eseguono solo la fase A già approvata nel piano di migrazione:
preparano un bucket aggiuntivo. Non cambiano il bucket scelto dal client, le
Functions, gli URL, il bucket di default né i file degli utenti.

Ogni operazione in produzione richiede conferma fresca di Paolo. Tutti i
comandi sono in sola lettura senza `--apply`; il deploy richiede inoltre un
checkout pulito del branch `main`, uguale a `origin/main`. Il branch `codex/storage-eu`, che effettua il
passaggio del client, resta separato finché il bucket non esiste.

## Perimetro e credenziali

Coppie consentite: `giovani-palo` → `giovani-palo-eu` e
`giovani-palo-staging` → `giovani-palo-staging-eu`. Nessun nome libero,
nessun progetto demo, nessun ambiente emulatore. Le credenziali sono quelle
del login Firebase CLI; `--account` può scegliere un altro login già presente.
Nessun ripiego su gcloud/ADC o su `FIREBASE_TOKEN`. Token e risposte di errore
delle API non vengono stampati.

Il bucket deve appartenere al `projectNumber` del progetto Firebase dichiarato,
stare in `EUROPE-WEST1`, avere accesso uniforme abilitato e prevenzione accesso
pubblico `enforced`. Un bucket esistente difforme blocca l'operazione: lo
strumento non modifica IAM, regione o protezioni per farlo passare.

Le API usate sono [GCS buckets insert](https://cloud.google.com/storage/docs/json_api/v1/buckets/insert),
[metadati GCS](https://cloud.google.com/storage/docs/json_api/v1/buckets),
[Firebase addFirebase](https://firebase.google.com/docs/reference/rest/storage/rest/v1beta/projects.buckets/addFirebase)
e lettura delle release Rules. La verifica non scarica oggetti, non usa
URL di download e non stampa nomi o metadati dei file degli utenti.

## Ordine operativo

Prima, ispezione e piano senza scritture:

```sh
node tools/storage-eu-bucket.mjs inspect --project giovani-palo --bucket giovani-palo-eu
node tools/storage-eu-bucket.mjs create --project giovani-palo --bucket giovani-palo-eu
```

Dopo conferma fresca, `create` con `--apply` crea solo se assente. Un secondo
invio controlla proprietà e protezioni e non ricrea il bucket.

```sh
node tools/storage-eu-bucket.mjs create --project giovani-palo --bucket giovani-palo-eu --apply
node tools/storage-eu-bucket.mjs link --project giovani-palo --bucket giovani-palo-eu
node tools/storage-eu-bucket.mjs link --project giovani-palo --bucket giovani-palo-eu --apply
```

`link` collega a Firebase solo un bucket esistente e conforme. Un collegamento
già presente è verificato e non viene ripetuto. Se una chiamata perde la risposta,
`mayHaveApplied: true` impone una nuova ispezione; non assumere assenza di effetti.

Le rules vengono lette dal `main` pulito. Il preflight confronta il loro SHA-256
con il ruleset attivo del bucket di default; una differenza va rivista prima del
deploy, perché può includere modifiche ancora da rilasciare. Le nuove rules di
S2 possono richiedere i membri non ancora migrati: nella fase A valgono solo
sul bucket UE, mentre il client attivo continua a usare quello USA. Il passaggio
e la migrazione delle appartenenze devono essere coordinati nella fase B.

```sh
node tools/storage-eu-rules-deploy.mjs --project giovani-palo --bucket giovani-palo-eu
node tools/storage-eu-rules-deploy.mjs --project giovani-palo --bucket giovani-palo-eu --apply
```

Il wrapper usa esclusivamente `firebase.storage-phase-a.json`, array con un solo
bucket esplicito, e `--only storage`. Non può ricadere sul bucket di default.
Dopo il deploy verifica il sorgente realmente attivo sul bucket UE e che la
release del bucket di default sia identica a prima. Non esegue rollback o
correzioni automatiche se la verifica fallisce.

Staging usa gli stessi comandi con la coppia staging e la config separata
`firebase.storage-phase-a-staging.json`; scegliere il login corretto tramite
`--account` quando necessario. Non sostituire solo un alias di progetto.

La copia dei file è un'operazione successiva distinta:
`tools/migrate-storage-bucket.mjs --phase sync`, inizialmente senza `--apply`.
La riscrittura degli URL e il passaggio del client appartengono alla fase B.
Mai usare `--phase all` al posto di `sync` durante la fase A.


## Verifiche della preparazione

26 ottobre: sintassi dei tre moduli verificata; `inspect` reale sul mini con
login Firebase CLI esplicito, sole letture di metadati progetto/bucket, EXIT=0.
Il bucket UE di produzione risulta assente. Anche `create` senza `--apply`
ha restituito `changes: []`, `plannedActions: ["create"]`, EXIT=0: nessuna
scrittura. Creazione, collegamento e deploy reali non sono stati eseguiti;
le POST e gli errori dopo una mutazione sono provati soltanto con API simulate
nei test di un altro autore. Ultimo giro: 23/23 test, zero salti, EXIT=0;
review indipendente PASS WITH CONCERNS solo per POST e deploy live non eseguiti.

Il dry-run sync del 26 ottobre ha contato 1196 oggetti e 1065,8 MB da
copiare, destinazione vuota, zero conflitti/cancellazioni. Il diff del
ruleset Storage default live è stato letto: le sole differenze dal candidato
main sono appartenenza e privilegi S2 già collaudati. SHA-256 live:
`8af57b7797c26e55283e770efba8c56501fe4fbac9d3e52202b5f68198f7c101`;
candidato `34fd55bc41011d32f10c779d27a9a1535907acdcad79017cb249487e9ff103a2`.
Ricontrollare stato e diff subito prima dell’operazione autorizzata.
