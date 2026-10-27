# Rilascio coordinato S2, home, attività e Storage UE

Piano di rilascio, 26 ottobre 2026. La fase A è stata autorizzata ed eseguita:
1196 oggetti copiati, verifiche di contenuto e metadati senza differenze,
rules solo UE e default invariato. Il rilascio B è stato autorizzato e
pubblicato il 27 ottobre; il collaudo autenticato è ancora parziale. Le fasi C, D ed E restano separate.

## Risultato previsto

- L'app e le Functions usano il bucket UE; le copie USA restano durante
  l'aggiornamento delle vecchie PWA. L'informativa descrive questa transizione.
- S2 distingue appartenenza verificata e ruolo dichiarato, apre le code ai
  responsabili ed elimina il vecchio sistema dei codici galleria.
- Home con feed e foto/commenti; creazione con pochi campi, bozza e
  pubblicazione; comitati con incarichi e denominazione dei gruppi configurabili.
- Revoche e cancellazioni galleria coprono entrambi i bucket. Tombstone e
  precondizioni Storage proteggono anche da copie o tentativi tardivi.

Programma con partecipazioni, alloggi e delega alla singola attività restano
incrementi successivi del task attività, non vengono dichiarati consegnati qui.

## Letture di produzione prima della conferma

Controlli del 26 ottobre, tutti in sola lettura dopo la fase A:

| Controllo | Esito |
| --- | --- |
| Migrazione S2 | 180 da creare: 31 staff, 108 da verificare, 41 in coda; 348 iscrizioni lette |
| Vecchi codici galleria | 1 galleria da aggiornare, 31 documenti da eliminare |
| Functions attive | 30, comprese le due callable obsolete dei codici |
| Feed pubblicato | 8 post, tutti con visibilità esplicita; query esatta riuscita |
| Indici live | Definizioni esistenti coerenti; il candidato aggiunge soltanto il composito feed pubblicato/visibilità |
| Query ultimo admin | Riuscita, 10 profili admin del palo |
| Scheduler/PubSub/Eventarc/Functions | API abilitate |
| URL Storage | 3182 documenti letti, 297 da aggiornare, 875 campi; zero formati sconosciuti |
| Iscrizioni con URL | 4: 2 confermate, 1 annullata, 1 autorizzazione pendente |
| Autorizzazione pendente | Token presente, nessun errore email o cambio destinatario; nessun invio previsto dalla sola riscrittura URL |
| Media nascosti | 0; nessuna riconciliazione legacy da applicare |
| Service worker servito | v32; candidato preparato v33, ricontrollare prima del deploy |

Il censimento separato dei file ha trovato 41 prefissi media senza documento
visibile o nascosto, in 328 prefissi totali e quattro gallerie esistenti.
Sono candidati da classificare, non dati da cancellare durante B. Nessuna
riparazione o cancellazione di questi file è compresa nell'approvazione B.

## Ordine operativo dopo approvazione

Usare soltanto un clone isolato, pulito, del commit definitivo di `main`,
uguale a `origin/main`. Registrare commit e hash dei sorgenti. Non usare una
vecchia build o il branch storico Storage come sorgente di deploy.

1. Ricontrollare i dry-run, il service worker live e i conteggi attesi. Se il
   piano cambia, aggiornare il perimetro prima di applicarlo.
2. Migrare S2 con `migrateStakeMembers.js --stake roma-est --apply
   --expect-create 180`, poi verificare conteggi, staff attivo e secondo dry-run
   senza nuove creazioni. Questa scrittura precede le rules che leggono members.
3. Pubblicare Firestore rules e indici del candidato; attendere che gli indici
   necessari siano utilizzabili. Pubblicare Storage rules sul target `main`,
   che comprende **entrambi** i bucket. Il candidato richiede appartenenza
   attiva anche per l'upload dello staff, mantenendo lettura e moderazione per
   il fallback di ruolo. Tutti i 31 staff correnti sono inclusi nella migrazione.
4. Pubblicare per nome tutte le Functions esportate dal candidato: l'inizializzazione
   del bucket è condivisa. Includere membership/trigger/reminder, cleanup media
   e `campManagementSave`; non aggiornare il solo hosting.
5. Eseguire `cleanupGalleryCodes.js --apply --expect-galleries 1
   --expect-deletes 31`; eliminare per nome `unlockGalleryWithCode` e
   `setGallerySecretCode` in europe-west1. Nessun altro dato o funzione eliminato.
6. Deploy del bundle già costruito, con service worker superiore a quello
   realmente servito; verificare release e asset prima della prova nel browser.
7. Rileggere il piano Storage e applicare `--phase all --apply` con lo stesso
   checkpoint della fase A. Questo passaggio riallinea anche revoche avvenute
   tra copia A e backend B; riscrive gli URL e verifica i download.
   Il sync nuovo può eliminare copie di media con tombstone delete: conteggi
   e tetto devono essere espliciti; non includere i candidati orfani censiti.
8. Richiedere `VERIFY_OK`, oldRefs zero e nessun residuo tombstoned; verificare
   rules live su entrambi i bucket, elenco Functions e applicazione loggata
   con account reale. Provare upload sintetico, lettura, revoca e cleanup nel
   perimetro QA autorizzato, senza modificare iscrizioni o consensi reali.

L'operazione non è una transazione unica. Un errore interrompe i passi
successivi; rileggere lo stato applicato prima di qualsiasi retry. Un deploy
con risposta persa non si considera fallito senza controllo della release.

## Dopo il passaggio

La fase C richiede il proprio piano di sincronizzazione e osservazione del
vecchio bucket. Le copie USA non vengono eliminate in B. Prima della fase E
va adeguata anche l'allowlist server dei bucket: il server transitorio tratta
l'assenza di una replica come errore, non come cleanup riuscito. Non rimuovere
prematuramente i tombstone media e non usare recursiveDelete della galleria
per cancellarli durante la transizione.

Rollback prima della rimozione USA: commit precedente su main, rules/Functions/
hosting con service worker ulteriormente aumentato, sync e URL nell'altro
verso con checkpoint distinto. Anche il rollback in produzione richiede la
conferma prevista; non cancellare file o riscrivere history per tornare indietro.

## Collaudo definitivo del candidato

Codice `main` 41a215c, tree `74c544a742af74411a07eb820a12f38319b3bf25`.
Build e 1524/1524 test client passano sullo snapshot esatto sul mini;
18/18 test adminAppOptions. Verifiche indipendenti: 44/44 test puri,
31/31 scenari diretti di transizione, 1924 test S2 e 51 Home sulle rules,
115 query SDK, 57 test HTTP consensi, 26 test HTTP camp, 8 scenari browser
Home sullo stesso snapshot, 6 guardie upload e 5 cambi contesto.
Review finale PASS con confronto hash dei sorgenti QA e candidato.

La regressione della sovrascrittura admin è stata riprodotta e corretta:
Storage mirato 25 PASS e 0 FAIL, un solo caso grande escluso perché già passato
nel contratto S2 con GALLERY_BIG_UPLOAD=1. Il primo ambiente QA del
coordinatore era privo dell'index git richiesto dal test sugli accenti:
ricostruito dal manifest tracciato con tree hash identico; il giro finale
1524/1524 è successivo alla correzione dell'ambiente.

L'emulatore Storage non applica CAS metadata e può accodare i token: non
viene usato come prova di revoca effettiva. Prova GCS reale staging con
helper SHA-256 `5da24f93c7cfc9216e9f2364dbfefe4777f5fbf584cf461ee6d3a9214fd38849`:
vecchi token 206 → 403 e nuovi 206 su entrambe le copie, retry stabile, worker
vecchio respinto da CAS, token successivo conservato. File sintetici
eliminati da entrambi i bucket, cleanup completo. Nessun dato reale usato.

Dry-run del nuovo sync sul candidato: 1196 in sorgente, destinazione e checkpoint,
1196 invariati, zero copie, patch, cancellazioni, conflitti o tombstone.
Questo controllo era readonly e precedeva la conferma del 27 ottobre.
Il candidato esporta 33 Functions da aggiornare
esplicitamente; le due callable obsolete vengono eliminate separatamente.

## Esito reale del 27 ottobre

Approvazione esplicita: «Vai avanti? Confermo». Operazioni dal clone pulito
sul mini `~/qa/gugd-rilascio-b-20261027/app`, main e origin/main uguali a
`d7c5ad68f0facf90cc696c94183d6cc0c1ec5d5b`; build EXIT0.

| Passaggio | Esito verificato |
| --- | --- |
| Appartenenze | 180 create; post dry-run zero, 139 attive/41 pending, 31 staff attivi |
| Rules | Firestore e Storage di entrambi i bucket identici al candidato via API |
| Indice feed | READY via API, query esatta riuscita |
| Functions | 33 ACTIVE; sette sorgenti critici dell'archivio live identici a main |
| Codici galleria | 31 documenti rimossi, post dry-run zero; due callable obsolete assenti |
| Hosting | v33, HTML e cinque asset serviti identici alla build |
| Migrazione URL | 3331 documenti letti, 297 aggiornati/875 campi, zero errori |
| Storage finale | VERIFY_OK, 1196/1196, zero mancanti/differenze/extra/oldRefs, cinque download 206 |
| Consenso pendente | Token presente, email invariata, nessun errore rilevato dopo rewrite |

La prima invocazione deploy Functions si è fermata prima degli aggiornamenti
per la conferma CLI della policy retry. Rilanciata con --force e sempre i
33 selettori espliciti; verificato nel planner della CLI mini 15.33 che le
due obsolete erano escluse. L'indice si è completato mentre venivano
aggiornate le Functions e prima del deploy hosting.

Verifica browser reale parziale: Home partecipante pending e blocco dei
contenuti riservati riusciti; larghezze CSS effettive 520/1632, nessun overflow.
Il login dirigente richiede passkey personale. Credenziali Google CLI non
accettate da signInWithIdp HTTP 400, prima di ogni mutazione QA: REST utente,
upload/revoca/cancellazione live restano da completare, non sono PASS. Nessun
account o ruolo creato, nessun consenso accettato.

Lo smoke media preparato usa solo prefissi sintetici con checkpoint privato.
Non crea una prima segnalazione visibile: quel ramo invierebbe push reali
agli admin anche per una galleria non pubblicata. Seed hiddenMedia/lifecycle
sintetico, trigger, ramo already_hidden e cleanup sono il perimetro autorizzato.
Nessuna scrittura di questo smoke è ancora avvenuta. C/D/E e i 41 prefissi
orfani restano fuori da B.
