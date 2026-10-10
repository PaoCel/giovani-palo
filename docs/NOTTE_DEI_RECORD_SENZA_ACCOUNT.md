# Notte dei Record: richieste senza account

**Decisa il 2026-10-10 da Paolo (D1-D5 come proposti, D4 coi numeri di default).** Aggiunge un secondo ingresso alla Notte dei
Record (`docs/NOTTE_DEI_RECORD.md`): chi non ha un account può segnarsi a un
record (proporne uno o sfidarne uno) indicando nome, cognome e unità. La
richiesta non conta e non la vede nessuno finché un adulto dello staff non la
collega a mano a un'iscrizione al viaggio. Il login resta la strada migliore e
si presenta per primo.

Rivista dopo un secondo parere indipendente (Codex, sola lettura, stesse
domande della regola di prodotto: "come si torna indietro da ogni stato?",
"cosa rivela questa risposta?"). Le modifiche sono già dentro questo testo.

## Fatti verificati (produzione, 2026-10-10, sola lettura)

- Iscrizioni al viaggio (`55FjHkqgib55rNXfgVk9`): 105 documenti. Per prefisso:
  `user_` 79, `child_` 14, `manual_` 12, **`guest_` 0**. Non annullate: 73 + 11 +
  12 = 96.
- Chi è "senza account" oggi: i 12 `manual_` (iscritti da un admin), i ragazzi
  `child_` (l'iscrizione c'è, l'account è del genitore) e chi non si è ancora
  iscritto al viaggio.
- 9 unità, tutte attive; `units` si legge senza login se `isActive == true`.
- Nessuna funzione schedulata nel repo, nessun App Check, nessun captcha.
- Oggi `recordNightParticipant` rifiuta le sessioni anonime e
  `parseKnownRegistrationId` rifiuta `guest_`. Per chi non ha account l'unico
  percorso è `createRecord` + `addParticipant` a mano da un admin.
- Le rules dell'attività non hanno un elenco di campi ammessi (update solo
  admin): `recordsGuestEnabled` non richiede modifiche alle rules.

## Decisioni (Paolo, 2026-10-10)

Tutte approvate nella forma "Proposta". Questa colonna è quindi la decisione; "Alternativa" resta come traccia di ciò che è stato scartato.

| # | Domanda | Proposta | Alternativa |
| --- | --- | --- | --- |
| D1 | Chi non ha account vede l'elenco dei record? Il 09/10: "solo con login, testi di minori". | **Sì, sola lettura, solo ciò che scrive lo staff**: titolo, categoria, come si misura. Mai parole dei ragazzi, nomi, unità, note o numeri di iscritti. Pagina `noindex`. **Prima di accendere l'interruttore** l'editor mostra l'anteprima pubblica (titoli e categorie dei record aperti) da rivedere; i titoli già approvati quando l'elenco era solo per loggati diventano visibili solo dopo quel passaggio. L'"Approva" ricorda: "Il titolo lo vedono tutti, anche senza account: niente nomi". | Senza account si può solo proporre, non sfidare. |
| D2 | Dopo il collegamento, chi ha fatto la richiesta può ritirarsi dal suo telefono? | **No**: il telefono vede lo stato; per ritirarsi chiede a un adulto (Scollega o Ritira). Prima del collegamento invece ritira e annulla da solo. | Sì, con Annulla: costa precedenza col titolare dell'account, errori che non devono rivelare altri tentativi, più test. Si può aggiungere dopo. |
| D3 | Quanto si conservano le richieste? | **Fino a 7 giorni dopo la data del viaggio**, poi cancellate in automatico (TTL Firestore), qualunque stato. | Cancellare subito le non collegate alla chiusura. |
| D4 | Limiti anti-spam. | **12 richieste aperte per telefono, 2 per persona, 100 in coda per attività** (erano 6: lo stesso telefono può servire più persone, vedi "Più persone dallo stesso telefono"); interruttore "Richieste senza account" nell'editor attività, **spento di default** (lo accendi tu). Sono un freno agli errori e ai dispetti, **non una difesa**: chi cancella i dati del sito riparte. La difesa è la coda moderata, il tetto, l'interruttore e il rifiuto in blocco. | Numeri diversi. App Check o Turnstile solo se si vede abuso. |
| D5 | Priorità e data. | Questa feature prima della Fase 2, in produzione **entro mar 13/10**, così si usa mer-gio prima della chiusura (gio 15/10, 21:00). La Fase 2 (scaletta, risultati) corre in parallelo solo su file disgiunti. | Fase 2 prima. |

Assunzioni che seguo salvo stop: (a) "collegare a un account" = collegare
all'iscrizione `user_<uid>` di quell'account; un account **senza** iscrizione
al viaggio non si collega; (b) `guest_` resta escluso (0 oggi); (c) qualunque
membro dello staff può collegare qualunque unità, la coda mostra in alto la sua
unità; (d) l'unità dichiarata è un indizio per lo staff, non un vincolo; (e)
nessun limite per IP: un gruppo che si segna insieme dal wifi della cappella
verrebbe bloccato, e l'IP vero nelle callable gen2 non è misurato.

## Principi

1. **Nessuna richiesta conta finché lo staff non la collega.** Il collegamento
   crea il tentativo (`recordEntries`) con le regole di sempre: limite 2,
   unicità, finestra, record aperto.
2. **Mai rivelare chi è iscritto.** Il percorso di invio non legge le iscrizioni
   né le richieste degli altri: stessa risposta e stessi tempi per un nome
   iscritto, uno sconosciuto e un duplicato. I suggerimenti di abbinamento
   esistono solo per lo staff. Dopo il collegamento il telefono vede solo lo
   stato della propria richiesta; gli errori dei suoi ritiri sono generici.
3. **Anti furto d'identità = verifica umana della richiesta, non solo del nome.**
   Chiunque può scrivere il nome di un compagno. Per collegare, lo staff spunta:
   "La persona mi ha confermato di aver inviato questa richiesta (di persona o
   tramite il suo dirigente)". Collegare i soli dati anagrafici non basta: il
   telefono riceverebbe lo stato di un'iscrizione che non è sua. L'esito
   negativo ha lo stesso testo qualunque sia il motivo (non iscritto, non
   verificato, non collegabile).
4. **Solo callable.** Nessuna scrittura dal client, nessuna lettura diretta
   delle richieste: rules `if false` anche per lo staff (la coda passa dalla
   callable, che calcola i suggerimenti).
5. **Dati minimi** (nome, cognome, unità, testo), cancellati a data fissa.
6. **Precedenze.** (1) `recordsEnabled == false`: tutto spento per tutti.
   (2) Finestra chiusa: il richiedente non invia, non ritira, non ripristina;
   lo staff sì. (3) Interruttore `recordsGuestEnabled` spento: blocca solo
   `submit` e il tasto "Segnati senza account", mai le altre azioni.

## Dati

### Attività: un campo

| Campo | Tipo | Note |
| --- | --- | --- |
| `recordsGuestEnabled` | bool | default false; interruttore "Richieste senza account"; chiude solo l'**invio** |

### Richiesta `stakes/{s}/activities/{a}/recordRequests/{requestId}`

Scritta solo dal server; nessun client la legge.

| Campo | Tipo | Note |
| --- | --- | --- |
| `anonUid` | uid | sessione anonima Firebase che l'ha inviata: è "il telefono" |
| `submissionId` | string | token generato dal foglio aperto: stesso token = stessa richiesta (doppio tocco, risposta persa), un foglio nuovo = richiesta nuova |
| `firstName`, `lastName` | string 2-40 | lettere (anche accentate), spazio, apostrofo, trattino; niente cifre, URL, markup |
| `unitId`, `unitName` | string | unità attiva al momento dell'invio; il nome è una copia |
| `personKey` | string | `nome cognome|unitId` normalizzato (minuscole, senza accenti): limite e raggruppamento |
| `kind` | `proposal` \| `challenge` | |
| `proposedText`, `proposedMeasure`, `proposedDurationSeconds`, `proposedNeeds` | | solo `proposal`, stessi vincoli di `propose` |
| `recordId` | string \| null | solo `challenge` |
| `status` | `open` \| `linked` \| `rejected` \| `withdrawn` | |
| `staffNote` | string ≤ 200 | interna, **mai** al richiedente |
| `linkedRegistrationId`, `linkedEntryId`, `linkedBy`, `linkedAt` | | solo `linked`; cancellati da Scollega |
| `decidedBy`, `decidedAt` | | rifiuto, riapertura, scollegamento |
| `createdAt`, `updatedAt` | string ISO | |
| `expiresAt` | Timestamp | data del viaggio + 7 giorni (se manca, chiusura + 14); campo TTL |

### Tentativo: due campi in più

`sourceRequestId` (id richiesta) e `fromGuestRequest: true`, scritti **solo** sui tentativi collegati: gli altri non hanno il campo. Lo
stato del tentativo resta quello di sempre. Il titolare (`ownerUid`) è quello
dell'iscrizione scelta: l'utente per `user_`, il genitore per `child_`, null
per `manual_`. `participantName` viene sempre dall'**iscrizione**, mai dal nome
digitato.

### Indici e ciclo di vita

Query solo su uguaglianza (`anonUid`, `status`, `personKey`): nessun indice
composito. TTL su `recordRequests.expiresAt` (collection group), da dichiarare
in `firestore.indexes.json` o via REST e **verificare in produzione** che sia
attivo. Il TTL cancella ma non è un controllo di accesso: le callable trattano
come inesistente una richiesta con `expiresAt` passato. `cleanupDeletedActivity`
cancella anche le richieste. Se la data del viaggio cambia, `expiresAt` non si
ricalcola (limite accettato, il viaggio è il 16/10: se slitta si rialza a mano). Se all'invio la
scadenza calcolata è già passata la richiesta non nasce ("chiuse"). Il TTL
cancella con un ritardo fino a circa un giorno. I tentativi (`recordEntries`) non hanno scadenza,
come oggi.

## Callable

Region `europe-west1`, gen2, `maxInstances` basso (limita il costo, non l'abuso).
Risposte `{ ok, action, ... }`. Codice nuovo in `functions/lib/recordNightGuest.js`.

### `recordNightGuest({ stakeId, activityId, action, ... })` (nuova)

| Azione | Auth | Cosa fa |
| --- | --- | --- |
| `context {}` | nessuna | `{ open, closeAt, intakeOpen, units: [{id,name}], records: [{id,title,category,measure,durationSeconds}] }`. `records` = `open` con `challengerCount > 0`, **vuoto se l'interruttore è spento** (D1: i titoli diventano pubblici solo dopo l'anteprima). `intakeOpen` = modulo acceso, finestra aperta, interruttore acceso |
| `submit { submissionId, kind, firstName, lastName, unitId, text?, measure?, durationSeconds?, needs?, recordId? }` | sessione **anonima** | crea la richiesta `open`; risposta sempre `{ ok, requestId }`. Un account vero riceve "Hai un account: accedi" |
| `mine {}` | sessione anonima | richieste con `anonUid == uid`, con lo stato per il richiedente (sotto) |
| `withdraw { requestId }` | anonima, titolare | solo `open` -> `withdrawn` |
| `restore { requestId }` | anonima, titolare | solo `withdrawn` -> `open`, con gli stessi tetti di `submit` |

Tetti dentro la transazione, per ogni ingresso **iniziato da un telefono** in
`open` (`submit` e `restore`): 12 richieste `open` per `anonUid` (e 40 create in
tutto), 2 `open` per `personKey` per `anonUid`, 100 `open` per attività. Gli
ingressi iniziati dallo staff (`reopenRequest`, `unlinkRequest`) non li
controllano: la coda può superare 100 per mano dello staff, mai di un telefono.
Un invio con lo stesso `submissionId` restituisce la richiesta già creata
qualunque sia il suo stato; un invio identico con `submissionId` nuovo da un'altra
sessione si accetta in silenzio e lo staff vede il raggruppamento. Errori sul
solo chiamante: "Hai già inviato il massimo di richieste da questo telefono.",
"Le iscrizioni ai record sono chiuse.", "Non riesco a riceverla ora. Parlane con
il dirigente della tua unità." (coda piena, interruttore spento, richiesta
scaduta).

Stato mostrato al richiedente (`mine`), derivato dalla richiesta e dal tentativo:

| `state` | Quando | Testo (da riusare dove esiste) |
| --- | --- | --- |
| `received` | `open` | "Richiesta ricevuta. La controlla un adulto." Dopo la chiusura: "Le iscrizioni sono chiuse. Se non vedi «Ci sei», parlane con il dirigente della tua unità." |
| `withdrawn` | `withdrawn` | "Ritiro fatto" + Annulla |
| `not_linked` | `rejected` | "Non siamo riusciti a collegare la richiesta. Se hai già l'iscrizione al viaggio, parlane con il dirigente della tua unità." |
| `pending` | `linked` + tentativo `pending` | "In attesa di approvazione" |
| `approved` | `linked` + `approved` | "Ci sei" |
| `rejected` | `linked` + `rejected` | "Non accettata" + motivo |
| `removed` | `linked` + `withdrawn` (chiunque) | "Non sei più in elenco. Se non lo volevi, parlane con un dirigente." |

Nessun campo dell'iscrizione, nessun altro tentativo della persona, nessun
contatore passa al telefono. `mine` mostra il **testo della richiesta**, non
quello del tentativo (se il titolare lo modifica i due divergono: è voluto). Il
titolo del record sfidato c'è solo se il record è `open`, ha sfidanti e
l'interruttore è acceso, altrimenti `null`. "Annulla" del ritiro può fallire se
nel frattempo si sono riempiti i tetti: l'errore lo dice e la richiesta resta ritirata.

### `recordNightAdmin` (staff): nuove azioni

- `listRequests {}` -> richieste con `status` `open`/`rejected`/`linked`/`withdrawn`,
  per le `linked` anche `entryStatus` e `withdrawnBy` del tentativo; per ogni `open`: `duplicates` (altre richieste con lo stesso `personKey`)
  e `suggestions` (max 3: `registrationId`, nome, unità, tipo
  user/child/manual, `activeEntries`, `alreadyOnRecord`), calcolate dal nome
  (stessa logica di `roomMateSuggestions`, estratta in un modulo comune) con
  bonus se l'unità coincide. Solo iscrizioni attive `user_`/`child_`/`manual_`.
  Filtro "Senza abbinamento" per ripulire in fretta.
- `linkRequest { requestId, registrationId, verified: true }` (idempotente: già
  collegata alla stessa iscrizione restituisce lo stato) -> **una
  transazione che rilegge tutto** (autorizzazione, attività, richiesta,
  iscrizione, tentativi della persona, record): i suggerimenti non valgono come
  prova. Richiesta `open`; iscrizione attiva; `challenge`: record non nascosto,
  `assertNotAlreadyInRecord`, `assertEntryLimit`, crea tentativo `approved`
  (`createdByAdmin`, `decidedBy`) e +1 al contatore; `proposal`: `assertEntryLimit`,
  `assertNoDuplicateProposal`, crea tentativo `pending` (poi Approva/Unisci/Rifiuta
  come oggi). La richiesta passa a `linked`. `verified !== true` è un errore.
- `rejectRequest { requestId, note? }` e `rejectRequests { requestIds (max 50), note? }`
  -> `rejected`, nota interna. Solo richieste `open`; ripetuto su una già
  rifiutata non cambia nulla; il blocco rifiuta quelle ancora `open` e salta le
  altre (`rejectedCount`, `skippedCount`).
- `reopenRequest { requestId }` -> `rejected` o `withdrawn` -> `open`, senza tetti e senza controllo di finestra.
- `unlinkRequest { requestId }` -> una transazione. Sul tentativo collegato, da
  **qualunque** stato (`pending`, `approved`, `rejected`, `withdrawn`): lo porta
  a `withdrawn`, `withdrawnBy: staff`, `statusBeforeWithdraw: null`,
  `withdrawnWithRecordHide: false` (nessun "Annulla" o "Mostra di nuovo" lo
  rimette), contatore -1 solo se era `approved`, una volta sola. Se il tentativo
  aveva creato un record e questo resta a zero, il record si nasconde (niente
  doppioni dopo il ricollegamento). Richiesta a
  `open`, legame cancellato. Collega di nuovo crea un tentativo **nuovo**: le
  decisioni prese (approvazione) e le modifiche del titolare non tornano, e lo
  scollegato resta fra i "Ritirati" del titolare. La conferma in riga lo dice. Se il tentativo è una proposta approvata che ha
  creato un record, prima si usa "Riporta in attesa" (esiste già): l'errore lo dice.
  È il ritorno universale dello staff: Scollega, poi Collega di nuovo.

Dopo la chiusura lo staff può ancora collegare, scollegare, rifiutare e riaprire
(come `addParticipant`): la sera della serata si sistema in presenza. Il
trigger sulle iscrizioni annullate continua a ritirare i tentativi; la richiesta
resta `linked` e il telefono vede `removed`.

## Rules

```
match /recordRequests/{requestId} {
  allow read, write: if false;   // solo callable (anche lo staff)
}
```

Il match è esplicito (gate delle rules). Nessun altro cambio: `records`,
`recordEntries` e `units` come oggi. Test emulatore: admin, dirigente, staff
scelto, partecipante, anonimo e non autenticato non leggono né scrivono.

## Matrice stati e ritorni

Colonne: **P** telefono del richiedente · **P2** altro telefono o sessione
persa · **A** account titolare dell'iscrizione collegata (utente o genitore) ·
**S** staff, pagina Gestisci · **E** tutti gli altri. "Annulla" riporta allo
stato di prima. Per lo staff il ritorno universale di una richiesta collegata è
**Scollega -> 1**, poi Collega di nuovo; "Riporta in attesa" e "Iscrivi qualcuno"
restano ma non valgono per ogni caso (una sfida non si riapre, una proposta
ritirata non si ripristina con "Iscrivi qualcuno").

| Stato | P | P2 | A | S | E |
| --- | --- | --- | --- | --- | --- |
| 0. Nessuna richiesta | Accedi (primo, con ritorno alla pagina) oppure "Segnati senza account" -> foglio. Chiudere il foglio non salva nulla | come P | n/a | n/a | vede l'elenco (D1), nessun dato di nessuno |
| 1. `open`, ricevuta | "Ricevuta, la controlla un adulto" (nulla sull'iscrizione). **Ritira** -> 2 | non la vede. Può inviarne un'altra: duplicato accettato in silenzio | nulla | "Da collegare": **Collega a…** -> 3 o 4, **Non collegabile** -> 7 (anche in blocco). Duplicati raggruppati, non rifiutati da soli | nulla |
| 2. `withdrawn` dal richiedente | avviso "Ritiro fatto" con **Annulla** -> 1 (copre il toast); poi sezione "Ritirate" con **Ripristina** -> 1 (finestra aperta, tetti rispettati) | non la vede | nulla | sparisce dalla coda; sezione chiusa "Richieste ritirate" con **Riapri** -> 1 (dopo la chiusura o con il telefono perso è l'unica strada) | nulla |
| 3. `linked` + tentativo `pending` | "In attesa di approvazione", sola lettura. "Per ritirarti parlane con un dirigente" | non la vede | tentativo in "I tuoi record" con etichetta "Da una richiesta senza account": Modifica, **Ritira** (Annulla) | tentativo in "Proposte in attesa" con la stessa etichetta: Approva / Unisci / Rifiuta -> 4 o 5. Sulla richiesta **Scollega** -> 1 | nulla |
| 4. `linked` + tentativo `approved` | "Ci sei", sola lettura | non la vede | "Ci sei", **Ritirati** | Riporta in attesa -> 3 (solo proposte), Ritira (staff) -> 8; **Scollega** -> 1 (se il record è nato da questo tentativo, prima Riporta in attesa) | conta fra gli sfidanti (anonimo) |
| 5. `linked` + tentativo `rejected` | "Non accettata" + motivo. Può inviare un'altra richiesta (non conta nel limite) | non la vede | "Non accettata" + motivo | sezione "Non accettate" esistente: Riporta in attesa -> 3. **Scollega** -> 1 | nulla |
| 6. `linked` + ritirato dal titolare (solo `user_`/`child_`; un `manual_` non ha titolare) | "Non sei più in elenco. Se non lo volevi, parlane con un dirigente" | non la vede | "Ritirati" con **Ripristina** -> 3 o 4 (se limite e record lo consentono, altrimenti l'errore lo dice) | sezione "Ritirati": "Ritiro del partecipante". **Scollega** -> 1 | nulla |
| 7. `rejected`, non collegata | testo neutro identico per ogni motivo; può inviare una nuova richiesta | non la vede | nulla | sezione chiusa "Non collegate" con **Riapri** -> 1 | nulla |
| 8. `linked` + ritirato da staff o sistema (anche iscrizione annullata) | "Non sei più in elenco. Se non lo volevi, parlane con un dirigente"; può inviare una nuova richiesta | non la vede | "Tolto da un adulto" / "Iscrizione annullata", senza Ripristina | "Ritirato da un adulto" / "Iscrizione annullata"; se nascosto col record rientra con "Mostra di nuovo". **Scollega** -> 1 | nulla |
| 9. Dopo la chiusura | tutto in sola lettura; `received` dice "Le iscrizioni sono chiuse…" | come P | come P | **può ancora** collegare, scollegare, rifiutare, riaprire (anche la sera) | solo elenco |
| 10. Interruttore spento | nessun "Segnati senza account"; le richieste già inviate si vedono e si ritirano | come P | come P | si riaccende dall'editor attività | solo elenco |
| 11. Coda piena (100) | errore neutro all'invio, senza dire perché | come P | n/a | vede il contatore; spegne l'interruttore o rifiuta in blocco ("Senza abbinamento") | solo elenco |
| 12. Modulo spento (`recordsEnabled` false) o attività eliminata | "La Notte dei Record non è attiva" | come P | come P | niente coda; i dati restano fino al TTL (eliminata: cancellati) | |

### Flusso dell'utente che sbaglia (da giocare nel browser)

1. Nome scritto male: Ritira (con Annulla) e rifà. Lo staff comunque sceglie
   l'iscrizione, non il nome digitato.
2. Foglio chiuso a metà: nessun dato sul server.
3. Doppio tocco su Invia o risposta persa: una sola richiesta (`submissionId`).
4. Unità sbagliata: indizio, non vincolo; ritira e rifai, o lo staff collega lo stesso.
5. Ha già l'account: "Accedi" sempre per primo; dopo il login ritorno alla pagina.
   La sessione anonima si perde: le richieste fatte prima restano in coda e lo
   staff le confronta con i tentativi della persona (suggerimenti "ha già N
   record"); non si presumono duplicate.
6. Cambia telefono o cancella i dati del sito: non vede più la richiesta; la
   pagina lo dice ("Le vedi solo da questo telefono"), lo staff la gestisce.
7. Più persone dallo stesso telefono: fino a 12 richieste, 2 per persona (vedi sotto).
8. Prova a ritirare dopo la chiusura: messaggio di chiusura, nessuna azione.
9. Lo staff collega la persona sbagliata: **Scollega** (la persona collegata
   vede "Tolto da un adulto" e può ritirarsi da sola prima); l'etichetta "Da
   una richiesta senza account" avvisa il titolare dell'account.
10. Due richieste per la stessa persona da due telefoni: la seconda al
    collegamento dà "Già in gara per questo record" o "Questa proposta è già
    presente": lo staff la segna non collegabile.
11. Lo staff rifiuta per errore: **Riapri**; il telefono non ha visto nulla di diverso.

## Più persone dallo stesso telefono

Caso reale (Paolo, 2026-10-10): fratelli o amici senza account che si passano
un telefono. Il "telefono" è la sessione anonima; la "persona" è `personKey`
(nome, cognome, unità normalizzati).

- Persone diverse dallo stesso telefono sono richieste distinte: ognuna fino a 2,
  fino a 12 in tutto. Possono proporre lo stesso testo o sfidare lo stesso
  record: il server le crea tutte (lo staff le unisce).
- **Idempotenza per persona, non per telefono**: se la stessa sessione ha già una
  richiesta `open` con lo stesso `personKey` e lo stesso contenuto (sfida: stesso
  record; proposta: stesso testo, misura, durata) `submit` restituisce quella,
  con la stessa risposta di una creazione, anche se il telefono è al tetto.
  Una richiesta ritirata, rifiutata o collegata non conta come duplicata.
- "Sfida" non si spegne mai per un record già sfidato dal telefono: l'etichetta
  "Già richiesta da questo telefono" informa, e solo se nome, cognome e unità
  digitati coincidono con una richiesta attiva per quel record il foglio avvisa e
  blocca l'invio.
- Le richieste di un telefono le vede e le ritira **chiunque lo usi**
  (carte ordinate per persona; il sottotitolo e la nota del foglio lo dicono).
  È il prezzo di non avere un account: chi vuole riservatezza usa il login.
- Dopo il collegamento il telefono vede lo stato di ogni sua richiesta, quindi
  chi lo usa vede anche lo stato "Ci sei" delle altre persone: accettato.
- Due omonimi con la stessa unità dallo stesso telefono contano come una
  persona sola (tetto 2 in due): caso raro, lo staff li distingue al collegamento.

## UI

Mockup da fare dopo le decisioni (coi token di `src/styles/recordNight.css`,
screenshot aperto a schermo, confronto a misura reale).

- **Pagina record, senza login**: in cima la card "Accedi" (primo, tasto
  principale, una riga sul perché: "vedi subito i tuoi record e li gestisci
  anche per i figli"). Sotto, tasto secondario "Non hai l'account? Segnati con
  nome e unità". Poi regole, scadenza e l'elenco dei record (D1). "Sfida" su
  un record apre il foglio con le due strade, login per prima.
- **Foglio "Senza account"**: nome, cognome, unità (menu delle unità attive),
  poi campi della proposta o titolo del record sfidato. Nota fissa: "Un adulto
  controlla ogni richiesta. Finché non è approvata non conta e non la vede
  nessuno. La vedi e la ritiri solo da questo telefono."
- **"Le tue richieste da questo telefono"**: carte con lo stato di `mine`.
- **Gestisci**: sezione "Da collegare (N)" sopra le proposte in attesa, filtri
  per unità (la propria in alto) e "Senza abbinamento"; carta con nome digitato,
  unità, testo, suggerimenti (nome, unità, tipo account/figlio/inserito a mano,
  "ha già N record", "già su questo record" non selezionabile), "Non è nessuna
  di queste: cerca per nome" (riusa `listParticipants`), la spunta di verifica e
  **Collega** (attivo solo con scelta e spunta), **Non collegabile**, selezione
  per rifiutare in blocco (fino a 50). Sezioni chiuse "Collegate" (con
  **Scollega** e conferma in riga), "Non collegate" (con **Riapri**) e
  "Richieste ritirate" (si chiama così per non confondersi con "Ritirati" dei
  tentativi). Il link Gestisci dice "N da collegare · M proposte".
- **Editor attività**: interruttore "Record senza account" (non "senza account"
  da solo: nello stesso foglio c'è "Consenti iscrizione senza account", che è
  un'altra cosa) con l'anteprima pubblica; per accenderlo si spunta "Ho
  controllato i titoli". L'avviso "Il titolo lo vedono tutti, anche senza
  account: niente nomi." compare anche in Approva, "Nuovo record" e "Modifica il record".
- **I tuoi record (con account)**: etichetta "Da una richiesta senza account" sui
  tentativi con `fromGuestRequest`, più la riga "Un adulto l'ha collegata a
  questa iscrizione."
- **Ordine della pagina senza login**: intestazione, card "Hai un account?
  Accedi" (sempre prima, anche se il telefono ha richieste), poi "Le tue
  richieste da questo telefono" se ci sono, poi tabellone, regole, elenco. Con
  l'interruttore spento resta il gate di oggi ("Accedi per vedere i record").
  La nota "Un adulto controlla ogni richiesta…" sta sopra i tasti del foglio,
  non fissa. Dopo l'invio: scroll alla sezione e avviso "Richiesta inviata.".
  Mockup approvati da Paolo il 2026-10-10 in
  `.claude/mockups/notte-dei-record/senza-account/` (fuori da git).

Sessione anonima: si crea **solo** quando l'utente invia (non alla visita) e
usa il `signInAnonymously` già in `AuthProvider`. L'elenco (`context`) non la richiede.

## Privacy e ciclo di vita

- La pagina privacy dice che le richieste senza account raccolgono nome,
  cognome, unità e testo, visibili solo allo staff, cancellati 7 giorni dopo il viaggio.
- Nessun IP e nessun nome nei log: si registrano azione, id, `anonUid`.
- Cancellazione dell'attività: record, tentativi, richieste, staff.
- Account anonimi Firebase: restano come oggi (nessun dato personale dentro).
- Il titolo di un record è pubblico (D1): anteprima all'accensione, promemoria
  nell'Approva, `noindex`.

## Test e review

- Rules (emulatore): `recordRequests` illeggibile e inscrivibile da tutti.
- Logica (senza emulatore): tetti, `personKey`, punteggio suggerimenti, stato
  per il richiedente, effetti di Scollega da ogni stato.
- Callable (emulatore, utenti veri): flusso completo; **invio di un nome iscritto,
  uno sconosciuto e un duplicato = risposte identiche** (stessa forma e messaggi);
  tetti 12/2/100 anche su `restore`, non su `reopen`/`unlink`; account vero
  rifiutato; collegamento senza `verified` rifiutato; limite di 2 e unicità;
  Scollega da ogni stato (contatore una volta sola, nessun "Annulla" residuo);
  chiusura, interruttore, `recordsEnabled` spento; trigger sull'iscrizione
  annullata; gare link/ritiro/trigger; sequenze casuali con seed fisso.
- Prova di carico dell'abuso: N sessioni anonime scriptate fino al tetto,
  poi recupero con interruttore e rifiuto in blocco.
- Browser (script in `.claude/mockups/notte-dei-record/qa/`): flusso anonimo,
  coda staff, utente che sbaglia (elenco sopra), 390 px.
- Chi scrive non scrive i test né rivede: agenti diversi, uno per dimensione
  (sicurezza/privacy, stati e ritorni, rules e dati, copy). Alla review si
  chiede: "come si torna indietro da ogni stato?" e "cosa rivela questa risposta?".

## Rilascio

1. Rules + indici + TTL (verifica policy attiva), poi funzioni, poi hosting con SW v13.
2. Interruttore spento al deploy; si accende da editor dopo anteprima pubblica
   e prova su un account vero.
3. Ogni deploy solo con conferma fresca di Paolo.

## Rischi

- Un bot che crea sessioni anonime riempie la coda (100) e blocca i legittimi:
  difese = interruttore, rifiuto in blocco, filtro "Senza abbinamento". Un
  telefono non si può bloccare (le sessioni sono gratis). App Check o
  Turnstile solo se si vede abuso (richiede preparazione, non adesso).
- Staff distratto che collega a chi non è: spunta sulla richiesta, etichetta
  all'account titolare, Scollega (valido da ogni stato).
- TTL non attivo in produzione: controllo esplicito prima di dichiarare fatto.
- Fase 2 sullo stesso `recordNight.js`: il codice nuovo sta in
  `recordNightGuest.js`, gli helper condivisi si esportano.
