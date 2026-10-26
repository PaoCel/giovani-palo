# Revoche e cancellazioni nella transizione Storage

Contratto tecnico, 26 ottobre 2026. Il server usa entrambi i bucket di
produzione, `giovani-palo-eu` e `giovani-palo.firebasestorage.app`; staging ed
emulatori usano esclusivamente il proprio bucket. Nessun nome bucket arriva
al server dal payload client.

## Ownership, query e conservazione

`stakes/{stakeId}/galleries/{galleryId}/mediaLifecycle/{mediaId}` è scritto e
letto solo da Admin SDK. Anche staff e super-admin non possono leggerlo via
SDK client. Campi: `operation` (`hide` o `delete`), `status` (`pending` o
`complete`), `rotationSeed` soltanto per hide, `createdAt`, `updatedAt`.
Nessun autore, nome o URL è duplicato. Il path contiene identificatori
pseudonimi. Le letture sono puntuali, non servono query composite né indici.
I tombstone delete restano per l'intera migrazione: rimuoverli prima della
chiusura del bucket USA consentirebbe di ricreare file cancellati. La loro
rimozione successiva richiede un'operazione esplicita di manutenzione; non
rimuovono né abbreviano la conservazione a 24 mesi di iscrizioni e PDF.

## Stati e ritorni

Segnalazione: spostamento in hidden e stato hide/pending atomici; rotazione
in entrambi i bucket, URL nascosti aggiornati, hide/complete. Un errore
Storage lascia pending: callable restituisce unavailable con stato
persistente già nascosto, trigger con retry completa l'operazione. La stessa
segnalazione può riprovare anche se il contenuto è già nascosto.
Ripristino: completa prima una revoca pending o legacy; se Storage fallisce
riceve unavailable e si può riprovare. La transazione di ripristino richiede
comunque hide/complete e risponde failed-precondition a un conflitto, senza
pubblicare vecchi URL.
Una nuova segnalazione genera un nuovo seed. I token sono HMAC del path e
seed, uguali in tutte le copie e stabili nei retry. URL estranei al bucket o
al prefisso fidato non vengono riscritti.

Cancellazione definitiva: delete/pending viene salvato prima dei file;
nessun ripristino successivo è consentito. Si eliminano tutte le varianti
in entrambi i bucket e le sottocollection del media, quindi delete/complete.
I retry tollerano oggetti e documenti già assenti. Errori parziali restano
pending e non vengono presentati come successo. La cancellazione SDK
visibile è intercettata da un trigger; uno spostamento in hidden viene
riconosciuto e non viene trattato come cancellazione definitiva.

Tutte le transizioni prendono lo stesso lock pessimista Firestore sul
documento lifecycle. Il processore mantiene il lock durante le operazioni
Storage idempotenti; restore e nuove operazioni non possono superare una
revoca ancora in corso. Trigger gen2 in europe-west1 con retry, guardia sullo
stato pending e nessuna auto-riscrittura su eventi complete.

## Sync concorrente

Lo script di migrazione controlla il tombstone prima di ogni rewrite e sua
continuazione, non soltanto durante il piano. Ricontrolla dopo la copia e la
patch metadata; se delete è sopraggiunto elimina la copia da entrambi i
bucket. Se il marker arriva dopo il controllo finale, il cleanup server
successivo trova la copia già completata. Un errore di lettura del marker
blocca la copia. Il dry-run non cancella e non scrive checkpoint.

La revoca del consenso fotografico conserva il compito per il responsabile:
il modello non identifica tutte le persone raffigurate. Le eliminazioni
eseguite dal responsabile attraversano questo cleanup. La cancellazione
account S2 conserva la sua semantica e non cancella automaticamente PDF o
iscrizioni conservati per 24 mesi.

## Fencing Storage e autorizzazione upload

Il lock Firestore da solo non rende atomico Storage: una richiesta già in
volo può sopravvivere all'abort della transazione. Ogni rotazione legge prima
generation e metageneration dell'oggetto, poi ricontrolla il seed corrente,
infine scrive i metadata con entrambe le precondizioni. Un worker superato
non può sovrascrivere una rotazione più recente. Anche il sync riconcilia il
token dopo rewrite/patch, con lo stesso ordine metadata → lifecycle → CAS.
Le continuazioni rewrite richiedono inoltre la metageneration sorgente.

Upload e aggiornamenti galleria richiedono ora appartenenza attiva anche
per lo staff: documento member più lifecycle, entro il limite ufficiale di
due documenti Firestore per valutazione Storage Rules. Il fallback di ruolo
nel profilo resta valido per lettura e moderazione; uno staff/super-admin
senza appartenenza nel palo non carica file in quel palo. Il piano S2 include
tutti i 31 profili staff correnti. I client non possono aggiungere varianti
né ricreare un ID che abbia lifecycle, anche dopo restore; il media
ripristinato conserva le varianti originali. Un nuovo caricamento usa un ID
nuovo. Fonte del limite: https://firebase.google.com/docs/rules/rules-behavior.

Il sync aggiornato può eliminare anche la copia sorgente USA quando esiste
un tombstone delete. Il dry-run espone mediaDeleted, tombstoneSourceDeletes
e tombstoneDestDeletes; --max-deletes limita il numero di path oggetto
coinvolti, ciascuno con al massimo due copie, insieme alle normali
cancellazioni dalla destinazione. Lo stesso tetto blocca tombstone arrivati
durante la copia. Questa versione non va descritta come sincronizzazione
che scrive soltanto nella destinazione: l'applicazione richiede la conferma
prevista per migrazioni e cancellazioni.

## Costo operativo

La rotazione legge due elenchi di oggetti e, per ciascuna variante presente,
legge i metadata e li aggiorna in ciascun bucket. Il controllo del seed
aggiunge una lettura puntuale lifecycle per variante; transazioni e retry
possono ripetere letture e scritture. Il sync aggiunge una lettura lifecycle
per path media nel piano e controlli puntuali durante ogni mutazione; non
scarica i contenuti né elenca account o iscrizioni. Nessuna query periodica
in background viene aggiunta al client.

Il target Storage `main` in `.firebaserc` comprende entrambi i bucket:
il deploy B applica le regole con gate lifecycle anche al vecchio bucket.
La configurazione separata della fase A continua a indicare soltanto EU.

## Verifiche del 26 ottobre

44 test puri indipendenti helper/sync e 31 scenari diretti su
Firestore/Auth/Storage emulati passano senza salti. I puri sono stati
rieseguiti anche dall'autore del codice sul mini. Gli scenari diretti
comprendono ruoli SDK, retry e concorrenza, firme/PDF nuovi e copiati,
CLI reale per tombstone dest-only, dry-run, tetto cancellazioni,
verifica dei residui, ripetizione idempotente e risposta 503 simulata dopo
rewrite applicata, con controllo del numero di tentativi mutanti.

Il controllo di protocollo rileva `CAS_ENFORCED=false` nell'emulatore
Storage: non prova l'efficacia delle precondizioni in produzione. La
verifica indipendente del coordinatore su soli file sintetici staging
conferma invece vecchi token 403, nuovi token 206 in entrambi i bucket,
worker superato bloccato e token più recente conservato. Questa prova non
è un deploy di produzione.

Review indipendente del codice server: finding obbligatori chiusi;
verifiche integrate S2/home/camp e browser in corso al momento di questo
aggiornamento. La verifica dell'intero pacchetto e il deploy B restano
separati dall'accettazione di questo incremento.

La finalizzazione del sync avviene anche quando la copia restituisce un
errore: una risposta fallita non dimostra che GCS non abbia applicato la
richiesta. Ogni retry HTTP di rewrite/PATCH ricontrolla il marker; dopo un
errore con effetto possibile si eliminano le copie tombstoned oppure si
riconcilia il token con il seed corrente, quindi si riporta l'errore se
l'operazione non risulta conclusa. L'admin attivo conserva il permesso di
sovrascrittura precedente anche quando l'SDK presenta l'operazione come
create; il gate lifecycle resta obbligatorio.
