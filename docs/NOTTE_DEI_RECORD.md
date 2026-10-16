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

## Decisioni (2026-10-11, Paolo)

- **Idee dello staff**: lo staff prepara dei record in anticipo, così chi si
  iscrive trova già un elenco. Un record con `featured: true` si vede a tutti
  anche a zero iscritti, con "Idea dello staff · sii il primo"; appena qualcuno ci
  entra funziona come gli altri (1 iscritto = "Record da stabilire · 1 sfidante"). Scelta
  fra tre strade (flag, adulti come primi sfidanti, solo suggerimenti nel
  modulo): flag, perché non finge partecipazione.
- Copy della pagina: "Iscriviti a uno o due di questi record, oppure proponine uno
  nuovo." (il limite di 2 a testa resta, quindi "due" e non "più").
- Prima serie di 14 idee in `functions/lib/recordNightIdeas.js`, scritte da
  `functions/scripts/seedRecordNightIdeas.js` (dry-run di default, id fissi,
  non sovrascrive i record già presenti).
- Regole di sicurezza: apnea solo da fermi e seduti, con un adulto che
  cronometra; niente respiri forzati prima. Tutte le prove restano da 60 secondi
  al massimo, al chiuso, senza cibo o bevande a gara.

## Elenco sostitutivo (richiesto il 2026-10-12)

Paolo ha richiesto queste 10 prove al posto dell'elenco precedente: plank,
piegamenti in un minuto, torre di bicchieri montata e smontata, scoppio di
7 palloncini, bottle flip in un minuto, magliette indossate in un minuto,
marshmallow in bocca in un minuto, bottiglietta d'acqua bevuta a tempo,
operazioni, aeroplano costruito in un minuto con gara di distanza.
Paolo ha confermato le prove originali il 12 ottobre, comprese quelle con
marshmallow in bocca e acqua bevuta a tempo. L'elenco comprende sfide anche
quando non si tratta di record; il nome del modulo resta «Notte dei Record».
Le operazioni non hanno una durata decisa: misura `other`, senza imporre un
minuto. Per gli aeroplani vale un minuto di costruzione e la distanza del
lancio, senza aggiungere un numero di tentativi.

Sorgente unica: `functions/lib/recordNightIdeas.js`, usata sia dal seed sia
da `functions/scripts/replaceRecordNightIdeas.js`. Il secondo script è
**dry-run di default** e non cambia rules, indici, scadenza o interruttori.
Scrittura sempre server-side: stesso schema, stessi permessi e stesse query
dei record esistenti (`status == open`, visibili anche a zero iscritti grazie
a `featured: true`). Non serve un deploy per sostituire l'elenco nei dati.

La sostituzione conserva gli id di plank, piegamenti, torre e aeroplano.
Nasconde tutti gli altri record e ritira i tentativi approvati collegati,
usando la stessa logica di «Nascondi» dello staff. I vecchi record restano
accessibili solo allo staff: si può tornare indietro con «Mostra» e il relativo
ripristino delle iscrizioni. Le proposte non ancora approvate restano nella
coda di moderazione. Eventuali richieste ospiti aperte o collegate ai record
da togliere bloccano lo script e vanno gestite prima dalla coda staff.

Prima di scrivere, lo script salva un backup JSON privato (permessi 600,
percorso assoluto obbligatorio, file mai sovrascritto). Confronta attività e
tutte le collezioni con il backup nella stessa transazione della sostituzione:
se qualcuno interviene nel frattempo, interrompe senza scrivere. Il rilancio
con elenco invariato non riscrive i record né ritira altri tentativi.

```sh
node functions/scripts/replaceRecordNightIdeas.js \
  --project giovani-palo --stake roma-est --activity 55FjHkqgib55rNXfgVk9
```

Per applicare, **solo dopo conferma fresca di Paolo**, aggiungere
`--production --apply --backup /percorso/privato/backup-univoco.json`.
Verificare poi i 10 record aperti anche attraverso `recordNightGuest` azione
`context` e la pagina pubblica `/record`.

Preparazione verificata il 12 ottobre: dry-run sul viaggio in produzione
(15 record aperti, 11 da nascondere, 4 invariati, 6 da creare, 1 tentativo
da ritirare e 1 proposta ospite da conservare). Passati 82 test di logica e
script, inclusi 19 test indipendenti della sostituzione. La transazione reale è stata
applicata in produzione dopo la conferma di Paolo: 11 record nascosti,
1 tentativo ritirato, 4 record aggiornati e 6 nuovi. Verifica finale: 10
record pubblici nella callable `context`, iscrizioni aperte, tutti i titoli
presenti nella pagina `/record`; secondo dry-run con zero scritture. Backup
privato fuori dal repository. Rimossa dal sorgente anche la vecchia frase
«Niente cibo o bevande a gara» sia dalle regole sia dai motivi pronti di
rifiuto staff: questa correzione richiede un deploy hosting, ancora da
confermare (SW v16). Build produzione e anteprima nel browser verificate:
10 sfide, frase precedente assente. Il primo tentativo di build con heap
limitato a 384 MB è fallito (`JavaScript heap out of memory`); rilancio con
768 MB riuscito.

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

### Certificato da stampare (16/10, anticipo della fase 3)

`gugditalia.it/modulo-record` (link anche da "Gestisci la Notte dei Record").
Si sceglie il record dall'elenco (chi ha fatto login nel palo; senza login si
scrive a mano), si scrive risultato e nome (lo staff tocca il nome fra gli
sfidanti approvati di quel record), facoltativi unità e record precedente, poi
Stampa. **Non salva nulla**: niente rules né dati nuovi, il foglio vive nel
browser. A4 orizzontale, sfondo bianco, colori solo su testo e tratti sottili
(navy e oro dell'app) perché esca bene anche in bianco e nero. Timbro in basso
a corona d'alloro, scelto da Paolo fra tre proposte (rosetta, alloro, sigillo
dentellato). Verificato con
la stampa PDF di Chrome: una pagina, colore e scala di grigi.

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
| `featured` | bool | "idea dello staff": visibile anche a 0 iscritti. Default false (assente = false). Lo scrive solo l'admin (`createRecord`, `updateRecord`) o lo script di seed; l'approvazione di una proposta scrive false |
| `status` | `open` \| `hidden` | `hidden` = tolto dallo staff |
| `createdFromEntryId` | string \| null | tentativo la cui approvazione ha creato il record; null se creato con "Nuovo record" |
| `createdAt`, `updatedAt` | string ISO | |
| `createdBy` | uid dello staff | |

Agli altri si mostra un record solo se `status == open` e (`challengerCount > 0`
o `featured`). Testo: 0 (idea dello staff) = "Idea dello staff · sii il primo",
1 iscritto = "Record da stabilire · 1 sfidante", 2+ = "Sfida · N sfidanti": il
numero degli sfidanti si vede sempre (2026-10-14, Paolo), mai i nomi. Un record
`featured` non si nasconde da solo quando "Riporta in attesa" lo svuota.

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
- `createRecord { title, category, measure, durationSeconds?, notes?, featured? }` → record
  `open` con `challengerCount 0` (invisibile finché qualcuno non ci entra con
  `addParticipant`, salvo `featured: true`): serve per chi non ha account e propone
  un record nuovo, e per le idee dello staff
- `updateRecord { recordId, title, category, measure, durationSeconds?, notes?, featured?, status }`
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
    secondi, al chiuso, massimo 2 a testa);
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
