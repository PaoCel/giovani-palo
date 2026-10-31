# Programma essenziale: primo incremento

27 ottobre 2026. Integra PROGRAMMA_A_MOMENTI e ATTIVITA_MODULARI.
Perimetro confermato dal coordinamento, con secondo parere indipendente.
Nessun deploy o migrazione è incluso in questo incremento.

## Ambito

Momenti `info` (Solo informazione) e `turni` (Attività con iscrizione), con
un solo slot e un posto per partecipante. Il tipo resta immutabile dopo il
primo salvataggio, anche in bozza; l'avviso compare prima del salvataggio.
Prima si può cambiare tipo conservando titolo, luogo e orari, oppure uscire
senza creare documenti. I posti compaiono soltanto per Attività con iscrizione.

Authoring e nomi degli iscritti solo per admin/super-admin del palo già
verificati nel profilo. Nessun permesso deriva dalla categoria dichiarata.
La delega specifica e l'elenco staff attività arrivano in un altro incremento;
lo staff RecordNight e quello sanitario non concedono privilegi al programma.
Pubblico iniziale fisso registered: iscritti e loro genitori, oltre agli admin.
Pubblico anonimo, membri senza iscrizione, teaser e pubblicazione programmata
restano successivi. RecordNight resta il modulo esistente, senza doppioni.
Il testo event.program resta integro come «Programma generale», anche quando
ci sono momenti: può contenere condizioni e informazioni del PDF firmato non
replicate nei momenti. Il nuovo blocco partecipante si chiama «Appuntamenti e
iscrizioni»; l'admin legge che gli appuntamenti affiancano il programma
generale. Nessuna scomparsa asincrona del testo e nessuna nuova proiezione.

## Ownership e query, prima del codice

Percorso `stakes/{s}/activities/{a}/moments/{m}`: scritto solo dal server,
con tipo, titolo (1–80), descrizione (0–600), luogo (0–80), startsAt/endsAt
ISO con offset, startsAtTs/endsAtTs Timestamp, stato draft/published/hidden,
audience registered, visibleFromTs sempre Timestamp, participation null per
info o mappa opensAtTs/closesAtTs/maxPerPerson=1/moderation=none/showTitles=false,
slots con un solo elemento id main/label/capacity/taken per turni, summary
entryCount e totalEntries (storico degli ID, anche dopo rinuncia), revision intera, createdAt/updatedAt e createdBy. La capienza è
un intero positivo. Campi non supportati rifiutati, mai eliminati implicitamente.

`moments/{m}/entries/{registrationId}`: scritto solo dal server, chiave
stabile per partecipante per evitare doppioni tra retry. ownerUids, riferimento
registrationId, slotId main, stato approved/withdrawn, motivo di ritiro,
revisione intera, requestId/azione dell’ultima modifica, date e istantanee del titolo/orario per il solo contesto proprietario. Nessun
dato sanitario e nessun nome duplicato: i nomi del roster sono letti dalle
iscrizioni soltanto dopo la verifica dei privilegi admin.

Tutti i get/list/write SDK dei nuovi percorsi sono negati esplicitamente.
In questo incremento il client usa le callable momentsAdmin e
momentsParticipant, con contesto server già filtrato. Non si finge che la
proiezione access o i registrationLinks di S3 esistano già.
Query limitate a palo/attività: elenco moments, figli registrations where
parentUid == uid, entries where ownerUids array-contains uid per momento.
Scritture, capienze, proprietà e revoche sono ricontrollate in transazione.
Per il cleanup account è necessaria la query collection-group entries per
ownerUids (indice esplicito); i path estranei a moments restano esclusi.
Nessuna collezione globale di iscritti viene scaricata dal client.

Fencing della cancellazione: `activities/{a}/momentDeletions/{momentId}`
conserva solo deletedAt Timestamp server, senza titolo, nome, UID o contenuto.
La cancellazione di una bozza vuota crea la ricevuta nella stessa transazione
che elimina il momento. Una create controlla l'assenza della ricevuta nella
propria transazione: un retry vecchio non può ricreare quell'ID. Ogni save
controlla la ricevuta anche se un momento è stato ripristinato accidentalmente
da strumenti esterni, senza riabilitare il riuso dell'ID. Il client deve
iniziare esplicitamente un momento nuovo, con ID nuovo. Un retry delete sul
momento assente resta idempotente e non riscrive la ricevuta. Se la ricevuta
non esiste ancora, delete la crea anche per un ID assente, impedendo che una
create ancora in volo applichi una richiesta ormai annullata. Tutti gli accessi
SDK alla ricevuta sono negati; non contiene riferimenti personali e non
richiede cleanup account. Il cleanup dell'attività elimina anche queste
ricevute, a lotti con controllo transazionale che l'attività non sia ricreata.
Nessun TTL: il fencing deve restare valido per tutta la vita dell'attività.
Le ricevute non entrano nel conteggio massimo di 50 momenti; costo aggiuntivo
di una lettura per save/delete, una scrittura per prima cancellazione dell'ID.

Self e figli riusano identificazione e nomi del contesto RecordNight;
registrazioni ammesse: active, confirmed, pending_parent_authorization.
Per compatibilità con il mapper esistente, registrationStatus assente o null
è legacy attivo, purché status non sia cancelled. Valori espliciti sconosciuti,
submitted, waitlist, draft, cancelled e rejected_by_parent restano esclusi;
una stringa vuota non è un'assenza. RecordNight conserva la propria semantica.
Il genitore può agire solo sui figli con parentUid proprio e ID child proprio;
non basta indovinare un ID. La lettura registered non richiede appartenenza
al palo a un genitore che gestisce già un'iscrizione autorizzata.

## Stati, superfici e ritorni

| Stato | Admin | Partecipante e ripensamento |
| --- | --- | --- |
| Non salvato | Titolo, quando, tipo; opzioni su richiesta | Annulla/Indietro conserva i campi finché non si conferma Scarta; nessun doc creato |
| Bozza | Modifica, Anteprima, Elimina bozza vuota | Non visibile; eliminazione solo senza partecipazioni, conferma esplicita |
| Anteprima | Come appare e chi può iscriversi; Pubblica oppure torna a modificare | Nessun effetto finché non si pubblica |
| Pubblicato | Modifica, Nascondi; bozza soltanto senza partecipazioni | Info oppure posti e Iscriviti; persona self/figlio scelta esplicitamente se più di una |
| Nascosto | Rendi visibile senza perdere dati o iscritti | Niente nuova adesione; chi aveva aderito conserva stato privato e può rinunciare |
| Non iscritto | Elenco e posti anonimi | Iscriviti occupa un posto in transazione; doppio tocco/retry non duplica |
| Iscritto | Nome nel roster privato, conteggio aggiornato | Rinuncia con conferma, poi Iscriviti di nuovo se finestra e posti lo consentono |
| Ritirato | Storico conservato | Riprendi iscrizione ricontrolla finestra e capienza, nessun posto promesso prima del server |
| Scaduto/pieno | Può modificare finestra/capienza senza scendere sotto gli iscritti | Stato comprensibile, nessuna perdita del resto dell'iscrizione all'attività |
| Rete/errore/conflitto | Bozza intatta, ricarica server prima di sovrascrivere | Nessun successo anticipato; contesto e persona restano, esito riletto dal server |
| Cambio account/palo/attività | Risultati e modali del vecchio contesto invalidati | Nessun nome, bozza, selezione o risposta tardiva attraversa il contesto |

L'annullamento dell'iscrizione principale ritira le adesioni; il ripristino
ricontrolla capienza/finestra. La cancellazione dell'attività elimina anche
momenti e sottocollezioni. La cancellazione account rimuove ownerUids e ritira
le adesioni pertinenti, conservando il riferimento storico secondo la policy
vigente per le iscrizioni; non cancella PDF né documenti sanitari.

## Finitura e prove

Gerarchia del programma come agenda per giorno, token blu/sabbia e
Manrope/Fraunces del progetto. Un segno illustrato dell'agenda con pagine e
segnalibro riusa forme e palette proprie, senza emoji né icone decorative di
libreria. Campi 16 px, secondari almeno 13 px, target 44 px, modali esistenti,
nessun overflow 320/390/430. CTA e ultimo campo visibili con safe area.
Mockup persistenti in .claude/mockups/momenti/, poi confronto alla stessa
scala con schermate reali nel browser loggato sul backend demo.

Test da autore distinto e review indipendente devono coprire ownership,
revoca, due pali, query SDK negate, limite/capienza concorrente, retry,
rinuncia/ripristino, attività cancellata e account cancellato, più flusso
mobile reale e recupero del conflitto. I dati reali non sono usati nei test.

Scelte tecniche del primo incremento: apertura predefinita dalla pubblicazione,
chiusura all'inizio del momento; participation.customWindow distingue le
finestre scelte dall'admin dai default da aggiornare se cambia l'orario.
La fine facoltativa assente coincide con l'inizio (appuntamento a un orario,
nessuna durata inventata). Roster admin solo iscritti attuali approved;
le rinunce restano nello storico privato e non spariscono dai dati.
Un'attività draft/cancelled non concede nuove adesioni né il programma
pubblicato; gli eventuali stati propri si leggono come non disponibili.

## API e verifiche indipendenti

Entrambe le callable richiedono account non anonimo e profilo esistente.
Envelope comune: action, stakeId, activityId; nessun UID, nome, slotId o
contatore fornito dal client viene usato come prova di proprietà.

- momentsAdmin.context → {moments}; solo admin/super-admin autorizzato.
- momentsAdmin.save → aggiunge momentId, requestId, expectedRevision (null
  per nuova bozza), fields {type,title,startsAt,endsAt?,place?,description?,
  capacity?,customWindow?,opensAt?,closesAt?}. Le date hanno offset esplicito;
  capacity è obbligatoria solo per turni (1–2000). La finestra custom richiede
  entrambe le date. Risposta {moment} aggiornata dal server.
- publish/hide/show/draft/delete usano momentId, requestId e expectedRevision.
  delete restituisce {deleted:true,moment:null}; è idempotente anche dopo il
  timeout. Draft/delete richiedono assenza di qualunque entry, comprese quelle
  ritirate; delete solo draft/hidden. publish parte da draft, show da hidden.
  Una save create su ID cancellato risponde failed-precondition con
  details.reason=moment_deleted; la bozza locale non viene inviata con un ID
  nuovo automaticamente. Ricarica programma chiude la bozza non più presente.
- roster usa momentId e restituisce {entries:[{registrationId,displayName,
  status:approved}]}; nessun dato sanitario o nome fuori dal roster attivo.
- momentsParticipant.context → {serverNow,people,moments}; people include isSelf e
  eligible, anche per spiegare un'iscrizione principale non più attiva. I
  momenti pubblicati sono completi solo per chi ha un'iscrizione ammessa o è
  admin; le proprie entry di momenti non disponibili usano titolo/orario
  già ricevuti, senza rivelare nuove modifiche nascoste.
- join/withdraw usano momentId, registrationId, requestId ed expectedRevision
  della entry (null se assente), restituiscono {entry} inclusa revision.
  Una join già approvata o una withdraw già ritirata non cambiano il contatore.
  Il retry di un ripristino verifica sempre finestra, proprietà e capienza.

Factory per test: createMomentsAdminHandler({db,clock}) e
createMomentsParticipantHandler({db,clock}); clock restituisce Date.
Helper esposti: reconcileMomentRegistration(db,ids,clock?),
cleanupMomentsForUser(db,auth,uid), cleanupDeletedMomentsActivity(db,ids).
Pure in momentsCore.js: parseMomentFields, parseMomentRequest,
isMomentRegistrationActive, registrationOwnerUid, requestFingerprint,
isParticipationOpen; limiti MAX_MOMENTS=50, MAX_CAPACITY=2000, MAX_PEOPLE=100.

Errori: invalid-argument per payload/tipo/date/chiavi/revisione invalida;
permission-denied per ruolo o proprietà; unauthenticated senza login;
aborted per revisione superata; failed-precondition per stato/finestra o
capienza sotto gli iscritti; resource-exhausted per posti/momenti esauriti.
Nessuna transazione fallita modifica entry o conteggi. Il client mantiene
bozza e requestId su timeout e rilegge il server: uscire non annulla una
richiesta che può essere già stata applicata.
Se la risposta di salvataggio è riuscita e fallisce soltanto la rilettura,
l'interfaccia conferma l'operazione salvata e chiede di ricaricare, senza
descrivere l'esito come incerto o ripetere la mutazione.

## Costo e limiti

Nessun polling di rete: rilettura al montaggio, ritorno in primo piano e dopo
un'azione. I timer locali aggiornano soltanto l'indicazione della scadenza.
Un contesto legge profilo, attività, propria iscrizione, query figli, momenti
(max 50) e una query delle proprie entry per momento. Solo l'admin apre su
richiesta il roster, con al massimo 2000 iscritti attivi; i nomi non arrivano
negli altri contesti. Le query dei figli sono limitate a 101 risultati per
rilevare il superamento di 100. Cleanup account e attività a lotti da 200,
riprendibili; nessun elenco di tutti gli utenti è letto dal client.

Il contesto restituisce serverNow: il client avanza l'orario tramite clock
monotono, non usa l'orologio del telefono come prova che una finestra sia
aperta. Il server ricontrolla sempre al momento dell'azione.

Le entry hanno revision monotona: un vecchio tentativo di rinuncia ritentato
dopo un ripristino più recente risponde aborted e non ritira il nuovo posto.
Anche i cambi di sistema incrementano la revisione soltanto quando cambiano
lo stato effettivo; le consegne duplicate non la fanno avanzare a vuoto.

## Ordine di rilascio

Dopo test, review, integrazione e conferma fresca: prima firestore.rules e
l'indice collection-group entries.ownerUids, poi le cinque Functions
momentsAdmin, momentsParticipant, onMomentRegistrationChanged,
onMomentsActivityDeleted e onMomentsUserDeleted; infine hosting con service
worker incrementato dalla versione effettivamente pubblicata. Nessuna
migrazione delle attività o dei record esistenti è richiesta.
