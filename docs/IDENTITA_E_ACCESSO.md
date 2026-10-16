# Identità e accesso

Stato: **approvata da Paolo il 2026-10-16**, già corretta dopo la review
di Codex (vedi [ROADMAP_PALI.md](ROADMAP_PALI.md)). Sessione S3. Dipende
dall'appartenenza verificata ([APPARTENENZA_AL_PALO.md](APPARTENENZA_AL_PALO.md)).

## Il problema

Un ragazzo vuole caricare una foto nella galleria e non riesce a entrare. Le
cause, in ordine di frequenza probabile:

| Caso | Chi gestisce l'iscrizione | Cosa ha il ragazzo | Oggi |
| --- | --- | --- | --- |
| `user_<uid>` | il ragazzo | un account, ma non ricorda quale (Google o email, quale email) | nessun aiuto oltre "Password dimenticata" |
| `child_<parentUid>_<childId>` (14 sul viaggio) | il genitore | spesso nessun account, o un account suo scollegato | nessun legame possibile fra il figlio e un suo account |
| `manual_*` (13 sul viaggio) | nessuno: l'ha scritta Paolo con l'Admin SDK | niente | nessuna UI le crea, nessuna le collega |
| `guest_<anonUid>` | sessione anonima del telefono | niente | se poi fa login su un account esistente, l'iscrizione resta orfana (`resetAnonymousSessionIfNeeded`); `linkAnonymousRegistrationsToUser` esiste ma nessuno la chiama |

E una volta dentro con l'account "sbagliato" (nuovo, vuoto), `/me` mostra solo
il catalogo delle attività: nessun indizio che un'iscrizione esista altrove.

## Concetti

- **Gestore** dell'iscrizione: chi la compila e la modifica (oggi: `userId`,
  `parentUid`, `anonymousUid`, nessuno per `manual_`). Non cambia.
- **Partecipante collegato**: l'account della persona che partecipa, se
  diverso dal gestore. Il legame **non** si scrive sull'iscrizione (le rules di
  update sono a un passo dal limite di 1000 espressioni, e un campo nuovo
  scritto dal server "avvelena" il documento per gli update del gestore se non
  entra nell'allowlist). Vive in un documento a parte, scritto solo dal server:
  `stakes/{s}/activities/{a}/registrationLinks/{registrationId}` =
  `{participantUid, linkedAt, linkedBy, method, previous}`.
- **Vista del partecipante**: il ragazzo collegato non legge l'iscrizione
  (contiene contatti del genitore, dati sanitari, link a documenti). Legge
  `activities/{a}/access/{uid}` (blocco 3), dove il server tiene una
  proiezione minima: nome, stato dell'iscrizione, stanza, stato del consenso
  foto (sì/no/da chiedere), date. Nessuna regola nuova sulle iscrizioni.

Cosa ottiene il partecipante collegato:

| Cosa | Prima del collegamento | Dopo |
| --- | --- | --- |
| Appartenenza al palo | `pending` o nessuna | `active` se il collegamento l'ha fatto lo staff; richiesta precompilata in coda se l'ha fatto il genitore |
| Vedere la propria iscrizione in `/me` | no | sì, la proiezione minima; le modifiche restano del gestore |
| Galleria dell'attività | no | sì, da membro attivo |
| Record e momenti | no | agisce sulla stessa partecipazione del genitore, con gli stessi tetti (scelta I4) |

## Chi vede, chi scrive

| Dato | Ragazzo | Genitore gestore | Dirigente di unità | Staff attività | Admin |
| --- | --- | --- | --- | --- | --- |
| `registrationLinks/{id}` | no (vede la proiezione in `access`) | legge i propri `child_` | legge la propria unità | legge | legge |
| Creare o togliere un collegamento | via callable `registrationLink` (`preview`, `redeem`, `unlinkSelf` entro 24 ore) | via callable (`invite`, `unlink`) | via callable | via callable | via callable |
| `access/{uid}` | legge il proprio | legge il proprio | | | |
| `linkCodes`, `linkInvites` | mai (rules `if false`) | | | | |
| Generare un codice sul posto | no | no | sì, iscritti del palo della propria unità | sì, iscritti dell'attività | sì |
| Generare un invito a distanza | no | sì, per i propri `child_` | sì | sì | sì |
| Vista "Iscritti senza account" | no | no | sì (propria unità) | sì | sì |
| `accountHelpRequests` | mai (rules `if false`) | | | | |

`stakes/{s}/linkCodes/{sha256(codice)}` e `stakes/{s}/linkInvites/{sha256(token)}`:
`{registrationPath, createdBy, createdByRole, expiresAt, previewedAt,
usedAt, usedBy, attempts}`, TTL su `expiresAt`. Codice e token in chiaro non si
salvano mai.

## Le strade

### L1. Codice dallo staff, sul posto (strada principale)

1. Dirigente o staff apre "Iscritti senza account" (tab Iscritti dell'attività,
   o vista unità), tocca la persona, "Mostra codice". Il telefono dello staff
   mostra un QR e il codice di 6 caratteri (alfabeto senza 0/O/1/I), valido
   **15 minuti**, monouso. Un codice nuovo per la stessa persona annulla il
   precedente.
2. Il ragazzo inquadra il QR (`gugditalia.it/c/<codice>`) o apre "Ho un codice"
   e lo digita.
3. Se non è dentro: schermata "Entra" (primo passo) con il codice conservato.
4. **Anteprima** (`preview`, non consuma il codice): "Stai collegando il tuo
   account all'iscrizione di **Marco R.** al **Viaggio al tempio**. Sei tu?"
   con "Sei entrato come m***@gmail.com".
5. "Sì, sono io" → `redeem` consuma il codice in transazione, scrive
   `registrationLinks`, aggiunge il motivo `link_code` all'appartenenza.
   "No, non sono io" → il codice si annulla e lo staff vede "Rifiutato dal
   telefono: genera un nuovo codice".
6. Fatto: "Sei dentro. Ora puoi vedere e caricare foto e video." Sul telefono
   dello staff la riga diventa "Collegato" in tempo reale.

Il codice è corto perché vive 15 minuti e passa di mano davanti allo staff.
Tetti: 5 tentativi sbagliati per account ogni 15 minuti, 30 per rete all'ora;
ogni codice si blocca dopo 5 tentativi sbagliati su di esso.

### L2. Invito del genitore, a distanza

Pagina famiglia, scheda del figlio: "Account di Marco" → "Collega il suo
account". Genera un **link con token casuale lungo** (non un codice corto),
valido **7 giorni**, monouso, da condividere (WhatsApp) o come QR. Il resto è
uguale a L1 (anteprima, conferma, "Non sono io"). Differenza: il collegamento
dà al ragazzo la vista della sua iscrizione e porta in coda una richiesta di
appartenenza già compilata ("Collegato dal genitore Paola R."), che il
dirigente approva in un tocco. Il genitore vede lo stato ("In attesa", "Collegato
il 12/10 a m***@gmail.com") e può "Annullare l'invito" o "Scollegare".

### L3. QR dell'attività (proposta di Paolo, rivista)

Un codice unico per tutta l'attività **non dà accesso**: chi lo usa più un nome
potrebbe prendersi l'iscrizione di un altro, e la risposta rivelerebbe chi è
iscritto (lezione della Notte dei Record senza account). Il QR dell'attività
resta come **scorciatoia di navigazione**: apre la pagina dell'attività, e chi
non è collegato vede "Chiedi a un dirigente il tuo codice". Nessuna coda nuova.

### L4. "Non ricordo l'account"

Pagina pubblica `/accesso/aiuto`, raggiunta dalla terza card di "Entra", dallo
stato vuoto di `/me` e da ogni rifiuto di appartenenza.

1. L'utente scrive un'email.
2. Callable `accountHelp` (non autenticata): normalizza l'indirizzo, controlla i
   tetti, accoda la richiesta e risponde **sempre** "Se questo indirizzo è
   collegato a un account, ti abbiamo scritto. Controlla anche lo spam." La
   risposta parte prima del lavoro; i tempi (anche sopra il tetto) si misurano
   nei test e devono restare indistinguibili.
3. Un trigger cerca gli account Auth con quell'email. Se ne trova, manda **a
   quell'indirizzo soltanto** una mail con il solo recupero dell'accesso:
   "Hai un account: entra con **Google**" oppure "con email e password" + link
   di reimpostazione generato dal server. **Niente** su iscrizioni, figli o
   genitori: un indirizzo scritto in un'iscrizione è autodichiarato e non prova
   la relazione. Se non trova nulla non manda niente.
4. Tetti: 3 richieste per indirizzo all'ora e 6 al giorno; 20 per rete (hash
   dell'IP) all'ora; sopra il tetto stessa risposta, nessuna mail. La coda
   conserva l'indirizzo solo fino all'invio (poi resta l'hash) e ha TTL di 24
   ore.

La pagina dice anche, senza dipendere dall'email: "Non arriva niente? Forse non
hai un account tuo: se ti ha iscritto un genitore, chiedigli il link dalla sua
pagina famiglia; sul posto, chiedi il codice a un dirigente."

La protezione dall'enumerazione di Firebase Auth è attiva in produzione
(verificato il 2026-10-15): questa callable non deve diventare l'oracolo che
Firebase ha chiuso.

### Stato vuoto di `/me` (account giusto o sbagliato?)

Se l'account non ha iscrizioni né collegamenti e il palo ha un'attività in
corso o con iscrizioni chiuse:

> **Non trovi la tua iscrizione?** Forse ti ha iscritto un genitore o un
> dirigente, oppure sei entrato con un altro account.
> [Ho un codice] [Ricevi i tuoi accessi via email] [Esci e cambia account]

## Vista staff "Iscritti senza account"

Nella tab Iscritti dell'attività un filtro "Senza account" (contatore nella
pill), e in vista unità lo stesso filtro sulla propria unità. Elenca:
`manual_` sempre; `child_` senza collegamento; `guest_` (con l'avviso
"iscritto da un telefono senza account"). Per riga: nome, unità, età, "Mostra
codice". I collegati mostrano "Collegato a m***@gmail.com" e "Scollega".

Un `child_` piccolo può non volere un account: "Non serve" toglie la riga dal
filtro (reversibile da "Mostra anche i nascosti").

## Iscrizioni ospite orfane (`guest_`)

Chi si è iscritto senza account e poi entra con un account esistente perde
l'iscrizione. Proposta: **prima** di lasciare la sessione anonima, il client
chiama `registrationLink.prepareGuestAdoption` *da anonimo*; il server, che vede
l'uid anonimo nel token, restituisce un buono firmato valido 10 minuti. Dopo il
login il client presenta il buono a `adoptGuest`, che sposta su `user_<uid>` le
iscrizioni `guest_<anonUid>` (con riferimenti, token di autorizzazione in
attesa e tentativi dei record nella stessa operazione). Un uid anonimo salvato
dal client non basta: va provato il possesso della sessione. Se esiste già
`user_<uid>` sulla stessa attività, non sposta e lo segnala allo staff come
doppione. `linkAnonymousRegistrationsToUser` (codice morto) si toglie.

## Stati e ritorni

| Stato | Ragazzo | Genitore | Staff | Come si annulla |
| --- | --- | --- | --- | --- |
| Codice o invito emesso | | "In attesa" + "Annulla invito" | QR, tempo che resta, "Annulla" | annullare invalida; scaduto = nessun effetto |
| Anteprima aperta | "Sei tu?" | | "Qualcuno sta guardando il codice" | chiudere l'app non consuma: il codice resta valido fino alla scadenza. "No, non sono io" lo annulla e avvisa |
| Collegato | proiezione in `/me`, galleria se membro attivo | "Collegato a …", "Scollega" | "Collegato", "Scollega" | "Scollega" toglie il link e **solo** il motivo che quel link aveva dato all'appartenenza: se ne restano altri l'appartenenza non cambia, altrimenti torna allo stato che aveva prima del collegamento (`previous`), non a un default. Le partecipazioni ai momenti fatte dal ragazzo restano dell'iscrizione (il gestore le vede e le può ritirare) |
| Collegato all'account sbagliato (es. del fratello) | "Non sono io" sulla scheda, entro 24 ore | | | dopo 24 ore lo fa il genitore o lo staff; se nessuno dei due risponde, la richiesta "Scollegami" finisce nella coda degli admin |

## Utente che sbaglia

| Caso | Comportamento |
| --- | --- |
| Inquadra il QR mentre è dentro con l'account del genitore | l'anteprima mostra "Sei entrato come **Paola R.** (genitore)": "Cambio account" fa logout e riparte dal codice conservato |
| Chiude l'app all'anteprima | il codice resta valido fino alla scadenza; riaprendo il link si riparte dall'anteprima |
| Codice sbagliato, scaduto o già usato | sempre lo stesso testo: "Codice non valido. Chiedine uno nuovo a chi te l'ha dato." |
| Due ragazzi con lo stesso codice | il primo che conferma lo usa; il secondo legge il testo unico |
| Iscrizione annullata dopo il collegamento | il link resta per lo storico; la proiezione mostra "Iscrizione annullata"; l'appartenenza non cambia |
| Account già collegato a un'altra iscrizione della stessa attività | rifiuto: "Questo account è già collegato a un'iscrizione di questa attività"; lo staff vede il doppione |

## Scelte per Paolo

| Id | Domanda | Opzioni | Consiglio |
| --- | --- | --- | --- |
| I1 | Strade di collegamento | a) codice personale dallo staff + invito del genitore, QR attività solo scorciatoia; b) codice unico dell'attività + nome, con coda staff | **a** (Codex d'accordo) |
| I2 | Cosa dice la mail di "Non ricordo l'account" | a) solo il recupero dell'accesso agli account con quell'email; b) anche le iscrizioni e il genitore che le gestisce | **a** (Codex: l'email in un'iscrizione è autodichiarata) |
| I3 | Credenziali | codice corto 15 minuti solo sul posto; link con token lungo 7 giorni per il genitore | come scritto (Codex: 6 caratteri per 7 giorni sono deboli) |
| I4 | Nei record e momenti, chi agisce per un `child_` collegato | a) ragazzo e genitore sulla stessa partecipazione, tetti condivisi; b) solo il genitore come oggi | **a** (richiede di adattare `recordNight` al gestore multiplo prima di S5) |
| I5 | Cosa vede il ragazzo della sua iscrizione | a) proiezione minima calcolata dal server, niente lettura dell'iscrizione; b) l'iscrizione intera | **a** (Codex: nascondere nella UI non protegge) |
