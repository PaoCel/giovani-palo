# Attività configurabili senza assistenza tecnica

Requisiti di Paolo del 26 ottobre 2026. Task: `gugd-attivita-modulari`.
Integra [PROGRAMMA_A_MOMENTI.md](PROGRAMMA_A_MOMENTI.md) e
[AUTONOMIA_MULTI_PALO.md](AUTONOMIA_MULTI_PALO.md).

## Decisioni

Un admin di un altro palo deve organizzare un'attività dall'app senza
interventi di Paolo sui dati. La home dei giovani deve diventare un feed:
il lavoro resta in `gugd-home-social`. FSY è una prospettiva futura, non
autorizza a cambiare adesso il modello GU/GD o a copiare dati reali in demo.

- Poche informazioni essenziali per iniziare, salvando una bozza non pubblica.
- Opzioni aggiuntive su richiesta dell'organizzatore, anche subito.
- Sottoattività con propria partecipazione: la serata dei record dentro un
  viaggio è il caso concreto, da integrare senza rompere i link esistenti.
- Comitati con nome, persone e cosa devono fare.
- Gruppi con nome configurabile (gruppi, compagnie, team, squadre) e iscritti.
- Alloggi con condizioni, stanze e posti configurabili dall'app; importare un
  file deve restare facoltativo.
- Gestione anche da un responsabile esplicitamente delegato all'attività.
  La categoria autodichiarata dirigente/accompagnatore non dà permessi.

La richiesta aggiorna M5 della spec Programma: il responsabile può configurare
ciò che gli viene delegato. Il contratto della delega va scritto prima del
codice server. L'accesso ai dati sanitari resta un permesso separato.

## Percorso e ritorni, prima dei mockup

1. Inizia da nome, tipo, date e luogo, verificando cosa richiedono davvero
   validatori e rules per una bozza. Nessuna data o scelta inventata per
   superare la validazione; modulo d'iscrizione e stanze non obbligatori.
2. Dalla gestione della bozza aggiungi solo quello che serve: programma,
   iscrizioni, comitati, gruppi, alloggi.
3. Controlla l'anteprima e cosa manca per pubblicare.
4. Pubblica con un'azione esplicita e un effetto spiegato. Salvare un modulo
   non deve pubblicare implicitamente l'attività.
5. Gestisci dati e assegnazioni dall'app, con salvataggi e conflitti chiari.

| Stato / superficie | Destinazione | Ripensamento ed errore |
| --- | --- | --- |
| Creazione non salvata | Crea bozza e apre la gestione | Uscita con conferma di scarto, campi conservati su errore, retry senza doppioni |
| Bozza salvata | Riapri, completa, anteprima | Esci e ritrova la stessa bozza; nessuna pubblicazione automatica |
| Modulo non attivo | Configura su richiesta | Torna indietro senza dati parziali né pubblicazione |
| Modulo con partecipazioni | Modifica o sospendi | Nessuna cancellazione implicita; riattivazione conserva dati e ricontrolla compatibilità |
| Attività pronta | Anteprima e Pubblica | Torna a modificare; doppio tocco non duplica gli effetti |
| Attività pubblicata | Modifica la configurazione scelta | Un altro salvataggio non ripristina valori vecchi; annullare non cancella firme/iscrizioni |
| Partecipazione interna | Iscrivi, sposta, ritira | Ripristino se posti/scadenze lo permettono, altrimenti motivo comprensibile |
| Comitato / gruppo | Crea, rinomina, assegna | Scarta modifiche non salvate; eliminare un gruppo non elimina gli iscritti |
| Piano stanze | Bozza, assegna, comunica | Salva o scarta all'uscita, ritira comunicazione, ricarica dopo conflitto |
| Delega | Admin sceglie persona e ambito | Revoca applicata dal server; cambio account/attività chiude il contesto precedente |

## Ownership, visibilità e query

Questi sono requisiti; lo schema e le query esatte di ogni modulo devono
essere specificati e provati prima dell'implementazione.

| Dati | Gestisce | Legge |
| --- | --- | --- |
| Attività / bozza | Admin del palo, poi responsabile delegato | Bozza secondo i permessi staff esistenti; pubblicata secondo il pubblico scelto |
| Momenti / partecipazioni | Organizzatori e titolare della partecipazione | Secondo pubblico e stato della spec Programma; nomi solo staff autorizzato |
| Comitati / gruppi | Organizzatori con permesso pertinente | Iscritto vede ciò che lo riguarda; elenchi completi con permesso esplicito |
| Stanze / condizioni / assegnazioni | Oggi solo admin, come ROOM_MANAGEMENT | Piano completo solo autorizzati; partecipante solo la propria stanza |
| Dati sanitari / firme | Permessi esistenti separati | Nessun accesso automatico da delega al programma o ai gruppi |

Query ristrette al palo e all'attività. Nuovi path/campi richiedono rules,
allowlist, indici e cleanup nello stesso blocco. Posti e contatori sono
mantenuti dal server. Nessuna scrittura di collaudo in produzione.

## Blocchi di consegna

1. Completare le verifiche S2 di Persone e appartenenza e preparare il rilascio.
2. Creazione essenziale, bozza persistente e ritrovabile, opzioni su richiesta,
   anteprima e pubblicazione esplicita. Primo incremento senza nuovi campi o
   collection: la bozza viene salvata nel modello esistente.
3. Programma con momenti informativi e iscrizioni; adattatore per i record.
4. Comitati con incarichi, gruppi dal nome configurabile, alloggi configurabili;
   estendere i percorsi attuali preservando gli eventi esistenti.
5. Delega al responsabile, recuperi amministrativi S4 e collaudo a due pali.

Home social progettata in parallelo, rilascio subordinato a S2 e al contratto
di visibilità. Pubblicazione libera dei giovani richiede moderazione,
segnalazioni e ritorni specificati; non è implicita nella richiesta di feed.
Ogni deploy o migrazione in produzione richiede conferma fresca di Paolo.

## Criteri di accettazione

Un admin sintetico di un secondo palo, da telefono e senza console/script:

- crea una bozza, la ritrova, configura solo ciò che serve, pubblica dopo
  l'anteprima e corregge una scelta sbagliata;
- aggiunge una serata con posti e partecipazioni e gestisce un ritiro;
- crea un comitato con incarico e una squadra, sposta un iscritto e corregge
  l'assegnazione senza cambiare iscrizione e consensi;
- inserisce stanze e disponibilità, corregge capienza, prepara un piano e
  comunica a ogni partecipante soltanto la sua stanza;
- delega un responsabile: permessi, revoca, account diverso e palo diverso
  verificati anche con chiamate dirette;
- supera vuoto, caricamento, rete assente, doppio tocco, ritorno e conflitto;
  collaudo a 320/390/430 e confronto con mockup dai token reali.

## Precisazioni della review del 26 ottobre

- Le bozze oggi sono leggibili anche dai dirigenti di unità: primo incremento
  con i permessi esistenti. Un futuro perimetro limitato ai soli organizzatori
  richiede una verifica esplicita con S2 e i client già in uso.
- Chiudere le nuove iscrizioni, nascondere e annullare un'attività sono azioni
  diverse. Per ciascuna va specificato cosa vede chi ha il link o è già
  iscritto, e come riaprire. Il primo incremento non introduce stati nuovi né
  promette un ripristino automatico delle partecipazioni.
- Prima del modulo gruppi/comitati, definire cardinalità delle appartenenze e
  distinguere incarico e permesso. La rimozione mostra le assegnazioni
  coinvolte e consente riassegnazione o ripristino senza toccare le iscrizioni.
- Ridurre la capienza sotto gli occupanti produce un conflitto da risolvere,
  senza espulsioni automatiche. Distinguere revisione preparata e comunicata;
  correggere una comunicazione già ricevuta richiede una nuova indicazione,
  non una promessa di cancellare la mail precedente.
- Contratto della delega prima dei moduli: ambiti, durata, pubblicazione,
  comunicazione e possibilità di ulteriore delega. Revoca durante un
  salvataggio: rifiuto server comprensibile, nessuna scrittura parziale,
  lavoro recuperabile dall'admin.

## Verifiche attuali

26 ottobre: recuperati task, spec, editor e documentazione comitati/stanze.
L'audit iniziale ha trovato la pubblicazione automatica al salvataggio del
modulo (`AdminEventEditorModal.handleSaveForm`). Il primo incremento qui sotto
la sostituisce con anteprima e pubblicazione esplicita; gli altri moduli
restano da implementare.

## Primo incremento: creazione e pubblicazione (26 ottobre)

Stati e ritorni definiti prima del layout:

| Superficie / stato | Azione | Ritorno e recupero |
| --- | --- | --- |
| Nuova attività, non salvata | Nome, tipo, inizio/fine, luogo; Crea bozza | Chiudi chiede se scartare; Continua a modificare conserva tutti i campi |
| Creazione in corso | Un solo invio, id mantenuto anche al retry | Chiusura bloccata durante la scrittura; errore nel foglio e dati conservati |
| Bozza salvata, riepilogo | Personalizza, Modulo d'iscrizione, Controlla e pubblica | Esci dalla bozza apre la scheda; stessa attività ritrovabile nell'elenco admin |
| Personalizzazioni non salvate | Editor esistente, facoltativo anche subito | Indietro/Chiudi chiede scarto; annulla conserva la sessione; salva torna al riepilogo |
| Modulo non salvato | Configura solo se serve | Salva torna al riepilogo, resta bozza; uscita chiede scarto, nessuna pubblicazione |
| Anteprima | Descrizione e finestra iscrizioni ancora mancanti, riepilogo pubblico, requisiti | Torna alla bozza senza scritture; chiudi conserva la bozza salvata |
| Pubblicazione in corso / errore | Pubblica attività dopo riepilogo | Invio unico; errore nello stesso foglio, retry; niente effetti di salvataggio modulo |
| Pubblicata / modifica | Salva mantiene visibilità e stato | Nessuna riapertura implicita di attività concluse o annullate |

Audit minimo: il client normalizza stringhe vuote per descrizione e finestra
iscrizioni; le rules di activities/config autorizzano gli admin del palo senza
richiedere questi valori per una bozza. Nessuna nuova collection, campo o query.
La bozza usa date reali scelte dall'admin e stringhe vuote per le informazioni
rimandate. Pubblicare richiede descrizione e finestra iscrizioni esplicite.
La creazione attuale prepara già un modulo dai valori del palo: si mantiene
questo comportamento e lo si riassume prima di pubblicare; nessun nuovo backend
modulare. Lettura bozza: admin e dirigenti secondo le rules esistenti; non
pubblica per partecipanti/ospiti. La restrizione ai soli organizzatori richiede
un blocco rules separato, da coordinare con S2 prima del rilascio.

Finitura: token blu/sabbia e Fraunces/Manrope esistenti, logo originale;
controlli da 44 px, campi 16 px, un solo scroll nel foglio, nessun overflow a
320/390/430. Anteprima informativa nel foglio, nessun link pubblico per la bozza.

### Consegna del primo incremento

Implementazione sul branch `codex/gugd-creazione-essenziale`, da integrare con
S2; nessun deploy. La creazione richiede solo i cinque dati essenziali;
descrizione, pubblico, programma e finestra iscrizioni si possono aggiungere
subito o in seguito. Il modulo predefinito del palo viene preparato insieme
alla bozza, senza passaggi obbligatori di configurazione.

- «Salva modulo» conserva lo stato dell'attività; «Pubblica attività» compare
  dopo un riepilogo di informazioni pubbliche, modulo e requisiti.
- Bozza e modulo vengono creati nello stesso batch; anche i salvataggi del
  modulo sono atomici e aggiornano la revisione dell'attività. La pubblicazione
  ricontrolla quella revisione in transazione. Un altro admin che modifica i
  dati o il modulo dopo l'anteprima obbliga a rivederla.
- Il retry dopo timeout attende la stessa richiesta; la creazione mantiene
  lo stesso id. Cambiare account o attività scarta gli esiti della sessione
  precedente. L'uscita con modifiche non salvate chiede se scartarle.
- Il file della locandina salvata resta valido se si scartano le modifiche;
  vengono rimossi solo i nuovi upload abbandonati, preservando quelli inclusi
  in una scrittura ancora in attesa.
- Una bozza con finestra iscrizioni vuota si riapre senza errori; corretto
  anche l'overflow della hero della scheda admin che disallineava il modale
  a 320 px. Le note pubbliche distinte dal programma e le opzioni del modulo
  restano separate nei salvataggi successivi.

Compatibilità: lo stato memorizzato dopo la pubblicazione resta
`registrations_open`, come richiesto dalle rules e dal percorso d'iscrizione
attuali; disponibilità e badge tengono conto della finestra scelta. Non
introdurre `registrations_closed` per un'apertura futura senza adattare tutto
quel contratto. Il fallback di lettura `/events/{id}` resta; questo incremento
non migra eventuali attività presenti solo nel percorso legacy.

Verifica del 26 ottobre: suite client, build, browser sintetico con secondo
palo su Auth/Firestore emulati a 320/390/430, confronto con mockup e screenshot
prima/dopo. Prove separate di atomicità, locandina con servizio simulato,
rete assente, timeout, doppio tocco, cambio account e modifiche concorrenti.
Review indipendente del diff; nessuna prova con account/dati di produzione.
Artefatti locali ignorati: `.claude/qa-creazione/`.

### Verifica d'integrazione del primo incremento

Durante l'integrazione sono stati corretti due rilievi della review:
un editor con dati vecchi non può più riportare in bozza un'attività pubblicata
da un altro admin, e il cambio fra tipi non standard conserva i requisiti già
personalizzati. Attività e modulo si salvano nella stessa transazione con
verifica della revisione; il modulo mantiene allineate le opzioni di accesso
già presenti sull'attività. La revisione ISO esistente cresce anche con
salvataggi nello stesso millisecondo o con clock del client arretrato.

Apertura dell'editor e recupero dopo conflitto rileggono dal server, prima
l'attività e poi il modulo: le letture cache-first restano per la consultazione.
Una prova di recupero aveva trovato la revisione vecchia in cache dopo la
modifica del modulo; risolto senza indebolire l'asserzione sui dati concorrenti.

Verifiche sul mini in QA isolata: 1372 test client, build TypeScript/Vite,
66 controlli del percorso UI a 320/390/430 e 4 scenari permanenti con servizi
reali su Auth/Firestore emulati. Tutti verdi. Test correttivi scritti da
un agente diverso dall'autore; review indipendente delle correzioni senza
rilievi obbligatori. Nessun test usa dati o backend di produzione.

Errori iniziali corretti: build con TS2345/TS2349 sulle firme dei tipi;
primo runner concorrente con «L'attività è cambiata durante la modifica»
alla rilettura cache-first. Esiti finali build e runner: EXIT=0. Prove,
log e screenshot conservati in `.claude/qa-integrazione-creazione/`.


## Secondo incremento: comitati e denominazione dei gruppi

26 ottobre: estensione del piano campeggio esistente, senza concedere nuovi
permessi né cambiare le assegnazioni. Per questo blocco i cinque ID storici
restano stabili: crearne di arbitrari richiede prima l'adattamento dei mapper
iscrizioni e dei client precedenti. Programma con partecipazioni, altri tipi
di attività, delega e alloggi restano nei blocchi successivi.

### Contratto dati prima dell'implementazione

Percorso invariato `stakes/{s}/activities/{a}/management/camp`:
`groupLabel` sceglie `pattuglia`, `gruppo`, `compagnia`, `team` o `squadra`;
`committees[].responsibilities` è testo facoltativo, massimo 600 caratteri,
`title` resta il titolo esistente (1–80 caratteri). Nessun incarico attribuisce
privilegi. Gli ID e la cardinalità già prevista (un comitato e un gruppo per
persona) restano invariati. I documenti precedenti hanno incarico vuoto e
terminologia Pattuglia. Le callable ricevute da client precedenti conservano
le nuove opzioni e le liste delle persone assenti nel payload, invece di azzerarle.
Le liste vuote esplicite svuotano le assegnazioni del singolo comitato; un
comitato omesso conserva tutti i suoi dati.

Chi scrive: lo staff campeggio già autorizzato da `campManagementSave`,
compresi admin e dirigenti di unità del palo, con gli stessi controlli server.
Chi legge: staff e titolari già ammessi al piano dalle rules esistenti. La
scheda personale mostra il proprio comitato e incarico; il piano completo
resta leggibile dagli iscritti come prima, non si introduce una nuova promessa
di riservatezza sugli incarichi. Nessun nome o dato sanitario aggiunto.
Query invariata: lettura singola `management/camp`; niente nuovi indici.
La allowlist del documento ammette `groupLabel`; nessuna nuova collection.
La cancellazione account conserva il contratto già vigente per le iscrizioni;
i nuovi campi sono configurazione dell'attività e non contengono uid.

Il client nuovo invia la revisione vista, anche per il primo piano assente.
Il server confronta e aggiorna `updatedAt` in transazione. Un salvataggio
vecchio non sovrascrive il nuovo piano. Le sincronizzazioni delle proiezioni
sulle iscrizioni restano a lotti: ogni lotto controlla che la revisione sia
ancora quella appena salvata, così un salvataggio superato non ripristina
le vecchie assegnazioni. Non si promette una transazione unica oltre 500 doc.
Se la sincronizzazione fallisce dopo il commit, la callable dichiara esplicitamente
`planSaved: true`: il client avvisa che il piano è salvato ma le assegnazioni
vanno controllate, offre rilettura server e mantiene l'avviso nella sessione
fino a un nuovo salvataggio completo. Non viene promesso rollback dei lotti.
Il payload legacy senza `expectedUpdatedAt` resta compatibile e conserva il
comportamento di ultima scrittura prevalente sul piano. Anche le scritture
dirette dello staff già ammesse dalle rules restano compatibili: non passano
dalla transazione della callable e non beneficiano della nuova guardia di
concorrenza. La protezione dell'editor vale per i client nuovi; non promette
il rifiuto dei salvataggi obsoleti iniziati da client precedenti. I privilegi
restano quelli esistenti. Letture per modificare e recupero conflitti
vengono dal server. Una revoca viene ricontrollata al salvataggio.

### Stati, ritorni e finitura

| Superficie / stato | Azione | Ritorno e recupero |
| --- | --- | --- |
| Riepilogo comitati | Apri comitato; scegli denominazione gruppi | Campi facoltativi, nessun nuovo passo prima della creazione attività |
| Comitato in modifica | Titolo e Cosa deve fare, poi persone | Chiudi conserva la bozza nel piano; testo esplicito, nessun salvataggio implicito |
| Piano modificato | Salva modifiche oppure Scarta modifiche | Scarta chiede conferma e ripristina il piano salvato, iscrizioni intatte |
| Salvataggio in corso | Un invio per contesto | Pulsanti disattivati; timeout conserva la richiesta per il retry |
| Rete / errore | Riprova con gli stessi dati | Bozza intatta, nessun messaggio di successo anticipato |
| Conflitto | Ricarica piano salvato con conferma di scarto | Bozza conservata finché si conferma, niente overwrite della revisione nuova |
| Vista personale / export | Titoli, incarichi e denominazione aggiornati | Nessun nuovo controllo di ruolo, dati sanitari esclusi |

Finitura: token blu/sabbia, Manrope e Fraunces del progetto, nessuna emoji
nelle superfici modificate; simboli testuali del comitato dalle iniziali.
Target 44 px, campi 16 px, testo secondario almeno 13 px, nessun overflow
320/390/430. Mockup e confronto reale in `.claude/mockups/moduli-camp/`.


### Verifica del secondo incremento (in corso)

Implementati titolo e incarico dei cinque comitati storici, denominazione dei
gruppi nell'admin, nella scheda personale, nella vista del dirigente e nell'Excel.
L'Excel include anche comitati e gruppi vuoti, così l'incarico non sparisce se
nessuna persona è ancora assegnata. Emoji rimosse dalle card modificate; restano
gli ID e i campi delle assegnazioni già esistenti.

Il salvataggio confronta la revisione sul server, rilegge i privilegi in ogni
transazione e protegge ciascun lotto delle proiezioni dalla sovrascrittura di
un salvataggio superato. Un'iscrizione cancellata durante il salvataggio non
viene ricreata. Client vecchi senza revisione restano compatibili; config nuova
e comitati omessi si conservano. Un errore dopo il commit del piano dichiara
che il piano è stato salvato e che le assegnazioni vanno controllate.

Collaudo sul mini, copia e porte dedicate `demo-camp-config`: build TypeScript/
Vite verde, 39 controlli browser reali su 320/390/430 (due admin, conflitto,
scarto/ripensamento, navigazione protetta, titolo vuoto, iscrizioni intatte,
vista giovane e denominazione dei gruppi), 14 regressioni esistenti staff
campeggio e 55 controlli accenti verdi. Confronto mockup/app e screenshot
preservati in `.claude/mockups/moduli-camp/`.
Suite client finale: 1479/1479, zero skip, build verde. Test indipendenti:
64/64 puri helper/copy e 26/26 emulati, zero salti, compresa concorrenza su
501 iscrizioni ed errore di proiezione dopo il commit. I 17 casi SDK diretti
verificano allowlist, cinque denominazioni, payload legacy, valori invalidi,
lettura dell'iscritto, negazione delle scritture non autorizzate e revoca dello
staff. Review indipendente PASS. Nessun deploy.

Nel primo giro della suite client il test accenti richiedeva un index git
nella copia QA e la guardia copy richiedeva la registrazione dei nuovi testi.
Entrambi risolti, il secondo dall'autore dei test: il conteggio 1479/1479 sopra
è il giro completo finale, con le dipendenze delle Functions installate e
senza i nove salti iniziali dei controlli di contratto backend.


## Quarto incremento: comitati e gruppi liberi (31 ottobre)

Scelte di Paolo del 31 ottobre: questo incremento prima di delega e alloggi;
comitati e gruppi su **ogni tipo di attività**, viaggio al tempio compreso;
fuori dal campeggio gestiscono admin e dirigenti di unità, che vedono i nomi
solo tramite il server; ogni attività parte dai cinque comitati storici,
rinominabili ed eliminabili. Delega, alloggi e altri moduli restano dopo.

### Contratto dati, prima del codice

Percorso invariato `stakes/{s}/activities/{a}/management/camp` per tutti i
tipi: il nome è storico, non si migra. Nessuna collection, nessun indice nuovo.
`committees[]` diventa un elenco libero: `id` stabile scelto dal client
(i cinque storici `logistics`, `wellbeing`, `kitchen`, `games`, `spiritual`
oppure `c_` più 8–32 caratteri `[a-z0-9]`), titolo obbligatorio 1–80,
incarico 0–600, massimo 20 comitati, zero ammesso. I comitati nuovi non hanno
emoji: la UI mostra le iniziali. Cardinalità invariata: una persona sta in un
solo comitato e in un solo gruppo. Nessun incarico dà permessi.

Formato del salvataggio: il client nuovo invia `planFormat: 2` accanto a
`plan` ed `expectedUpdatedAt` (obbligatoria, anche `null`). Con il formato 2
l'elenco dei comitati è completo: un comitato assente è eliminato, le sue
persone restano senza comitato e la sincronizzazione svuota le proiezioni
`assignedCommittees` delle loro iscrizioni. Iscrizioni, consensi e firme non
cambiano. Un payload senza `planFormat` (client precedenti, PWA in cache) resta
accettato con la semantica di unione di oggi solo su un campeggio il cui piano
ha esattamente i cinque comitati storici; altrimenti `failed-precondition`
«Questa versione dell'app non può modificare il piano. Ricarica la pagina per
aggiornarla.». Così un client vecchio non resuscita un comitato eliminato e
non sposta in silenzio persone di un comitato che non vede.

Senza documento salvato il piano parte dai cinque comitati storici con incarico
vuoto; la denominazione dei gruppi parte da Pattuglie nel campeggio e da Gruppi
negli altri tipi. Gli stessi cinque nomi di gruppo di oggi valgono ovunque.

### Chi vede, chi scrive

| Azione | Admin / super_admin | Dirigente di unità del palo | Staff campeggio in elenco | Iscritto, genitore | Altri |
| --- | --- | --- | --- | --- | --- |
| Salvare il piano (callable) | sì, ogni tipo | sì, ogni tipo | solo campeggio | no | no |
| Leggere `management/camp` (SDK) | sì | sì, ogni tipo | solo campeggio | sì, come oggi | no |
| Elenco nomi per assegnare (callable `roster`) | sì | sì | solo campeggio | no | no |
| Leggere tutte le iscrizioni (SDK, dati sanitari) | sì | solo campeggio, come oggi | solo campeggio, come oggi | solo la propria | no |
| Scrivere `management/camp` dal client (SDK) | no | no | no | no | no |

Rules: la lettura di `management/camp` si estende a `isUnitLeaderOfStake` su
ogni tipo; create/update/delete client diventano `false`. Il client salva solo
con la callable dal 9 luglio 2026 (`95635d9`): la scrittura diretta era
l'ultima via per aggirare validazione, revisione e formato. Registrations e
proiezioni invariate: le scrive il server, lo staff campeggio conserva il suo
update dei soli campi di assegnazione.

Callable `campManagementStaff`, azione nuova `roster`: per chi può salvare il
piano restituisce le iscrizioni attive con soli `id`, `firstName`, `lastName`,
`fullName`, `genderRoleCategory`, `unitName`, `registrationStatus`, `status`.
Nessuna data di nascita, risposta, dato sanitario o contatto; tetto 2.000
iscrizioni. Le azioni `context`, `list` e `set` restano solo campeggio:
l'elenco staff dà accesso ai dati sanitari ed è un'altra cosa.
`campManagementSave` accetta ogni tipo e ricontrolla accesso e tipo nella
transazione: un dirigente revocato durante il salvataggio riceve il rifiuto.

### Stati, superfici e ritorni

| Stato / superficie | Azione | Ritorno e recupero |
| --- | --- | --- |
| Elenco comitati | Aggiungi comitato (nome, cosa deve fare) | Annulla senza testo chiude; con testo chiede scarto. Il comitato resta nella bozza fino a Salva modifiche |
| Limite raggiunto | Aggiungi disattivato con motivo «Massimo 20 comitati» | Elimina un comitato per aggiungerne un altro |
| Comitato con persone | Elimina comitato: il foglio elenca le persone coinvolte | Annulla non cambia nulla; dopo la conferma le persone sono senza comitato nella bozza; Scarta modifiche ripristina tutto; dopo il salvataggio si ricrea e si riassegna, iscrizioni intatte |
| Comitato vuoto | Elimina comitato con conferma breve | Scarta modifiche lo ripristina |
| Dirigente su attività non campeggio | Organizzazione → Gestisci; nomi da `roster` | Caricamento, errore con Riprova, nessun elenco iscrizioni scaricato |
| Client precedente | Salvataggio rifiutato con invito a ricaricare | Bozza locale intatta finché non ricarica |
| Iscritto, attività non campeggio | Tab Comitati e gruppo se il piano è stato salvato | Nessuna tab con i soli valori predefiniti |
| Salvataggio, rete, conflitto, cambio account | Come nel secondo incremento | Invariati |

Finitura: token blu/sabbia, Manrope/Fraunces, niente emoji nelle superfici
toccate, target 44 px, campi 16 px, nessun overflow a 320/390/430. Titoli
generici: «Comitati» e «Organizzazione» invece di «campeggio» dove il tipo può
essere un altro.

### Verifiche richieste e rilascio

Test scritti da un autore diverso: normalizzazione formato 2 e legacy, ID,
limiti, eliminazione con svuotamento delle proiezioni, accesso per ruolo e tipo,
`roster` senza campi sensibili, revoca durante il salvataggio, rules con
letture e scritture identiche al client (scrittura SDK negata a tutti).
Browser su emulatori: admin su viaggio, dirigente su viaggio via `roster`,
iscritto in `/me`, campeggio invariato, 320/390/430. Rilascio con conferma
fresca: rules, poi `campManagementSave` e `campManagementStaff`, poi hosting.

### Verifica del quarto incremento (31 ottobre)

In produzione dal 31 ottobre (`fb5db11`, service worker v35). Server,
rules e client scritti da autori diversi; test, collaudo browser e tre giri di
review da altri autori e da un altro modello.

Review di un altro modello, primo giro BLOCKED. Accettati e corretti: dati del
contesto precedente visibili dopo cambio account/palo/attività (ora ogni
risultato porta la chiave uid+palo+attività ed è usato solo se coincide, anche
per gli esiti di annullamento e reinvio); cardinalità violata da un dirigente
manuale collegato per nome a un'iscrizione già in un altro comitato (il formato
2 rifiuta con «<nome> è in due comitati: <primo> e <secondo>. Togli una delle
due assegnazioni e salva di nuovo.», la proiezione tiene comunque un solo
comitato); target sotto 44 px. Non accettato: la lettura delle iscrizioni della
propria unità da parte del dirigente su un viaggio è un permesso preesistente,
invariato e fuori da questo contratto. Secondo giro: iscrizioni legacy con solo
`status: "cancelled"` ora annullate anche nel mapper client, coerenti con il
roster e con la Notte dei Record. Terzo giro PASS WITH CONCERNS: resta l'avviso
di uscita dopo un salvataggio andato oltre il timeout, finché non si verifica.

Censimento in sola lettura della produzione: 348 iscrizioni, nessuna con
`status: "cancelled"` legacy; un solo `management/camp`, campeggio con i cinque
comitati storici, quindi i client precedenti continuano a salvarlo.

Il collaudo browser ha trovato e fatto correggere quattro difetti: foglio del
comitato e del gruppo oltre i 320 px (piede impilato sotto 720 px, colonna del
modale `minmax(0, 1fr)`), cancello comitati che trattava il viaggio come errore
di rete, «Esci dal piano» che non ripristinava la bozza, nessun avviso
`beforeunload`. La modifica a `.app-modal` è stata confrontata con `main` su
cinque altri modali a 320/390/430: rettangoli identici entro 1 px.

| Verifica (emulatori `demo-gugd-comitati` sul mini) | Esito |
| --- | --- |
| `campCommitteesFree.test.mjs` (puri, nuovo) | 92/92 |
| `campCommitteesFreeEmulator.test.mjs` (callable e rules, nuovo) | 41/41 |
| `campCommitteesFreeBrowser.test.mjs` (nuovo, 3 giri, font veri e di sistema) | 56/56 |
| camp configuration, staff, self-declared, room rules, unit leader trip | 26, 14, 15, 45, 15: tutti verdi |
| `multiStakeIsolationEmulator.test.mjs` | 151 pass, 2 skip voluti (seed demo) |
| 15 mutanti del codice server e rules | tutti rossi |

I test esistenti aggiornati riflettono il contratto nuovo (scrittura SDK del
piano negata a tutti, lettura del dirigente sul viaggio), senza asserzioni
indebolite. Non provati: errore e Riprova della sezione Organizzazione, conflitto
fra due admin nel browser, browser diversi da Chromium headless, Safari iOS.
Artefatti locali ignorati in `.claude/qa-comitati-liberi/`.


## Quinto incremento: finitura alloggi (1 novembre)

Scelta di Paolo del 1° novembre: alloggi prima della delega, che segue con il
contratto scritto prima del codice. Secondo parere Codex concorde. Chi scrive
non cambia: il piano stanze resta degli admin del palo.

Tre ostacoli per un admin di un secondo palo: la tab Stanze vuota spinge a
importare un file che non ha («Importa il file dell’ostello»), un piano senza
stanza staff non si salva e la prima stanza aggiunta nasce staff per forza
(`addRoom`), le stanze si aggiungono una alla volta. Le condizioni
dell'alloggio esistono già: `roomsInfo` dell'attività, pubblico, con quattro
etichette diverse (Tende / logistica, Logistica, Camere o posti letto,
Camere e logistica).

### Contratto dati, prima del codice

- `management/rooms` riceve `staffElsewhere` (booleano, assente = `false`).
  Con `true` il piano non richiede una stanza staff, la proposta automatica non
  riserva né riclassifica stanze allo staff, gli accompagnatori senza stanza non
  contano tra i da assegnare. Chi ha già una stanza la conserva, e un
  accompagnatore resta assegnabile alle stanze staff o coppia esistenti. Le
  regole di separazione, età, capienza e coppia non cambiano.
- Callable `roomManagementSave`: `staffElsewhere` facoltativo nel piano; se
  manca, il server conserva il valore salvato (un client precedente o una
  proposta calcolata dal core vecchio non lo azzerano). Validazione con il core
  nuovo nella stessa transazione. Nessun uid, nome o dato personale nel campo.
- La stanza staff mancante resta un problema del salvataggio, ma non blocca più
  le modifiche della bozza: si aggiungono stanze in qualsiasi ordine.
- Inserimento in blocco solo client, sulla bozza: fino a 50 stanze per volta,
  tetto del piano invariato a 200. Stessi campi e limiti di una stanza.
- `roomsInfo` invariato nello schema e nella visibilità: un'etichetta sola,
  «Alloggio», in editor, anteprima, scheda admin, `/me` e pagina pubblica.
- Nessuna collection, rule, indice o cleanup nuovi: `management/rooms` è già
  scritto solo dalla callable e cancellato con l'attività.

### Chi vede, chi scrive

| Dato | Scrive | Legge |
| --- | --- | --- |
| `management/rooms`, `staffElsewhere` compreso | admin del palo, solo callable | admin del palo |
| `roomsInfo` (Alloggio) | admin, editor attività come oggi | chi vede l'attività, anche senza iscrizione, come oggi |
| Nome della propria stanza | callable | il titolare dell'iscrizione, come oggi |

### Stati, superfici e ritorni

| Stato / superficie | Azione | Ritorno e recupero |
| --- | --- | --- |
| Stanze vuote, elenco | «Aggiungi stanze» primaria, «Importa file Excel o CSV» secondaria | Nessuna modifica finché non si conferma un foglio |
| Stanze vuote, pianta | «Aggiungi prima le stanze: la pianta mostra quelle della bozza.» | Carica pianta resta disponibile |
| Foglio Aggiungi stanze | Quante, nome o numero della prima, posti, piano, riservata a; anteprima dei nomi | Annulla chiude senza toccare la bozza; nome già usato o oltre 200 stanze: errore nel foglio, campi conservati; dopo l'aggiunta «Annulla ultima modifica» le toglie tutte; serve Salva bozza per condividerle |
| Bozza senza stanza staff | Problema con l'azione «Accompagnatori alloggiati altrove» | Salva bozza disattivato finché resta; si risolve anche riservando una stanza; Annulla ultima modifica |
| Accompagnatori alloggiati altrove | Spunta nel pannello Da assegnare; gli accompagnatori senza stanza in fondo, «Alloggiati altrove», ancora assegnabili | Togliere la spunta li riporta tra i da assegnare e torna a chiedere la stanza staff; Annulla ultima modifica |
| Alloggio (`roomsInfo`) | Riepilogo nella tab Stanze con «Modifica», che apre le opzioni dell'attività | Vuoto: invito ad aggiungerlo; pubblico come oggi, detto sotto il campo |
| Client precedente | Salva senza il campo nuovo | Il server conserva il valore; la sua validazione vecchia chiede la stanza staff finché non si ricarica |

### Finitura e verifiche

Token, componenti e foglio esistenti (`AppModal`, `rp-form`, `rp-empty`), nessuna
emoji, target 44 px, campi 16 px, nessun overflow a 320/390/430. Test di un
autore diverso: generazione dei nomi e limiti, validazione con e senza
`staffElsewhere`, proposta senza riclassificazione, callable con campo assente
che conserva il valore, client precedente. Collaudo browser su emulatori:
admin che parte da zero, inserisce in blocco, segna lo staff altrove, salva,
ricarica, assegna; lettura di Alloggio su pagina pubblica e `/me`.
Rilascio con conferma fresca: prima `roomManagementSave` (un server vecchio
rifiuta il campo nuovo), poi hosting. Rules invariate.

### Verifica del quinto incremento (1° novembre)

Codice, test e collaudo di autori diversi; due giri di review Codex. Primo
giro BLOCKED, quattro rilievi accettati e corretti: l'editor attività aperto
dalla tab Stanze poteva smontare la bozza togliendo il pernottamento (ora ogni
accesso all'editor con la bozza stanze modificata chiede prima, «Resta nelle
stanze» / «Modifica l’attività»); la proposta automatica restava bloccata dalla
stanza staff mancante (ora usa la validazione della bozza e avvisa che riserva
una stanza «Da decidere»); campi del planner sotto 16 px; «Nessun partecipante
trovato» con un risultato tra gli alloggiati altrove. Secondo giro PASS WITH
CONCERNS, il P3 rimasto (foglio da azzerare al cambio di attività) corretto.

Il collaudo ha trovato e fatto correggere: pulsante del riquadro problemi a
41,5 px, filtro categoria a 11,2 px, errore del foglio ripetuto nella pagina,
«Modifica» di Alloggio che apriva il primo passo dell'editor e poi il cursore
sul titolo invece che nel campo. Ora il campo si apre direttamente e riceve il
cursore appena finita la rilettura dal server.

| Verifica (sul mini) | Esito |
| --- | --- |
| Build TypeScript e Vite, commit finale | verde |
| Suite client `npm test` | 1548/1549; il rosso è il test accenti, che sul mini non ha git; sull'Air 55/55 |
| `roomBulk.test.mjs` (nuovo) | 25/25 |
| `roomStaffElsewhere.test.mjs` (nuovo) con core e callable stanze | 72/72 |
| Emulatore: `roomStaffElsewhereEmulator` (nuovo), callable e rules stanze | 48/48, functions invariate da allora |
| Mutanti su core, callable e foglio | 16 su 16 rossi |
| `roomLodgingBrowser.test.mjs` (nuovo, `demo-gugd-alloggi`, font veri) | 35/35 a 320/390/430, nessuno scroll orizzontale |

Non provati: import Excel/CSV e pianta caricata dopo le modifiche, stanze
comunicate ai partecipanti, un client precedente reale contro il server nuovo
(coperto dai test della callable con il campo assente), Safari iOS. Il nome
accessibile dei campi con suggerimento comprende il suggerimento: è lo schema
di tutto `EventEditorForm`, fuori da questo incremento. Fuori perimetro, visti
nel collaudo: la barra di salvataggio fissa copre parte di «Da assegnare» su
mobile; la X dell'editor non risponde mentre rilegge l'attività.

In produzione dal 1° novembre, su conferma di Paolo, dal clone pulito `99f0509`
sul mini: prima `functions:roomManagementSave` (un server vecchio rifiuta anche
`staffElsewhere: false`), poi hosting con service worker v36. Rules e indici
invariati (ruleset live `0bb59f8a…` uguale al file).

## Sesto incremento: Crea attività a step (5 novembre)

Paolo, creando il «Gran galà di gennaio»: il flusso va rifatto a fondo, a step
veri, ogni cosa chiesta chiaramente e una volta sola. Task
`gugd-crea-attivita`. Oggi «Dati essenziali» e «Locandina e altre opzioni»
chiedono due volte nome, tipo, date, luogo, descrizione, destinatari (con due
etichette diverse), finestra iscrizioni, programma e cosa portare; «Anno» si
chiede anche se deriva dalla data; «Iscrizione senza account» vive sia nelle
opzioni sia nel modulo. Il backend non cambia: stessi campi, stesse rules,
stessa bozza con `creationId` stabile e pubblicazione in transazione.

Step: 1 Cos'è (nome, tipo, destinatari) · 2 Quando e dove (inizio, fine,
luogo; qui nasce la bozza) · 3 Locandina e descrizione · 4 Iscrizioni
(finestra, posti, chi può iscriversi, requisiti solo per i tipi rafforzati,
domande del modulo) · 5 Per i partecipanti, facoltativo (programma, cosa
portare, menu, allergie, alloggio se c'è pernottamento, note interne) ·
6 Controlla e pubblica (riepilogo per step, cosa manca, extra: caminetto e
Notte dei Record). «Anno» sparisce: si ricava dall'inizio.

### Stati, superfici e ritorni

| Stato | Superficie | Da qui dove vado | Come annullo o rimedio |
| --- | --- | --- | --- |
| Nuova, vuota | step 1 | Avanti (nessuna scrittura) | Esci chiude senza chiedere: non c'è niente da perdere |
| Nuova con dati, prima della bozza | step 1-2 | Avanti; allo step 2 Avanti crea la bozza | Esci chiede «Scartare l'attività?» con Continua a compilare come scelta sicura; Indietro conserva tutto |
| Creazione in corso o in timeout | step 2 | Avanti bloccato, un solo invio | Errore nello step con i dati intatti; Riprova riusa lo stesso id |
| Bozza, step 3-5 | step | Avanti salva lo step e prosegue; un passo facoltativo ha «Salta» | Indietro salva se lo step è valido, altrimenti torna conservando i campi in memoria; Esci salva e torna all'elenco con «Bozza salvata» |
| Step con campi non validi | step | resta lì, campo evidenziato e messaggio sotto | Esci chiede «Uscire senza salvare questo passo?»: i passi già salvati restano |
| Locandina in caricamento | step 3 | Avanti attende la fine | Annulla caricamento; il file vecchio resta finché non salvi (lezione del 26/10) |
| Indice degli step | barra in alto | tocco su «Passo 3 di 6» apre l'elenco: fatto, da completare, facoltativo | chiudere l'elenco riporta allo step dov'eri |
| Bozza riaperta | step 6 | Modifica su una sezione apre quello step con «Salva e torna al riepilogo» | Torna al riepilogo senza salvare chiede scarto solo se hai cambiato qualcosa |
| Pronta | step 6 | Pubblica, con l'effetto spiegato sopra il tasto | doppio tocco non duplica; errore nello step, Riprova |
| Mancano dati | step 6 | ogni voce mancante porta allo step che la risolve | Pubblica resta spento con il motivo scritto |
| Pubblicata | step 6 come «Gestisci» | Modifica salva subito e mantiene visibilità e stato | non si torna a bozza da qui (vedi decisione aperta) |
| Pubblicata con iscritti, cambio iscrizioni | step 4 | avviso: chi è già iscritto non deve rifare il modulo | nessuna cancellazione di risposte; il campo tolto resta nei dati raccolti |
| Bozza creata, ritorno agli step 1-2 | step 1-2 | il tasto diventa Avanti e salva, sparisce l'avviso sulla bozza | Indietro e Esci come negli step 3-5 |
| Cambio di tipo dopo i requisiti | foglio sopra lo step 1 | elenca cosa si spegne o si accende e se «Alloggio» si cancella | «Lascia <tipo di prima>» è la scelta sicura; i requisiti si riaccendono a mano allo step 4 |
| In giornata ma fine il giorno dopo | step 2 | «Finisce il giorno dopo: si dorme fuori?» cambia tipo con un tocco | «No, resta in giornata» lascia tutto com'è; vale anche al contrario (pernottamento in un giorno solo) |
| Errore o timeout su Avanti | step 3-5 | resto sullo step, dati intatti, Riprova sulla stessa scrittura | Esci durante una scrittura aspetta l'esito; conflitto di revisione: «Ricarica» tiene i campi in memoria |
| Prima della bozza, indice | foglio degli step | step 3-6 bloccati con «Prima crea la bozza» | saltare via da uno step non valido chiede come Esci |
| Uscita prima della bozza con step 2 valido | foglio di conferma | «Crea la bozza ed esci» accanto a «Scarta» e «Continua a compilare» | niente si perde senza una scelta esplicita |
| Bozza ripresa dopo giorni | step 6 | date di iscrizione passate segnalate con lo step che le corregge | Pubblica spento finché la chiusura è nel passato |

Ingressi da conservare: elenco e home admin, calendario, impostazioni
(creazione); scheda attività con `initialStep` overview → step 6, preview →
step 6, options + `roomsInfo` → step 5 con il campo Alloggio a fuoco.

Gli extra (caminetto, Notte dei Record con chiusura e record senza account,
con la spunta «Ho controllato i titoli») stanno nello step 5, non accanto a
Pubblica. Annullare l'attività resta in Gestisci, con conferma e «Riapri».
Mockup v2 in `.claude/mockups/crea-attivita/` (ignorato da git), dopo la review
UX di un altro agente (PASS WITH CONCERNS, recepita in questa tabella).

Decisioni di Paolo, 5 novembre 2026 (mockup v2 approvato):
1. **«Togli dal catalogo»** nella gestione di un'attività pubblicata: torna
   bozza, nessuno la vede, iscrizioni e firme restano; si ripubblica dal
   riepilogo. Contratto rules e stati da scrivere prima del codice.
2. **«In giornata» sostituisce «Standard»** in tutta l'app; «Congiunta» resta.
3. **Cambio di tipo con iscritti: i requisiti nuovi valgono solo per i nuovi
   iscritti**, con avviso sopra Salva che dice quanti già iscritti non
   riceveranno la richiesta. Nessuna email parte da sola.
4. **«Richiedi un account per modificare l'iscrizione» si fonde**: sempre
   acceso per le attività nuove, niente interruttore. Le attività esistenti con
   il valore spento restano come sono (censimento in sola lettura prima del
   rilascio).

### Contratto di «Togli dal catalogo», prima del codice

Dove: step 6 di un'attività pubblicata («Gestisci»), solo se non è annullata
né conclusa (un'annullata si riapre prima). Foglio di conferma, scelta sicura
per prima: «Lascia pubblicata»; tasto rosso «Togli dal catalogo».

Scrittura: una transazione sul solo documento `stakes/{palo}/activities/{id}`
(`eventsService.unpublishEvent`), contro la revisione vista: legge, se è già
non pubblica non fa niente (doppio tocco e ritentativo innocui), altrimenti
`assertEventRevision` e poi `status: "draft"`, `isPublic: false`,
`isVisible: false`, `updatedAt: nextEventRevision(...)`. Modulo, iscrizioni,
autorizzazioni, firme, stanze, comitati e galleria non si toccano. Nessuna
callable: la scrittura è dell'admin del palo, che le rules ammettono già
(`allow update: if isStakeAdmin`), e nessuna function legge `isPublic`.
Ripubblicare è la `publishEvent` di sempre, dallo step 6: stessi controlli
(`getPublicationIssues`, revisione), torna `registrations_open` e visibile.

Chi vede e chi scrive, dopo (rules invariate, verificate nell'emulatore con
le query esatte del client in
`functions/tests/unpublishActivityRulesEmulator.test.mjs`):

| Chi | Attività | Effetto |
| --- | --- | --- |
| Admin del palo | legge, elenca, ripubblica | la vede in elenco come bozza |
| Dirigente di unità del palo | legge ed elenca (regola esistente) | invariato |
| Visitatore, ospite, altro partecipante | `get` negato, assente dalla query del catalogo (`isPublic == true`, `isVisible == true`) | non la vede più |
| Iscritto con `user_`/`guest_` | `get` ammesso (`hasOwnRegistration`) | sparisce da catalogo, home e elenco di /me (che leggono solo le pubbliche); il link diretto alla sua iscrizione funziona ancora |
| Genitore con iscrizione `child_` | `get` dell'attività negato, iscrizioni lette come prima (query `parentUid`) | Famiglia mostra l'iscrizione con il titolo «Attività» |
| Chiunque, iscrizione nuova | `create` negato (`activityAcceptsRegistrations` vuole pubblica e `registrations_open`) | nessuno si iscrive finché è bozza |
| Titolare, iscrizione esistente | annullamento ammesso (`validOwnerCancellation`, non guarda l'attività) | può ancora annullare |
| Genitore, autorizzazione | callable del link invariate, non leggono la pubblicazione | le firme restano e si possono ancora dare |

Stati: pubblicata → (Togli dal catalogo) → bozza con iscritti → (Pubblica)
→ pubblicata. La bozza con iscritti mostra sopra Pubblica quanti iscritti
ritroveranno l'attività. Nessuna email o notifica parte né togliendo né
ripubblicando.

Decisione 4, osservato nel codice: `requireLoginForEdit` si scrive (default
del palo, modulo) ma nessun percorso dei partecipanti lo legge. Fonderlo
significa scriverlo `true` sulle attività nuove e togliere l'interruttore
dagli editor; le attività esistenti tengono il loro valore, che non cambia
nulla per chi si iscrive.

Verifica del contratto (5 novembre, emulatore sul mini): 8 test su 8 con le
rules invariate. Il rifiuto di un'iscrizione nuova su una bozza arriva come
limite di 1000 espressioni di `validRegistrationCreate`, non come `false`:
il rifiuto regge (lo stesso payload passa sull'attività pubblica), ma quel
ramo è già al limite e un controllo in più lo farebbe sforare anche sulle
attività pubbliche.

Censimento in sola lettura della produzione (5 novembre): un palo
(`roma-est`), 6 attività, tutte con `requireLoginForEdit` acceso, come il
default del palo. Nessuna attività esistente da trattare.

### Verifica del sesto incremento (5 novembre)

Costruito su `task/gugd-crea-attivita` (`93a5130`, `8ed1168`): un foglio solo
(`AdminEventEditorModal` + `src/components/activityWizard/`, logica pura in
`src/utils/activityWizard.ts`) al posto dei quattro editor di prima, cancellati.
Ogni Avanti salva i soli step validi, attività e modulo nella stessa
transazione; la bozza nasce allo step 2 con i requisiti del tipo e i default
del palo. Le chiavi delle domande esistenti non cambiano più quando cambia il
testo (il vecchio editor le rigenerava).

- Test puri `tests/activityWizard.test.mjs` scritti da un altro agente: 55/55.
  Suite client sul mini 1872/1882 (il solo rosso è il test che chiede git, non
  disponibile nella copia del mini; verde sull'Air); typecheck e build verdi.
- Rules: `unpublishActivityRulesEmulator` 8/8.
- Collaudo su emulatori con il seed demo a 320/390/430/1440: flusso completo
  con locandina, uscite, indice, cambio tipo, Togli dal catalogo su un'attività
  con 17 iscritti (catalogo anonimo e link diretto chiusi, poi riaperti),
  ingresso Alloggio dalla tab Stanze. Confronti col mockup a 390.
- Review indipendente: PASS WITH CONCERNS, 8 rilievi tutti corretti
  (il principale: la bozza ignorava «iscrizione senza account» spento dal palo).

Differenze dal mockup rimaste: date e ore con i campi nativi del browser
(niente «sab 23 gen 2027» scritto), titolo in più sullo step 6, «Consenso foto
e video» spento di default sui tipi rafforzati come prima (il mockup lo
mostra acceso). Non provati: Safari iOS, produzione.

## Settimo incremento: modalità rapida e attività annunciata (6 novembre)

Paolo: bisogna mettere in calendario molte attività di cui si sa solo cosa
sono e quando; quasi tutti creeranno in rapida e completeranno dopo. Scelta
la variante B: **un'attività creata in rapida è «annunciata»**, cioè la
vedono ragazzi e famiglie con «Iscrizioni a breve», ma nessuno può ancora
iscriversi. Task `gugd-crea-attivita-rapida`. Mockup in
`.claude/mockups/crea-attivita-rapida/` (ignorato da git). Niente codice
prima dell'approvazione dei mockup; rules provate nell'emulatore prima.

### Annunciata: i dati

Annunciata = `status: "planned"`, `isPublic: true`, `isVisible: true`.
`"planned"` è già nell'enum (`EventStatus`) e `sanitizeStatus` lo lascia
passare; oggi nessun codice lo scrive e il seed demo non lo usa.

Campi nuovi sull'attività, scritti solo dall'admin del palo (le rules delle
attività non hanno un'allowlist dei campi: `allow create, update, delete: if
isStakeAdmin(stakeId)`, quindi nessuna rule da toccare):
- `timeToBeDefined: boolean`. Senza ora la rapida salva `startDate` alle
  00:00 del giorno, `endDate` alle 23:59 del giorno di fine (o dello stesso
  giorno) e `timeToBeDefined: true`. Il passo 2 mostra le ore vuote, non
  00:00; salvarlo con le ore scritte rimette `false`. Le functions leggono le
  date solo per le finestre di momenti e galleria: 00:00-23:59 è la finestra
  giusta.
- `statusBeforeCancel`: lo scrive «Annulla attività», lo rilegge «Riapri»
  (oggi Riapri di una pubblica scrive sempre `registrations_open`). Senza il
  campo (attività annullate prima del rilascio) Riapri fa come oggi.

Il luogo resta `location: ""` quando manca: `validateEssentialDraft` lo
chiede oggi per la bozza del passo 2; la rapida ha un controllo suo (nome,
tipo, data valida) e il luogo diventa obbligatorio solo per aprire le
iscrizioni, dentro `getPublicationIssues`, come oggi.

### Le rules bastano: verifica

Testo in `firestore.rules` 270-312 e 1738-1744:
- `isPublicActivityDoc` = `isPublic == true && isVisible != false && status
  != 'draft'`: `get` dell'annunciata ammesso a tutti, anche senza account;
  vale anche per `config/form`, `formFields`, sondaggio ospite.
- `isPublicActivityListDoc` = `isPublic == true && isVisible == true`: la
  query del catalogo (`listPublicEventsUncached`, due uguaglianze, indici
  automatici) la trova.
- `activityAcceptsRegistrations` = pubblica, visibile e `status ==
  'registrations_open'`: ogni iscrizione nuova su un'annunciata è rifiutata
  dal server, a prescindere dalle date. È anzi l'unico blocco server sulle
  date: oggi una `registrations_open` con apertura nel futuro accetta
  iscrizioni lato server (le ferma solo il client). Fuori da qui, nel backlog.
- Modifica e annullamento di iscrizioni esistenti non guardano lo status
  dell'attività: con un'annunciata non ne esistono, salvo quelle di prima di
  un «Togli dal catalogo».
- Nessun indice coinvolto, `storage.rules` non legge l'attività.

Test nell'emulatore con le query esatte del client, rules invariate:
`functions/tests/announcedActivityRulesEmulator.test.mjs` (esito sotto, in
«Verifica delle rules»).

### Chi vede, chi scrive

| Chi | Annunciata | Effetto |
| --- | --- | --- |
| Admin del palo | crea (rapida), legge, elenca, modifica, apre le iscrizioni, toglie dal catalogo, annulla, cancella | pill «Annunciata», riquadro «Da completare per aprire le iscrizioni» |
| Dirigente di unità del palo | legge ed elenca (regola esistente) | entra nei suoi riepiloghi (`unitLeaderService` esclude solo `draft` e `cancelled`) |
| Visitatore senza account | `get` e query del catalogo ammessi | card e pagina con «Iscrizioni a breve», nessun tasto verso il modulo |
| Ospite anonimo, partecipante | come il visitatore; `config/form` leggibile come per ogni pubblica | idem; `/register` mostra «Le iscrizioni non sono ancora aperte» |
| Chiunque, iscrizione nuova (`user_`, `guest_`, `child_`) | `create` negato da `activityAcceptsRegistrations` | anche chiamando le API a mano |
| Genitore | come il visitatore | nessun invito a iscrivere un figlio |
| Iscritti di prima (attività aperta, poi tolta e riannunciata) | `get` per `hasOwnRegistration`, annullamento ammesso | vedono la loro iscrizione; nessuno se ne aggiunge |
| Functions | nessun trigger su `status` o `isPublic` delle attività | niente notifiche né all'annuncio né all'apertura |

### Censimento dei consumer di status e isPublic (6 novembre)

Fatto in sola lettura su `src/`, `functions/`, rules, indici, `tools/` e
test. Cosa succede oggi con un'annunciata, e cosa cambia:

| Consumer | Oggi con un'annunciata | Cambia |
| --- | --- | --- |
| `activityWizard.ts` `statusAfterSave` | **ogni salvataggio dei passi la porta a `registrations_open`** | tiene `planned`; test `activityWizard.test.mjs:218` da aggiornare |
| `eventsService.setEventCancelled` | Riapri apre le iscrizioni | torna a `statusBeforeCancel` |
| `eventsService.publishEvent` | esce subito se è già pubblica | porta anche `planned → registrations_open`, stessi controlli |
| servizio nuovo `announceEvent` | non esiste | bozza → annunciata, transazione contro la revisione, idempotente, controlla solo nome e data |
| `events.ts` `getEffectiveEventStatus` | ignora `planned`, decide dalle date: con date dentro la finestra dice «aperte» | stato `announced` |
| `AdminActivityCard`, scheda admin, `AdminDashboardPage:83` | pill «Iscrizioni aperte/chiuse», la conta tra le aperte | pill «Annunciata», non conta tra le aperte |
| `MeDashboardPage:41-61` (/me) | dentro la finestra la mette in cima con **«Iscriviti»** verso una pagina chiusa | mai card «Iscriviti»; sta tra le prossime con la pill |
| `publicEventState.ts` `getPublicEventPhase`/`State` | «Iscrizioni dal {data}» o «Iscrizioni chiuse» (chiuse prima di aprire) | fase `announced`, pill «Iscrizioni a breve»; test `publicEventState.test.mjs:133-188` da estendere |
| `PublicActivityCard`, `ActivitiesPage` (catalogo, filtro e ordinamento) | pill sbagliata, esclusa dal filtro «aperte» | pill giusta; nel filtro sta con le non ancora aperte |
| `events.ts` `getRegistrationAvailability` | «not-open-yet» o «closed» secondo le date provvisorie | sempre «not-open-yet» per `planned` |
| `ActivityDetailPage` (scheda pubblica) | tasto spento, ma mostra apertura e chiusura provvisorie | niente date d'iscrizione, riquadro «Le iscrizioni non sono ancora aperte» |
| `ActivityRegisterPage` (`/register`) | «Non ancora aperte» o «Chiuse»; per genitore il modulo resta visibile ma non si invia | schermata «Le iscrizioni non sono ancora aperte», niente modulo |
| `MyCalendarPage`, `PlannerCalendar` (calendario /me) | compare, senza stato | invariato (il calendario mostra giorno e titolo) |
| `FamilyDashboardPage`, `MyActivitiesPage`, `MyActivityDetailPage` | solo con iscrizioni, che non possono esserci | invariato |
| `unitLeaderService` | inclusa | invariato, con la pill dell'helper |
| `familyCancel.ts`, `adminLists.ts`, `campHighlight`, gallery, Notte dei Record, sondaggio | filtri su date e flag, solo contesto | invariato |
| `functions/lib/activityMoments.js` | momenti visibili se `status` non è bozza né annullata, ma servono iscritti | invariato |
| `functions/lib/activityGallery.js`, scheduler, `sendAdminPushForNewRegistration` | solo date o solo iscrizioni (rifiutate) | invariato |
| `ShareButton` della scheda admin | «Guarda questa attività e apri l'iscrizione.» | testo per l'annunciata: «Guarda questa attività: le iscrizioni aprono a breve.» |
| Cache `events:public` (60 s) | il passaggio ad aperta si vede subito solo per chi lo fa | accettato: il server rifiuta comunque finché è annunciata |

### La schermata rapida

- **«Nuova attività» apre la rapida** da ogni ingresso: elenco (testata e
  tasto «+»), calendario, home admin, impostazioni. Il calendario ha in più
  «Aggiungi in <mese>» nella finestra del mese, con la data sul primo giorno
  di quel mese.
- **Un foglio solo, senza passi**: Nome; Tipo (cinque scelte compatte, «Su
  più giorni, si dorme a casa» accorciato in «Su più giorni»); Quando (data
  obbligatoria, ora facoltativa); per i tipi rafforzati «Fino al»
  (facoltativo); Luogo (facoltativo). Destinatari «Congiunta», come oggi alla
  creazione; si cambia al passo 1. Sotto i campi, una riga sola: «La vedranno
  ragazzi e famiglie, con le iscrizioni non ancora aperte.»
- **«Salva nel calendario»** crea l'annunciata (`createEvent` di oggi con
  `creationId` stabile: un ritentativo non ne crea una seconda; attività e
  modulo nello stesso batch). Il foglio resta aperto con «È nel calendario»
  e l'elenco delle attività aggiunte in quel giro; «Aggiungine un'altra»
  svuota nome, date e luogo, tiene il tipo, cursore sul nome; «Fatto»
  chiude e lascia la pagina dov'era (oggi `onCompleted` porta alla scheda:
  in fila sarebbe un'uscita a ogni salvataggio).
- **«Aggiungi i dettagli adesso»** crea la stessa annunciata e apre i 6 passi
  sul primo con voci aperte (di solito il 2 se mancano ora o luogo, se no il
  3).

### Da annunciata a iscrizioni aperte: «Completa i dettagli»

- Scheda admin dell'annunciata: riquadro «Da completare per aprire le
  iscrizioni» con le voci di `getPublicationChecklist` (stesse frasi, ognuna
  con il suo passo) e il tasto «Completa i dettagli», che apre i 6 passi sul
  primo passo con voci aperte. Al posto di «Rendi pubblica» nella testata.
- Nei passi, kicker «Annunciata · {titolo}» e, sopra i tasti, «La vedono già
  ragazzi e famiglie: ogni passo salvato si vede subito.» Ogni Avanti salva
  come nel sesto incremento e tiene `planned`.
- Passo 6: al posto di «Pubblica», «Apri le iscrizioni», spento con il
  motivo finché la lista non è vuota; l'effetto è scritto sopra il tasto
  («Da adesso ragazzi e famiglie possono iscriversi»).
- Lista vuota: sulla scheda il tasto del riquadro diventa «Apri le
  iscrizioni», che porta al passo 6 (la conferma resta una sola, lì).

### Stati, superfici e ritorni

Ogni passaggio ha la strada per tornare allo stato di prima.

| Stato | Superficie | Da qui dove vado | Come torno allo stato di prima |
| --- | --- | --- | --- |
| Rapida vuota | foglio | i tasti restano accesi: premuti, segnano il campo mancante | Chiudi senza domande |
| Rapida con dati | foglio | Salva nel calendario; Aggiungi i dettagli adesso | Chiudi chiede «Scartare l'attività?»: «Continua a compilare» (scelta sicura), «Salva nel calendario ed esci» se i campi bastano, «Scarta» |
| Campo mancante | foglio | errore sotto il campo, focus sul primo | niente è stato scritto |
| Scrittura in corso o in timeout | foglio | tasti bloccati, un solo invio | errore sopra i campi con i dati intatti; «Riprova» riusa lo stesso id; Chiudi durante la scrittura aspetta l'esito |
| Appena annunciata | foglio, «È nel calendario» | Aggiungine un'altra; Aggiungi i dettagli; Fatto | **«Annulla»** (solo l'ultima, finché il foglio è aperto) la cancella con `deleteEvent` (nessuna iscrizione può esistere) e riporta il foglio com'era prima di Salva, campi compresi. Chi l'ha vista nel catalogo in quei secondi trova «Attività non disponibile» |
| Annunciata | scheda admin | Completa i dettagli; Togli dal catalogo; Annulla attività; cestino | Togli dal catalogo → bozza, ritorno con «Annuncia» (scheda e passo 6). Annulla attività → annullata, ritorno con «Riapri» (torna annunciata). Il cestino chiede conferma come oggi |
| Annunciata | passi 1-5 | Avanti salva, resta annunciata | come nel sesto incremento: Indietro, Esci, conflitto di revisione |
| Annunciata completa | passo 6 | Apri le iscrizioni | → aperta. Ritorno: «Rimetti annunciata» in Gestisci finché non c'è nessun iscritto (conteggio di `statsSummary`); con iscritti la strada indietro è «Togli dal catalogo», come oggi |
| Aperta da annunciata | Gestisci | come le pubblicate di oggi | sopra |
| Bozza (da Togli dal catalogo, o vecchia bozza) | scheda, passo 6 | Annuncia (conferma: «Lascia in bozza» scelta sicura); Apri le iscrizioni se completa | Annuncia ↔ Togli dal catalogo |
| Annullata da annunciata | Gestisci | Riapri | → annunciata |
| Annunciata con la data passata | ovunque | `hasEventEnded` la fa «Conclusa» per tutti | lo staff può cambiarne le date dai passi; torna annunciata |

### Resa con dati mancanti, superficie per superficie

Lezione del 26 ottobre: una bozza essenziale deve reggere in tutti i
consumer. Allo staff «Da scegliere» (come le date d'iscrizione oggi), al
pubblico «da definire» («Luogo da definire» c'è già in `adminElenchi.ts`).

| Superficie | Ora | Luogo | Descrizione | Locandina | Programma, cosa portare | Finestra iscrizioni |
| --- | --- | --- | --- | --- | --- | --- |
| Card del catalogo e della home | solo il giorno | «Luogo da definire» | non c'è nella card | immagine del tipo di oggi | — | pill «Iscrizioni a breve», niente conto alla rovescia |
| Scheda pubblica | «ora da definire» dopo la data | «Luogo da definire» | sezione nascosta | immagine del tipo | sezioni nascoste | riquadro «Le iscrizioni non sono ancora aperte», nessuna data provvisoria; barra «Iscrizioni a breve» spenta |
| `/register` | — | — | — | — | — | «Le iscrizioni non sono ancora aperte», tasto verso la scheda |
| /me, calendario /me | solo il giorno | «Luogo da definire» | — | come la card | — | pill della card, mai «Iscriviti» |
| Card admin, elenco, dashboard | «ora da definire» | «Luogo da definire» | — | immagine del tipo | — | pill «Annunciata» |
| Calendario admin | — (giorno) | — | — | — | — | il segno della pill (annunciate piene, bozze tratteggiate) |
| Scheda admin | «ora da definire» | «Luogo da definire» | voce del riquadro | voce facoltativa | «Da scegliere» nei dettagli | «Da scegliere» (come oggi) |
| Passo 6 riepilogo | «Da scegliere» | «Da scegliere» | «Da scegliere» | «Nessuna locandina» | «Facoltativo» | «Da scegliere» |
| Dirigente di unità | solo il giorno | «Luogo da definire» | — | — | — | pill «Annunciata» |
| Condividi | — | — | — | — | — | «Guarda questa attività: le iscrizioni aprono a breve.» |

Il formattatore è uno solo: `formatEventWhen(event)` legge
`timeToBeDefined`; i 19 file che oggi chiamano i formattatori di data e ora
sull'attività passano da lì.

### Decisioni prese qui, da confermare con i mockup

1. Anche «Aggiungi i dettagli adesso» crea un'annunciata: ciò che è nella
   rapida è nel calendario di tutti. Per preparare in privato resta «Togli
   dal catalogo» (bozza) e poi «Annuncia» o «Apri le iscrizioni».
2. «Rimetti annunciata» solo senza iscritti.
3. Nessuna notifica all'annuncio né all'apertura: fuori da qui, come un
   «Avvisami» per le famiglie.
4. Illustrazione di «È nel calendario»: nel mockup `inviata.webp` del flusso
   genitore; proposta, una nuova dello stesso set («calendario»).

### Finitura

Campi a 16 px, testo secondario ≥ 13 px, target ≥ 44 px; foglio con un solo
scorrimento e tasti fissi con `env(safe-area-inset-bottom)`; con la tastiera
aperta il campo attivo resta sopra i tasti; dopo «Aggiungine un'altra» il
focus va sul nome senza salti; a 320 px le cinque scelte del tipo vanno a
capo, niente scroll orizzontale; `overflow-anchor: none` come nel sesto
incremento. Collaudo a 320/390/430/1440 sul mini col seed demo (con
un'annunciata, una con ora da definire e una senza luogo).

### Verifica delle rules

Da fare prima del codice.
