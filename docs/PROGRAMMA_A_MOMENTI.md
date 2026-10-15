# Programma dell'attività a momenti

Stato: **proposta del 2026-10-15, da approvare**, già corretta dopo la review
di Codex. Roadmap:
[ROADMAP_PALI.md](ROADMAP_PALI.md) (sessioni S5a e S5b).

## Oggi

- Il programma è un campo di testo libero, `program` (`src/types/models.ts:279`),
  mostrato nella pagina pubblica, nell'editor e nel PDF del consenso. La pagina
  del ragazzo (`MyActivityDetailPage.tsx`) non lo mostra.
- Le "cose speciali" di un'attività sono moduli su misura, ognuno con il suo
  interruttore: Notte dei Record (`recordsEnabled`, tab admin, pagine
  `/activities/:id/record` e `/gestisci`, tre callable, staff in
  `management/recordNight`), sondaggio (sempre presente), galleria (automatica),
  campeggio (comitati, pattuglie, checklist, solo `activityType == 'camp'`).
- La pagina del ragazzo ha un ordine fisso: hero, card Foto e video, card
  Notte dei Record, tab (solo campeggio). Non cambia fra prima, durante e dopo.
- Tipi dichiarati e mai usati: `Room`, `TempleShift`, `ServiceTeam`, `MenuItem`
  (`models.ts:610-639`). Da togliere con S5a.

Parti della Notte dei Record già generiche e riusabili: coda di moderazione
con stati e "Annulla" (`ENTRY_TRANSITIONS`), elenco staff scelto dall'admin con
rimozione automatica, iscrizione con tetto e finestra, conteggi anonimi
mantenuti in transazione, genitore che agisce per il figlio.

## Proposta

Un'attività di più giorni contiene **momenti**. L'admin li crea dall'editor
(tab "Programma"): tipo, giorno e orario, quando compaiono ai ragazzi, chi li
vede, se c'è partecipazione e se è moderata. La Notte dei Record diventa un
tipo di momento.

### Tipi iniziali

| Tipo | Esempio | Partecipazione | Moderazione default | Cosa vedono gli altri |
| --- | --- | --- | --- | --- |
| `info` | partenza, pranzo, sessione al tempio | nessuna | | titolo, ora, luogo, descrizione |
| `turni` | attività di servizio con gruppi e posti | iscrizione a un turno, uno a testa, posti limitati | nessuna | turni con posti liberi; i nomi solo allo staff |
| `talenti` | serata dei talenti | proposta di esibizione (titolo, con chi, cosa serve, durata) | prima della pubblicazione | numero di esibizioni; titoli approvati solo se l'admin lo sceglie, mai i nomi |
| `playlist` | serata da ballo | suggerimento di canzone (titolo, artista), massimo 5 a testa | prima della pubblicazione | elenco delle canzoni approvate, senza chi le ha proposte; i doppioni diventano "+1" |
| `record` | Notte dei Record | come oggi | come oggi | come oggi |

### Modello dati

`stakes/{s}/activities/{a}/moments/{momentId}`, scritto **solo dal server**
(callable `momentsAdmin`).

| Campo | Tipo | Note |
| --- | --- | --- |
| `type` | enum dei tipi sopra | non cambia dopo la creazione |
| `title` | string ≤ 80 | |
| `description` | string ≤ 600 | |
| `place` | string ≤ 80 | |
| `startsAt`, `endsAt` | string ISO locale | per mostrare e ordinare |
| `startsAtTs`, `endsAtTs` | Timestamp | scritti dalla callable: le rules non confrontano stringhe ISO con `request.time` |
| `status` | `draft` \| `published` \| `hidden` | |
| `visibleFromTs` | Timestamp | mai null: "subito" scrive l'ora della pubblicazione, così rules e query hanno un solo caso |
| `teaser` | bool | prima di `visibleFrom` gli altri vedono "Sorpresa · sabato sera" senza titolo |
| `audience` | `public` \| `members` \| `registered` \| `staff` | `public` solo per `info` |
| `participation` | map \| null | `{opensAtTs, closesAtTs, maxPerPerson, moderation: 'before' \| 'none', showTitles: bool}` |
| `slots` | array ≤ 20 (solo `turni`) | `{id, label, capacity, taken}`; `taken` mantenuto dal server |
| `summary` | map | aggregati pubblici mantenuti in transazione: `entryCount`, `approvedTitles` (≤ 200, solo se `showTitles`), `songs` (≤ 300, solo `playlist`: `{title, artist, votes}`) |
| `recordConfig` | map (solo `record`) | `{closesAt, guestEnabled}`: sostituisce `recordsCloseAt`/`recordsGuestEnabled` dell'attività |
| `createdAt`, `updatedAt`, `createdBy` | | |

`moments/{m}/entries/{entryId}`, scritto **solo dal server** (callable
`momentsParticipant`): `registrationId`, `ownerUids` (gestore e partecipante
collegato), `participantName`, `status` (`pending` \| `approved` \| `rejected`
\| `withdrawn`), `statusBeforeWithdraw`, `withdrawnBy`, `rejectionReason`,
`payload` per tipo (`talenti`: `actTitle`, `withWho`, `needs`, `minutes`;
`playlist`: `song`, `artist`, `note`; `turni`: `slotId`), date e `decidedBy`.
Per `record` restano `records`, `recordEntries` e `recordRequests` di oggi.

**Chi è "iscritto"**: `activities/{a}/access/{uid}`, scritto **solo dal
server**, `{kinds: ['participant' | 'parent' | 'linked'], registrations: [{id,
displayName, status, roomName, photoConsent}], updatedAt}`. Un uid compare per
`userId`, `parentUid` (anche con più figli nella stessa attività) e per i
collegamenti di `registrationLinks`, solo se l'iscrizione è in uno stato che dà
accesso: `active`, `confirmed`, `pending_parent_authorization`; **non**
`cancelled`, `rejected_by_parent` né le bozze. Il trigger non fa conti
incrementali: a ogni evento ricalcola da zero il documento dell'uid leggendo
tutte le sue iscrizioni e i suoi link nell'attività, così eventi duplicati o
fuori ordine danno lo stesso risultato e una revoca tardiva non resuscita un
accesso. Le rules leggono un solo documento invece di indovinare l'id
dell'iscrizione; lo stesso documento porta la proiezione che il ragazzo
collegato vede in `/me` (blocco 1).

**Staff dell'attività**: un solo elenco, `management/activityStaff.staffUids`,
scelto dall'admin con lo `StaffPicker` di oggi. Vedere i nomi di chi partecipa
è un permesso dato esplicitamente: lo hanno admin e persone in elenco; i
dirigenti di unità lo hanno solo se l'admin li mette in elenco (oggi nei record
lo hanno tutti in automatico: scelta M4). La Notte dei Record ci migra il
suo `management/recordNight` (letto ancora come ripiego finché la migrazione
non è fatta). Lo staff del campeggio resta separato: dà accesso ai dati
sanitari, è un'altra cosa.

### Chi vede, chi scrive

| Azione | Sloggato | Membro del palo | Iscritto, genitore o collegato | Staff attività | Dirigente di unità | Admin |
| --- | --- | --- | --- | --- | --- | --- |
| Vedere un momento `public` pubblicato e visibile | sì | sì | sì | sì | sì | sì |
| ... `members` | no | sì | sì | sì | sì | sì |
| ... `registered` | no | no | sì | sì | sì | sì |
| ... `staff` | no | no | no | sì | sì | sì |
| Vedere bozze, nascosti, futuri | no | no | solo il segnaposto se `teaser` | sì | sì | sì |
| Creare, modificare, nascondere momenti | no | no | no | no (scelta M5) | no | sì |
| Partecipare (proporre, iscriversi a un turno) | no | no | sì, se aperto, entro il tetto; il genitore per i figli `child_` | sì se iscritto | sì se iscritto | sì se iscritto |
| Vedere le proprie partecipazioni | | | sì (`ownerUids` contiene uid) | sì | sì | sì |
| Vedere tutte le partecipazioni con i nomi | no | no | no | sì | se in elenco | sì |
| Moderare (approva, rifiuta, riporta in attesa, unisci doppioni) | no | no | no | sì | se in elenco | sì |
| Esportare (scaletta talenti, elenco canzoni, turni) | no | no | no | sì | se in elenco | sì |

Rules (lettura; scrittura sempre `if false`):

```
match /moments/{momentId} {
  allow get, list: if isActivityStaff(stakeId, activityId)
    || (resource.data.status == 'published'
        && (resource.data.visibleFromTs == null || resource.data.visibleFromTs <= request.time)
        && audienceAllows(resource.data.audience, stakeId, activityId));
  match /entries/{entryId} {
    allow get, list: if (isNonAnonymousSignedIn() && request.auth.uid in resource.data.ownerUids)
      || isActivityStaff(stakeId, activityId);
  }
}
```

I segnaposto `teaser` li restituisce la callable `momentsParticipant.context`,
con un oggetto minimo `{id, dayPart: 'sabato sera'}`: niente titolo, luogo,
ora precisa, conteggi o tipo. La callable applica gli stessi controlli di
pubblico delle rules.

Le rules non filtrano i risultati: una query passa solo se le rules possono
dimostrare che ogni documento possibile è leggibile. Quindi il client fa una
query per pubblico (`status == 'published'`, `audience == 'registered'`,
`visibleFromTs <= ora`), e il confronto con l'ora va provato nell'emulatore
contro `request.time` (orologio del telefono avanti o indietro). Indice
composito `status + audience + visibleFromTs`. `entries where ownerUids
array-contains uid`; `ownerUids` si aggiorna quando un account viene
scollegato.

### La Notte dei Record come tipo (scelta M1)

Adattatore, non riscrittura:
- il momento `record` porta `recordConfig`; le callable leggono la
  configurazione dal momento se esiste, altrimenti dai campi dell'attività;
- `recordsEnabled` sull'attività resta, scritto dal server quando il momento è
  pubblicato, così rules, trigger e client vecchi continuano a funzionare;
- le pagine `/activities/:id/record` e `/record` restano; la card del momento
  porta lì, e le callable dei record applicano anche pubblico, visibilità e
  stato del momento (altrimenti la vecchia strada scavalca la nuova);
- prima va adattato `recordNight` al gestore multiplo (genitore e ragazzo
  collegato sulla stessa partecipazione, scelta I4 del blocco 1);
- un solo momento `record` per attività (vincolo della v1);
- migrazione dopo la chiusura del viaggio del 16/10: script che crea il
  momento per le attività con `recordsEnabled` e copia lo staff.

## Cosa vede un ragazzo quando entra nell'attività, e perché

Un ragazzo apre l'attività con una domanda diversa a seconda del momento: prima
"cosa devo fare?", durante "dove devo essere adesso?", dopo "dove sono le foto?".
L'ordine della pagina segue la fase invece di restare fisso. Mockup:
`.claude/mockups/pali/04-momenti.png`.

| Fase | In alto | Poi | In fondo |
| --- | --- | --- | --- |
| Prima (fino a `startDate` - 2 ore) | **Da fare prima di partire**: momenti con partecipazione aperta, ordinati per chiusura ("Proponi una canzone · chiude mer 21:00", "Iscriviti a un turno di servizio · 4 posti") | Programma per giorno, compresso al primo giorno | La tua iscrizione: stanza, consenso, cosa portare |
| Durante | **Adesso** (card scura): il momento in corso, o il prossimo entro 2 ore ("Tra 40 minuti · Serata dei talenti · Sala grande"), con l'azione se c'è | Foto e video (card della galleria); "Oggi" con gli altri momenti; giorni successivi compressi | La tua iscrizione |
| Dopo (fine + 7 giorni) | Foto e video | Com'è andata (sondaggio); risultati (albo dei record, quando esisterà) | Programma, compresso |

Il genitore vede la stessa pagina con le azioni per il figlio (come oggi per i
record). Il dirigente vede in più "Gestisci" su ogni momento di cui è staff.

## Editor admin: tab "Programma"

- Elenco per giorno (giorni dall'inizio alla fine dell'attività), ogni momento
  con ora, tipo, pill di stato ("Bozza", "Visibile da sab 18:00", "Aperto fino
  a mer", "3 da approvare").
- "Aggiungi momento" → scelta del tipo (card con icona SVG e una riga di
  spiegazione) → modulo: titolo, giorno e orari, luogo, descrizione; "Chi lo
  vede" (pill); "Quando compare" (subito / da data e ora, con "mostra come
  sorpresa"); partecipazione (apertura, chiusura, tetto, moderazione) per i tipi
  che ce l'hanno.
- Anteprima "Come lo vede un ragazzo" prima di pubblicare (lezione della Notte
  dei Record: un contenuto che diventa visibile passa da un'anteprima).
- Il campo `program` resta per la pagina pubblica finché l'attività non ha
  momenti `public`; poi l'editor lo mostra come "Testo libero (vecchio)".

## Stati e ritorni

Momento:

| Stato | Admin (editor) | Ragazzo | Come si annulla |
| --- | --- | --- | --- |
| `draft` | "Pubblica", "Elimina" | non lo vede | eliminare una bozza chiede conferma; nessuna partecipazione possibile |
| `published`, prima di `visibleFrom` | "Visibile da …", "Nascondi", "Rendi visibile ora" | niente, o segnaposto se `teaser` | "Torna bozza" se nessuno ha ancora partecipato |
| `published` visibile | "Nascondi", "Chiudi partecipazione", "Riapri" | il momento e le azioni | "Nascondi" non cancella le partecipazioni |
| `hidden` | "Rendi visibile" | sparisce; le sue proposte restano nella sua pagina "Le mie proposte" con "Momento annullato" | "Rendi visibile" ripristina stato, pubblico, `visibleFromTs` e partecipazioni di prima (campo `previous` sul momento, stesso trattamento di `withdrawnWithRecordHide`) |
| "Rendi visibile ora", cambio orari o pubblico | | | toast "Annulla" che rimette i valori di prima se nessuno ha partecipato nel frattempo; altrimenti si cambia di nuovo a mano |
| eliminato | solo da `draft` o `hidden` senza partecipazioni | | nessuno: per questo è limitato ai casi vuoti |

Partecipazione: stessi stati e ritorni della Notte dei Record (`pending` →
`approved`/`rejected`, ritiro con "Annulla" che ripristina lo stato di prima,
"Riporta in attesa" per lo staff, ritiro d'ufficio se l'iscrizione viene
annullata, ripristino se torna attiva). Turni: cambiare turno è un'azione sola
("Sposta"), non ritiro più nuova iscrizione, così il posto non si perde.

Ogni ripristino (dopo un ritiro, un'iscrizione riattivata, un momento rimesso
visibile) ricontrolla tetti, posti e chiusura: se non c'è più spazio la
partecipazione resta ritirata con il motivo "Posti esauriti nel frattempo", e
lo staff può forzare. Playlist: "Unisci" e il "+1" si annullano ("Separa",
"Togli il mio +1"); la fusione conserva le proposte originali, non le cancella.

## Utente che sbaglia

| Caso | Comportamento |
| --- | --- |
| Propone la stessa canzone due volte, o una già approvata | "È già in playlist" e diventa un +1, non una proposta nuova |
| Si iscrive al turno sbagliato | "Sposta" finché il turno non è chiuso |
| La proposta viene rifiutata | vede il motivo e "Modifica e ripropone" (riparte in attesa, conta nel tetto) |
| Chiusura passata mentre compila | l'invio risponde "Le proposte sono chiuse"; il testo resta nel campo per poterlo copiare |
| L'admin cambia l'orario di un momento | chi ha partecipato vede "Orario cambiato" sulla card per 24 ore |
| L'admin nasconde per sbaglio | "Rendi visibile" ripristina partecipazioni e aggregati |
| Il ragazzo non è collegato (iscritto dal genitore) | vede i momenti `members`; per gli altri "Collega il tuo account per vedere il programma" (blocco 1) |

## Scelte per Paolo

| Id | Domanda | Opzioni | Consiglio |
| --- | --- | --- | --- |
| M1 | Notte dei Record | a) tipo di momento con adattatore; b) riscrittura generica; c) resta a parte | **a** |
| M2 | Pubblico di default | a) iscritti all'attività e loro genitori; b) tutto il palo | **a** |
| M3 | Tipi iniziali | `info`, `turni`, `talenti`, `playlist`, `record` | da confermare: servono altri tipi per la prossima attività? |
| M4 | Chi vede i nomi e modera | a) admin + elenco staff dell'attività, i dirigenti di unità solo se messi in elenco; b) anche tutti i dirigenti di unità in automatico, come oggi nei record | **a** (Codex); b è più comodo, decidi tu |
| M5 | Lo staff dell'attività può creare o modificare momenti | a) no, solo admin; staff modera; b) sì | **a** |
| M6 | Nomi nelle esibizioni dei talenti | a) mai agli altri, titoli solo se l'admin lo sceglie; b) titoli e nomi visibili agli iscritti | **a** (testi e nomi di minori, come i record) |
| M7 | Quando serve | data della prossima attività con serate di questo tipo | dimmi la data: decide se S5 passa prima di S4 |
