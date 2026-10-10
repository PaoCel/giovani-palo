# Notte dei Record

Modulo attivabile su un'attività: i ragazzi iscritti propongono in anticipo un
record da stabilire, un adulto lo approva e lo normalizza, l'elenco dei record
è visibile (anonimo) a chi ha fatto login, e chi si iscrive allo stesso record
lo sfida la sera. Prima edizione: viaggio al tempio del 16 ottobre 2026
(`stakes/roma-est/activities/55FjHkqgib55rNXfgVk9`, `activityType: trip`).

## Decisioni (2026-10-09, Paolo)

- Nome: **Notte dei Record**. "Guinness" è un marchio, non si usa.
- Elenco visibile a chi ha fatto login nel palo (qualsiasi ruolo, anche chi non
  è ancora iscritto all'attività). Mai senza login: testi scritti da minori.
  **Superato il 2026-10-10:** chi non ha account vede un elenco ridotto (solo
  titoli dello staff) e può segnarsi con nome, cognome e unità; vedi
  `docs/NOTTE_DEI_RECORD_SENZA_ACCOUNT.md`.
- Chi si candida resta **sempre anonimo** agli altri: si mostra solo il numero
  di iscritti. I nomi li vedono gli admin, chi gestisce i record, il ragazzo e il
  genitore che l'ha iscritto.
- Normalizzazione: modulo guidato (testo + "come si misura") e approvazione di
  un admin, che riscrive titolo e categoria, unisce a un record esistente o
  rifiuta con un motivo. Niente AI.
- L'approvazione è anche il controllo di sicurezza: nessuna proposta è visibile
  agli altri prima dell'ok di un admin.
- Massimo **2 record a testa** fra proposti e sfidati. Ogni prova dura al
  massimo 60 secondi (regola scritta nel modulo, non validata).
- Iscrizioni ai record chiuse a `recordsCloseAt` (default proposto: giovedì 15
  ottobre alle 21:00). Dopo, i ragazzi vedono e basta; la sera non si aggiunge
  nulla. Gli admin possono ancora agire.
- Nessun tetto al numero di record approvati per ora (durata della serata non
  ancora nota).
- I ragazzi iscritti da un account genitore (`child_...`) non hanno un account:
  li inserisce un admin. Proposta dall'area famiglia rimandata.
  **Superato il 2026-10-10:** vedi la decisione sui genitori qui sotto.

## Decisioni (2026-10-10, Paolo)

- **Genitori**: un genitore con il proprio account propone e sfida per i figli
  iscritti all'attività (`child_<parentUid>_<childId>`, iscrizione non
  `cancelled`/`rejected_by_parent`). Limite di 2 e unicità valgono per
  `registrationId`. `ownerUid` del tentativo è l'uid del genitore, così lo vede e
  lo gestisce. Anche `addParticipant` su un `child_` mette `ownerUid` = uid del
  genitore. Un utente agisce per la propria `user_<uid>` e per le `child_<uid>_*`
  attive di quell'attività.
- **Staff che gestisce** (tutte le azioni di `recordNightAdmin`, lettura di tutti
  i record e tentativi): admin e super_admin del palo, `unit_leader` dello stesso
  palo (ruolo che assegna un admin: le rules non lo lasciano cambiare da soli),
  e gli uid che un admin mette nell'elenco `staffUids` dell'attività (solo chi ha
  un'iscrizione `user_` attiva). **Non** conta `genderRoleCategory`: lo scrive
  chiunque nel proprio profilo, quindi un ragazzo che si dichiara accompagnatore
  leggerebbe nomi e proposte di tutti (corretto il 2026-10-10, prima revisione).
- **Nascondere un record con iscritti** ritira i tentativi `approved` e porta il
  contatore a 0; mostrarlo di nuovo rimette quelli ritirati con il record, se
  limite e unicità lo consentono.
- **Riportare in attesa** l'approvazione che ha creato un record rimasto vuoto lo
  nasconde (il titolo non resta leggibile al palo).

## Fasi

| Fase | Cosa | Entro |
| --- | --- | --- |
| 1 | Proposta e sfida, elenco anonimo, moderazione admin, flag sull'attività | dom 11/10 |
| 2 | Scaletta stampabile, risultati inseriti dal telefono la sera | gio 15/10 |
| 3 | Albo dei record, attestato PDF, edizione successiva | dopo il viaggio |

Il modello dati separa fin da subito il **record** (canonico, dell'attività) dal
**tentativo** (l'iscrizione di una persona a quel record, che in fase 2 porta il
risultato). L'albo della prossima edizione si costruisce dai record con
risultato, senza migrazioni.

## Dati

### Attività `stakes/{s}/activities/{a}`

| Campo | Tipo | Note |
| --- | --- | --- |
| `recordsEnabled` | bool | default false; scritto dall'admin nell'editor attività |
| `recordsCloseAt` | string ISO \| null | null = chiude a `startDate` |

### Record `stakes/{s}/activities/{a}/records/{recordId}`

Documento canonico, scritto **solo dal server** (callable).

| Campo | Tipo | Note |
| --- | --- | --- |
| `title` | string ≤ 80 | titolo ufficiale, es. "Salti a piedi uniti in 60 secondi" |
| `category` | enum | `resistenza`, `velocita`, `precisione`, `equilibrio`, `mente`, `fantasia` |
| `measure` | enum | vedi sotto |
| `durationSeconds` | int \| null | solo per `count_in_time` (10-60) |
| `notes` | string ≤ 200 | regole e materiale, scritte dall'admin; può essere vuoto |
| `challengerCount` | int ≥ 0 | tentativi `approved`; mantenuto dal server |
| `status` | `open` \| `hidden` | `hidden` = tolto dallo staff |
| `createdFromEntryId` | string \| null | tentativo la cui approvazione ha creato il record; null se creato con "Nuovo record" |
| `createdAt`, `updatedAt` | string ISO | |
| `createdBy` | uid dello staff | |

Agli altri si mostra un record solo se `status == open` e `challengerCount > 0`.
Testo: 1 iscritto = "Record da stabilire", 2+ = "Sfida · N sfidanti".

`measure` (etichetta nel modulo "Come si misura?"; direzione per la fase 2):

| Valore | Etichetta | Vince |
| --- | --- | --- |
| `count_in_time` | Quante volte in un tempo dato | più alto |
| `count_streak` | Quante di fila senza sbagliare | più alto |
| `longest_time` | Quanto tempo resisti | più alto |
| `fastest_time` | Quanto ci metti | più basso |
| `distance` | Quanto lontano o quanto in alto | più alto |
| `other` | Altro, lo spiego io | deciso dall'admin |

### Staff `stakes/{s}/activities/{a}/management/recordNight`

Scritto **solo dal server** (`setStaff`, e il trigger che toglie chi non è più
iscritto). Lo legge solo un admin del palo; le rules del campeggio su
`management/{id}` non danno a nessun client la scrittura di questo documento.

| Campo | Tipo | Note |
| --- | --- | --- |
| `staffUids` | array di uid | chi gestisce i record oltre ad admin e dirigenti di unità; massimo 100 |
| `updatedAt` | string ISO | |
| `updatedBy` | uid \| `system` | |

### Tentativo `stakes/{s}/activities/{a}/recordEntries/{entryId}`

Iscrizione di una persona a un record. Scritto **solo dal server**.

| Campo | Tipo | Note |
| --- | --- | --- |
| `registrationId` | string | iscrizione all'attività (`user_`, `child_`, `guest_` mai) |
| `ownerUid` | uid | account che gestisce il tentativo: la persona (`user_`) o il genitore (`child_`); lo vede e lo modifica lui |
| `participantName` | string | nome e cognome dall'iscrizione, per l'admin |
| `kind` | `proposal` \| `challenge` | proposta nuova o sfida a un record esistente |
| `proposedText` | string ≤ 120 | solo `proposal`: "cosa fai", parole del ragazzo |
| `proposedMeasure` | enum `measure` | solo `proposal` |
| `proposedDurationSeconds` | int \| null | solo `proposal` + `count_in_time` |
| `proposedNeeds` | string ≤ 120 | "serve qualcosa?", opzionale |
| `recordId` | string \| null | null finché la proposta è in attesa o rifiutata |
| `status` | `pending` \| `approved` \| `rejected` \| `withdrawn` | |
| `statusBeforeWithdraw` | `pending` \| `approved` \| null | per "Annulla" dopo il ritiro; null se il ritiro è dello staff o d'ufficio |
| `withdrawnBy` | `self` \| `staff` \| `system` \| null | chi ha ritirato: il titolare, lo staff (anche nascondendo il record), il trigger dell'iscrizione |
| `withdrawnWithRecordHide` | bool | ritirato perché il record è stato nascosto: si rimette quando il record torna visibile |
| `rejectionReason` | string ≤ 200 | visibile al ragazzo |
| `createdByAdmin` | bool | |
| `createdAt`, `updatedAt`, `decidedAt` | string ISO | |
| `decidedBy` | uid \| null | |

Fase 2 aggiungerà `resultValue`, `resultRecordedAt`, `resultRecordedBy`.

Vincoli lato server:
- al massimo **2** tentativi `pending` o `approved` per `registrationId`;
- un `registrationId` non ha due tentativi `approved`/`pending` sullo stesso
  `recordId`;
- una proposta identica (testo, misura, durata) a una già attiva della stessa
  iscrizione non si crea, non si ottiene modificando e non si ripristina;
- `challengerCount` cambia solo nella stessa transazione del tentativo.

## Chi può fare cosa

| Azione | Chi | Quando |
| --- | --- | --- |
| Vedere i record aperti | loggato non anonimo con `stakeId` del palo, staff | sempre |
| Vedere i record nascosti | staff | sempre |
| Vedere i propri tentativi | `ownerUid == auth.uid` (un genitore vede quelli dei figli), staff | sempre |
| Vedere tutti i tentativi con nomi | staff | sempre |
| Proporre, sfidare | titolare di `user_<uid>` o genitore di `child_<uid>_*`, iscrizione non `cancelled`/`rejected_by_parent` | `recordsEnabled` e prima di `recordsCloseAt` |
| Modificare, ritirare, annullare il ritiro | `entry.ownerUid == uid`, iscrizione ancora attiva | `recordsEnabled` e prima di `recordsCloseAt` |
| Approvare, unire, rifiutare, riportare in attesa, creare, modificare o nascondere un record, iscrivere qualcuno, ritirare un tentativo | staff | con `recordsEnabled` (anche dopo la chiusura) |

Staff = admin/super_admin del palo, `unit_leader` dello stesso palo, uid in
`staffUids`. Scegliere chi è in elenco (`listStaff`, `setStaff`) è riservato agli
admin e super_admin del palo: non ai dirigenti di unità né a chi è già in
elenco. Gli anonimi (guest) non vedono e non agiscono.

## Firestore rules

```
function isListedRecordNightStaff(stakeId, activityId) {
  return isNonAnonymousSignedIn()
    && exists(<management/recordNight>)
    && request.auth.uid in get(<management/recordNight>).data.staffUids;
}
function isRecordNightStaff(stakeId, activityId) {
  return isStakeAdmin(stakeId) || isUnitLeaderOfStake(stakeId)
    || isListedRecordNightStaff(stakeId, activityId);
}
match /records/{recordId} {
  allow get, list: if (isNonAnonymousSignedIn() && resource.data.status == 'open'
        && currentUserExists() && currentUser().stakeId == stakeId)
    || isRecordNightStaff(stakeId, activityId);
  allow create, update, delete: if false;   // solo callable
}
match /recordEntries/{entryId} {
  allow get, list: if (isNonAnonymousSignedIn() && resource.data.ownerUid == request.auth.uid)
    || isRecordNightStaff(stakeId, activityId);
  allow create, update, delete: if false;   // solo callable
}
```

Il ramo senza `get()` va per primo; staff: al massimo il profilo utente e il
documento dell'elenco (2 documenti). Le rules del campeggio non cambiano:
`management/recordNight` si legge solo da un admin e nessun client lo scrive.

Query client (da provare nell'emulatore con un utente normale):
- partecipante: `records where status == 'open'` (filtro `> 0` lato client);
  un record nascosto non è leggibile dai membri, nemmeno con un get diretto,
  `recordEntries where ownerUid == uid`;
- staff: `records` e `recordEntries` intere (`listAllRecords`, `listAllEntries`);
- un genitore legge con `where ownerUid == uid` anche i tentativi dei figli.

Nessun indice composito necessario.

## Callable (region `europe-west1`, come le altre)

Tutte le risposte sono `{ ok, action, ... }`. Le azioni che toccano un tentativo o
un record aggiungono `entry` e `record` (oggetto con `id` o `null`).

`recordNightParticipant({ stakeId, activityId, action, ... })`, utente non anonimo:
- `context {}` → `{ people: [{ registrationId, displayName, isSelf }], isStaff, canManageStaff }`.
  `canManageStaff` è true solo per admin e super_admin del palo.
  Sola lettura, richiede `recordsEnabled`, funziona anche dopo la chiusura.
  `people` = le iscrizioni per cui l'utente può agire, prima la propria poi i
  figli; `displayName` = nome di battesimo, nome e cognome se ci sono omonimi
- `propose { text, measure, durationSeconds?, needs?, registrationId? }` →
  tentativo `pending`; `registrationId` assente = `user_<uid>`
- `challenge { recordId, registrationId? }` → tentativo `approved`,
  `challengerCount + 1`
- `edit { entryId, text, measure, durationSeconds?, needs? }` → solo `pending`
- `withdraw { entryId }` → `withdrawn` (`withdrawnBy: self`), salva
  `statusBeforeWithdraw`; se era `approved`, `challengerCount - 1`
- `restore { entryId }` → torna a `statusBeforeWithdraw` (se approved:
  record ancora `open`, limite e unicità rispettati, `challengerCount + 1`; se
  pending: nessuna proposta identica già attiva)

`edit`, `withdraw` e `restore` verificano `entry.ownerUid == uid` e che
l'iscrizione sia ancora attiva; `propose` e `challenge` verificano che l'utente
possa agire per `registrationId` (la propria `user_` o una `child_<uid>_*`).

`recordNightAdmin({ stakeId, activityId, action, ... })`, staff:
- `approve { entryId, title, category, measure, durationSeconds?, notes? }` →
  crea record `open` con `challengerCount 1` e `createdFromEntryId`, tentativo
  `approved`
- `merge { entryId, recordId }` → tentativo `approved` su record esistente
  (errore se quella persona ci è già)
- `reject { entryId, reason }` → `rejected`
- `reopen { entryId }` → da `approved` o `rejected` a `pending`, `recordId`
  null; se era `approved`, `challengerCount - 1`, e se il record era nato da
  quell'approvazione e scende a 0 diventa `hidden`
- `createRecord { title, category, measure, durationSeconds?, notes? }` → record
  `open` con `challengerCount 0` (invisibile finché qualcuno non ci entra con
  `addParticipant`): serve per chi non ha account e propone un record nuovo
- `updateRecord { recordId, title, category, measure, durationSeconds?, notes?, status }`
  → in più `withdrawnCount`, `restoredCount`, `notRestoredCount`. Con
  `status: hidden` ritira i tentativi `approved` del record (`withdrawnBy: staff`,
  `withdrawnWithRecordHide`, senza "Annulla") e porta il contatore a 0. Con
  `status: open` su un record nascosto rimette `approved` i tentativi con quel
  flag se l'iscrizione è attiva, la persona ha meno di 2 tentativi attivi e non
  è già sul record (gli altri restano ritirati) e ricalcola il contatore
- `addParticipant { recordId, registrationId }` → tentativo `approved`,
  `createdByAdmin`, `ownerUid` = uid dell'iscrizione `user_` o il genitore di
  un `child_` (campo `parentUid`, altrimenti dall'id)
- `withdrawEntry { entryId }` → ritiro dello staff (`withdrawnBy: staff`), senza
  "Annulla" per il ragazzo
- `listStaff {}` (solo admin/super_admin) → `{ candidates: [{ uid, registrationId,
  name, unitName, isAdult, isStaff }] }`: le iscrizioni `user_` attive, adulti
  prima e poi gli altri (`isAdult` ordina soltanto, non dà permessi)
- `setStaff { uid, enabled }` (solo admin/super_admin) → `{ staffUids }`.
  `enabled: true` solo se `user_<uid>` ha un'iscrizione attiva all'attività;
  togliere un uid che non c'è non fa nulla
- `listParticipants {}` → `{ participants: [{ registrationId, name, unitName, isAdult }] }`:
  iscrizioni attive `user_`/`child_` dell'attività, solo questi campi. Serve a
  "Iscrivi qualcuno" perché accompagnatori e dirigenti di unità non leggono
  tutte le iscrizioni dalle rules (come `listStaff`, legge le iscrizioni fuori
  dalla transazione: sono solo lettura)

Ogni azione legge e scrive in **una transazione**: attività (flag e
scadenza), iscrizione (stato), tentativi della persona (limite), record
(contatore). Messaggi d'errore in italiano, neutri rispetto al genere, codici
`failed-precondition` ("Le iscrizioni ai record sono chiuse.", "Limite di 2
record raggiunto: ritirane uno per sceglierne un altro.", "Già in gara per
questo record.", "Questa proposta è già presente."): senza seconda persona
singolare riferita a chi è iscritto, perché agisce anche il genitore per il
figlio.

## Trigger

Su update di un'iscrizione verso `cancelled` o `rejected_by_parent`, e su
delete dell'iscrizione: tutti i tentativi `pending`/`approved` di quel
`registrationId` vanno a `withdrawn` (con `statusBeforeWithdraw` null e
`withdrawnBy: system`: non si annulla da qui), e i contatori scendono. Se
l'iscrizione è `user_<uid>`, toglie anche l'uid da `staffUids` (stessa
transazione). Gen2, region esplicita, idempotente. Quando si cancella l'attività
sparisce anche `management/recordNight`, oltre a record e tentativi.

Il repo non ha un flusso di cancellazione account: i tentativi seguono
l'iscrizione, che è il dato da cui dipendono.

## Stati e ritorni

Righe: stato del tentativo. Colonne: dove lo si vede o lo si cambia.

| Stato | Ragazzo, prima della chiusura | Ragazzo, dopo la chiusura | Admin |
| --- | --- | --- | --- |
| (nessuno) | "Proponi un record" o "Sfida" su un record aperto | solo elenco | "Iscrivi qualcuno" su un record; "Nuovo record" |
| `pending` | "In attesa di approvazione", "Per ora la vedi solo tu": Modifica, Ritira | "Non controllata in tempo" (sola lettura) | Approva / Unisci a… / Rifiuta |
| `approved` | "Ci sei" sul record: Ritirati | "Ci sei" | Riporta in attesa, Ritira |
| `rejected` | "Non accettata" + motivo; può proporre un altro record (non conta nei 2) | "Non accettata" + motivo | sezione chiusa "Non accettate": Riporta in attesa |
| `withdrawn` (`withdrawnBy: self`) | subito dopo il ritiro, avviso "Ritiro fatto" con **Annulla**; poi resta in fondo a "I tuoi record" sotto "Ritirati" con **Ripristina** (solo se `statusBeforeWithdraw` c'è e il record è ancora aperto, altrimenti "Il record non è più in elenco") | niente | sezione "Ritirati": "Ritiro del partecipante"; si re-iscrive con "Iscrivi qualcuno" |
| `withdrawn` (`withdrawnBy: staff`/`system`) | sotto "Ritirati": "Tolto da un adulto", senza Ripristina | niente | "Ritirato da un adulto" / "Iscrizione annullata"; se ritirato con un record nascosto, rientra con "Mostra di nuovo" |

Ritorni:
- Ritiro → **Annulla** nell'avviso ripristina lo stato di prima (testo, misura,
  record compresi). Se nel frattempo il limite di 2 è pieno o il record è
  nascosto, l'errore lo dice.
- Admin: Approva/Unisci/Rifiuta si annullano con **Riporta in attesa**, che
  rimette la proposta com'era (il testo originale non viene mai modificato:
  il titolo ufficiale sta sul record).
- Un record il cui contatore scende a 0 non si vede più; torna visibile appena
  qualcuno ci si iscrive di nuovo (o ripristina).
- Nascondere un record con iscritti li ritira (senza "Annulla" per il ragazzo);
  mostrarlo di nuovo rimette chi può e dice quanti restano fuori (limite di 2 o
  iscrizione annullata nel frattempo).
- Riportare in attesa l'approvazione che ha creato un record, se resta vuoto,
  lo nasconde: una nuova approvazione ne crea uno nuovo, senza doppioni visibili.
- Modulo di proposta: chiudere senza inviare non salva niente; nessun dato
  parziale sul server.

## UI (fase 1)

Mockup approvati nei contenuti il 2026-10-09; la grafica avrà una pelle
propria da evento (direzione scelta da Paolo). Copy rivolto al ragazzo sempre
neutro rispetto al genere ("Ci sei", "Ritiro fatto", mai "ritirato/a").
Nell'elenco la misura usa etichette brevi: "In N secondi", "Di fila",
"Più a lungo", "Tempo", "Distanza o altezza", "Altro"; le etichette lunghe
restano nel modulo.

- **Pagina record** `/activities/:eventId/record`, link da condividere su
  WhatsApp. Senza login: invito ad accedere con ritorno alla pagina. Con login:
  - regole in breve ("prima edizione: qualsiasi risultato è un record", 60
    secondi, al chiuso, niente cibo o bevande a gara, massimo 2 a testa);
  - scadenza ("Iscrizioni ai record aperte fino a giovedì 15 ottobre, 21:00");
  - i tuoi record (0-2) con stato e azioni;
  - elenco dei record aperti per categoria, con "Sfida" o "Ci sei";
  - "Proponi un record": testo, "Come si misura?", secondi se serve, "Serve
    qualcosa?". Mentre scrive, i record aperti simili con "È questo: sfidalo".
  - non iscritto all'attività: vede l'elenco e un invito a iscriversi al
    viaggio; niente tasti.
- **Ingressi**: card nella pagina dell'attività del partecipante e nella pagina
  pubblica dell'attività (se `recordsEnabled`).
- **Admin**: scheda "Record" nel dettaglio attività, se `recordsEnabled`:
  proposte in attesa in alto (testo originale, nome, misura, "serve"), con
  Approva (titolo e categoria precompilati e modificabili) / Unisci a… /
  Rifiuta; sotto i record con iscritti (nomi visibili), Iscrivi qualcuno,
  modifica, nascondi, "Nuovo record"; sezioni chiuse "Non accettate" e
  "Record nascosti" per tornare indietro.
- **Editor attività**: interruttore "Notte dei Record" e data/ora di chiusura.

## Test

- Emulatore (`firebase.room-test.json`, progetto `demo-room-planner`), query
  esatte del client con utente normale, admin, utente di altro palo, anonimo.
- Callable: limite di 2, chiusura, unicità, contatori dopo approva/unisci/
  ritira/ripristina/riporta in attesa, iscrizione annullata (trigger).
