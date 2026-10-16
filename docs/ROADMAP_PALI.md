# Roadmap: un'app che un palo usa da solo

Stato: **approvata da Paolo il 2026-10-16** (tutte le raccomandazioni, A3 come proposta da Claude e non come Codex). Resta aperta M7: serve la data della prossima attività con serate. Nessun codice scritto.
Spec già corrette dopo la review di Codex (sezione in fondo).
Le scelte di prodotto aperte sono in fondo a ogni spec (sezione "Scelte per
Paolo") e riassunte qui sotto.

Obiettivo: alla terza attività gestita con l'app, e con altri due pali che
potrebbero adottarla, un admin di palo deve poter fare tutto senza che Paolo
scriva codice o apra la console. Quattro blocchi:

| # | Blocco | Spec | Problema in una riga |
| --- | --- | --- | --- |
| 1 | Identità e accesso | [IDENTITA_E_ACCESSO.md](IDENTITA_E_ACCESSO.md) | i ragazzi non sanno con quale account sono iscritti, e chi è iscritto da un genitore o da un admin non ha un modo per collegarsi |
| 2 | Registrazione e appartenenza al palo | [APPARTENENZA_AL_PALO.md](APPARTENENZA_AL_PALO.md) | il palo lo sceglie l'utente da solo e basta per vedere foto di minori; i consensi foto si possono lasciare "senza risposta" |
| 3 | Programma a momenti | [PROGRAMMA_A_MOMENTI.md](PROGRAMMA_A_MOMENTI.md) | il programma è un campo di testo e ogni attività speciale (Notte dei Record) è una pagina su misura |
| 4 | Autonomia multi-palo | [AUTONOMIA_MULTI_PALO.md](AUTONOMIA_MULTI_PALO.md) | creare un palo, il primo admin, i dirigenti di unità e le iscrizioni a mano richiedono script o console |

## Numeri di partenza (produzione, sola lettura, 2026-10-15)

| Dato | Valore |
| --- | --- |
| Account con profilo | 180, tutti `roma-est`: 141 participant, 21 unit_leader, 10 admin, 8 parent |
| Account senza nessuna iscrizione non annullata (né propria né di un figlio) | 45 |
| Viaggio al tempio del 16/10 | 118 iscrizioni: 91 `user_`, 14 `child_`, 13 `manual_` |
| Autorizzazioni firmate sul viaggio | 59: foto senza risposta 14, social senza risposta 10 |
| Altra attività con firme | 8 autorizzazioni firmate con foto senza risposta |
| Protezione enumerazione email di Firebase Auth | **attiva** in produzione (`enableImprovedEmailPrivacy`) |
| Accesso anonimo | attivo (iscrizioni "senza account", richieste record) |

## Priorità e dipendenze

```
S1 Consensi obbligatori ──────────────────────────────┐ (indipendente, piccolo)
S2 Appartenenza verificata (members + coda) ──┬──> S3 Identità (codici, aiuto, primo passo)
                                              └──> S4 Autonomia (Persone, ruoli, iscritti a mano, pali)
S3 + S4 ──> S5 Programma a momenti (a: modello+editor+tipi semplici, b: talenti/playlist + migrazione record)
```

| Sessione | Contenuto | Perché in quest'ordine | Dipende da |
| --- | --- | --- | --- |
| **S1** | Consenso foto e social obbligatori nella firma, gestione delle firme già raccolte, consenso visibile allo staff | dati di minori e liberatoria; piccolo e isolato | niente |
| **S2** | prima il contratto di autorizzazione (matrice ruolo × stato × dato, con test nell'emulatore e PWA vecchia), poi `stakes/{s}/members/{uid}`, rules Firestore e Storage che leggono l'appartenenza al posto di `users.stakeId`, callable `activityGallery` allineata, migrazione dei 180 account, coda "Richieste di accesso" per admin e dirigenti di unità, stato "in attesa" per l'utente | chiude l'accesso alle foto per autodichiarazione; deve uscire con la coda, altrimenti i nuovi iscritti restano bloccati | S1 no; deve precedere S3 perché i codici attivano l'appartenenza |
| **S3** | Codice di collegamento dallo staff, invito del genitore, vista "Iscritti senza account", "Non ricordo l'account", nuovo primo passo di accesso e registrazione, errori in italiano | rende l'appartenenza verificata sopportabile: chi è iscritto si sblocca da solo sul posto | S2 |
| **S4** | Pagina "Persone" del palo (ruoli, unità, appartenenza), inviti per dirigenti e admin, iscrizione a mano dall'app, console pali per il super admin, mittente e contatti per palo | serve prima che un secondo palo parta davvero | S2 (stati di appartenenza); in parallelo a S3 su file diversi |
| **S5a** | Modello `moments`, editor "Programma", pagina attività del ragazzo a momenti, tipi `info` e `turni` | è la feature più grande; nessuna scadenza nota | S2 (pubblico "iscritti"/"membri"), S3 (ragazzi collegati) |
| **S5b** | Tipi `talenti` e `playlist` con moderazione, Notte dei Record come tipo di momento, migrazione | riusa la coda della Notte dei Record | S5a, e dopo la chiusura del viaggio del 16/10 |

Vincolo di calendario: **niente deploy di rules su galleria, record o profili
durante il viaggio del 16-18/10** (la galleria è in uso dal vivo). S1 si
costruisce prima ma si pubblica dopo il rientro, salvo la parte client del
modulo, che non tocca chi ha già firmato.

## Mockup

Fuori da git, in `.claude/mockups/pali/` (HTML e PNG, token del mockup della
galleria):

| File | Cosa mostra |
| --- | --- |
| `01-accesso.png` | "Entra" con tre strade, "Chi sei?", scelta del palo, "Non ricordo l'account", home in attesa di verifica |
| `02-collegamento.png` | staff: iscritti senza account e codice; ragazzo: codice, "Sei tu?", "Sei dentro"; genitore: link personale e stato collegato |
| `03-consensi-e-coda.png` | passo foto obbligatorio, combinazione incoerente, coda del dirigente con "Annulla", pill del consenso nella tab Iscritti |
| `04-momenti.png` | pagina attività prima, durante e dopo; playlist; talenti; editor "Programma" con "Aggiungi momento" e anteprima |
| `05-persone.png` | Persone del palo, modifica di ruolo e unità, console pali del super admin |

## Riepilogo delle scelte per Paolo

Le raccomandazioni sono la prima opzione. Dettagli e alternative nelle spec.

| Id | Domanda | Raccomandazione |
| --- | --- | --- |
| C1 | Firme già raccolte con foto "senza risposta" | valgono come **nessun consenso**; si chiede ai genitori (22 firme) di completare solo le due scelte con un link dedicato, senza rifirmare |
| C2 | "Decido dopo" nel modulo | tolto; la scelta si cambia poi dalla pagina famiglia o dal link nella copia firmata (revoca) |
| A1 | Chi diventa membro verificato in automatico | solo chi è stato collegato da una persona dello staff (codice sul posto, iscrizione a mano, invito confermato); il collegamento del genitore precompila la richiesta in coda |
| A2 | Chi approva le richieste di accesso | admin del palo e dirigenti dell'unità dichiarata |
| A3 | Migrazione dei 180 account | attivi lo staff (31) e chi ha un'iscrizione (~104) ma "da confermare" dal proprio dirigente; i 45 senza iscrizione in coda. Codex preferiva attivare solo lo staff |
| I1 | Come si collega un ragazzo iscritto da altri | codice personale di 15 minuti mostrato dallo staff sul posto + link con token lungo dal genitore; niente codice unico dell'attività che dia accesso |
| I2 | "Non ricordo l'account" | pagina pubblica con risposta sempre uguale; la mail contiene solo il recupero dell'accesso, niente iscrizioni o genitori |
| I5 | Cosa vede il ragazzo collegato della sua iscrizione | una proiezione minima calcolata dal server, non l'iscrizione |
| M1 | La Notte dei Record diventa un tipo di momento | sì, con un adattatore: dati e callable restano, cambia la configurazione e l'ingresso |
| M2 | Pubblico di default di un momento | iscritti all'attività (e loro genitori); "tutto il palo" e "solo staff" a scelta |
| M4 | Chi vede i nomi nei momenti | admin + elenco staff dell'attività; i dirigenti di unità solo se messi in elenco (oggi nei record li vedono tutti) |
| M7 | Quando serve il programma a momenti | serve la data della prossima attività con serate: decide se S5 passa prima di S4 |
| P1 | Chi crea un palo nuovo | il super admin (Paolo) da una pagina dell'app, con invito via link al primo admin; poi il palo è autonomo |

## Parcheggio (idee non in roadmap)

| Data | Idea | Fonte | Condizione d'ingresso |
| --- | --- | --- | --- |
| 2026-10-15 | Collegamento automatico per email verificata (Google) | analisi blocco 1 | se i codici sul posto non bastano |
| 2026-10-15 | Unione di due account della stessa persona | analisi blocco 1 | se compaiono doppioni che lo staff non sa gestire |
| 2026-10-15 | Push ai ragazzi quando apre un momento | analisi blocco 3 | dopo S5, se le iscrizioni ai momenti restano basse |
| 2026-10-15 | Logo e colori per palo | analisi blocco 4 | quando un secondo palo è attivo |
| 2026-10-15 | App Check su callable pubbliche | review galleria e record | se compare abuso delle code |

## Vale per ogni sessione

- **Cancellazione account**: ogni collection nuova con dati personali entra nella
  pulizia della cancellazione nello stesso lavoro (`members`, `access`,
  `registrationLinks`, inviti e codici con TTL, `accountHelpRequests` con TTL di
  24 ore, partecipazioni ai momenti).
- **Test**: matrice ruolo × stato con l'SDK client e le query esatte, Storage
  emulato, concorrenza (due persone sullo stesso codice, annulla mentre un altro
  modifica), trigger duplicati o fuori ordine, tempi di risposta delle callable
  pubbliche, PWA con la shell vecchia.
- **Stringere una rule rompe chi ha l'app aperta**: ogni sessione elenca quali
  letture smettono di funzionare e cosa vede chi ha ancora la versione vecchia.

## Review di Codex (2026-10-15)

Secondo parere chiesto a Codex (`gpt-6-astra`, sola lettura, con le domande
"come si torna indietro da ogni stato?" e "cosa rivela questa risposta?").
Verdetto sulla prima stesura: **BLOCKED**. Correzioni già integrate nelle spec:

| Punto di Codex | Dove è finito |
| --- | --- |
| Storage legge al massimo 2 documenti Firestore per richiesta: profilo + appartenenza + galleria non ci stanno | `members` esiste anche per lo staff con `staffRole`; Storage legge solo quello |
| Un admin riscrive ruoli direttamente da client (`canAdminAssignUserRole`), le guardie della callable sarebbero aggirabili; togliere qualcuno dal palo non gli toglieva il ruolo | ramo client chiuso in S4; rimozione e ruolo nella stessa transazione |
| I dirigenti di unità avrebbero letto tutte le richieste del palo | `get`/`list` di `members` limitati alla propria unità |
| `participantUid` sull'iscrizione rompeva le rules di update e dava al ragazzo contatti e dati sanitari | legame in `registrationLinks`, il ragazzo legge una proiezione in `access` |
| 6 caratteri per 7 giorni è una credenziale debole | codice corto solo sul posto (15 min); link con token lungo per il genitore |
| La mail di "Non ricordo" rivelava minori e genitori a chi controlla un indirizzo autodichiarato | la mail contiene solo il recupero dell'accesso |
| "Ha già un account" e "Codice già usato" confermavano dati | testi unici; i dettagli solo allo staff |
| Un invito inoltrato dava privilegi | conferma finale dell'admin |
| Un genitore membro non certifica qualunque figlio | il collegamento del genitore va in coda precompilato |
| `adoptGuest` con un uid salvato dal client | buono firmato chiesto mentre si è ancora anonimi |
| Ritorni mancanti: uscita dal palo, richiesta ritirata, rimozione vs blocco, "Scollega" che azzerava l'appartenenza, ripristini oltre i tetti, fusioni della playlist, revoca del consenso senza effetto pratico | stati `withdrawn` e `blocked`, `sources` multipli e `previous`, ripristini che ricontrollano i tetti, compito "consenso revocato" per gli admin |
| Trigger duplicati o fuori ordine su `access` | ricalcolo completo a ogni evento, niente contatori |
| Teaser che rivelano ora, luogo, conteggi | oggetto minimo `{id, dayPart}` |
| Le vecchie strade dei record scavalcano pubblico e orari del momento | le callable dei record applicano anche le regole del momento |
| "Unità omonime collidono": falso, il percorso è già per palo | corretto in [AUTONOMIA_MULTI_PALO.md](AUTONOMIA_MULTI_PALO.md) |

Dove resto in disaccordo con Codex e lascio a te la scelta: **A3** (lui attiverebbe
solo lo staff e metterebbe in coda tutti gli altri 149; io attivo chi ha
un'iscrizione e faccio confermare dai dirigenti, per non togliere la galleria a
135 persone da un giorno all'altro). Il testo completo della review è fuori da
git, in `.claude/mockups/pali/review/codex.md`.
