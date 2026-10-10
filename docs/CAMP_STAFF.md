# Staff del campeggio

Chi può modificare comitati e pattuglie e leggere tutte le iscrizioni di un
campeggio (`activityType == 'camp'`). Ogni campeggio ha il proprio elenco: un
campeggio nuovo parte vuoto, non eredita nulla dai precedenti.

## Chi gestisce

1. admin del palo e `super_admin`;
2. dirigenti di unità del palo (`role == 'unit_leader'`, assegnato da un admin);
3. gli uid in `stakes/{s}/activities/{a}/management/campStaff.staffUids`, scelti
   da un admin, **con** un'iscrizione `user_<uid>` non annullata (conta solo
   `registrationStatus`, come nelle rules: se manca, niente accesso).

`genderRoleCategory` (dirigente, accompagnatore) **non conta**: lo scrive chiunque
nel proprio profilo e nella propria iscrizione. Serve solo a ordinare l'elenco e a
raggruppare le persone; mai per decidere un permesso (incidente 2026-10-10: un
minorenne poteva dichiararsi accompagnatore e leggere le iscrizioni con dati
sanitari).

## Dove sta

- Rules: `isListedCampStaff` e `isCampStaffOfActivity` in `firestore.rules`.
  `management/campStaff` lo legge solo l'admin e nessun client lo scrive.
- Callable `campManagementStaff` (`functions/lib/campManagement.js`), azioni
  `context` (chiunque non anonimo: `isStaff`, `canManageStaff`), `list` e `set`
  `{ uid, enabled }` (solo admin). Aggiungere richiede un'iscrizione attiva.
  `list` mostra anche chi è in elenco con l'iscrizione annullata o sparita,
  segnato, così l'admin lo può togliere: chi riattiva l'iscrizione torna staff.
  `campManagementSave` usa la stessa verifica (`assertCampManager`).
- Client: guardia `CampStaffGate` in `src/routes/guards.tsx` (chiede `context` al
  server), sezione "Chi gestisce il campeggio" nella scheda Comitati
  (`CampStaffSection`, solo admin), selettore condiviso con la Notte dei Record
  (`StaffPicker`).

## Minorenni con categoria adulta

La categoria si dichiara da soli, quindi dove serve distinguere gli adulti si
controlla anche l'età (`functions/lib/adultAge.js`): il pianificatore camere non
assegna un minorenne con categoria adulta a una stanza staff
(`assignmentProblem` in `functions/lib/roomPlannerCore.mjs`, l'admin deve prima
correggere la categoria), e gli elenchi staff (campeggio e Notte dei Record)
mettono tra gli "adulti" solo i maggiorenni. Se manca la data di nascita il
controllo non scatta.

## Test

```sh
firebase emulators:exec --config firebase.room-test.json \
  --project demo-room-planner \
  'node --test functions/tests/campStaffSelfDeclaredRulesEmulator.test.mjs functions/tests/campStaffEmulator.test.mjs'
```

Il primo prova le rules con le query del client (catena di auto-dichiarazione,
elenco, iscrizione annullata, scrittura di `campStaff`); il secondo le callable con
utenti veri dell'emulatore Auth.
