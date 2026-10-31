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
