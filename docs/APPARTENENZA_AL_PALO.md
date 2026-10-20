# Registrazione e appartenenza al palo

Stato: **approvata da Paolo il 2026-10-16**. Roadmap:
[ROADMAP_PALI.md](ROADMAP_PALI.md) (sessioni S1 e S2; il primo passo di accesso
esce con S3).

Tre problemi:

1. **Appartenenza autodichiarata.** `isStakeMember` (`firestore.rules:75`) vale
   per chiunque non sia anonimo e abbia `users/{uid}.stakeId == stakeId`, un
   campo che l'utente scrive da solo (`canCreateOwnUser` r.995, `canUpdateOwnUser`
   r.1003, limitato a pali esistenti dal 2026-10-10). Basta registrarsi con Roma
   Est per leggere e caricare foto e video della galleria, leggere i record
   aperti, mettere like e commenti.
2. **Primo passo confuso.** Login e registrazione sono un unico form
   (`AuthAccessPanel.tsx`); il palo non si sceglie mai (default `roma-est` o
   l'ultimo visto in `localStorage`); "sei un genitore?" è un `window.confirm`
   che scatta se la data di nascita supera i 20 anni; gli errori di Firebase
   arrivano in inglese (`toUserFacingAuthError` traduce un solo codice).
3. **Consensi foto e social facoltativi.** Il modulo di firma
   (`ParentConfirmPage.tsx`, passo "Foto e video") offre "Decido dopo" e non
   blocca il passo; la callable `parentAuthorizationConfirm` trasforma ogni
   valore mancante in `not_answered` (`sanitizePhotoConsent`). Nessuna vista
   staff mostra `parentAuthorization.photoConsent`: export e unità leggono
   `answers.photoInternalConsent`, che è un'altra cosa (spunta dei maggiorenni
   nel modulo d'iscrizione).

Stessa classe, trovata nell'analisi: `surveyQuestions` e una singola
`surveyResponses` (`get`) sono leggibili da qualunque sessione, anche anonima e
di un altro palo (il `list` delle risposte è solo admin). Si chiude in S2 con lo
stesso controllo di appartenenza; la proprietà delle bozze di risposta resta da
rivedere a parte.

La callable `activityGallery` (`functions/lib/activityGallery.js:106`) decide
dal profilo (`users.stakeId`), non dalle rules: va spostata sull'appartenenza
nello stesso giro, altrimenti rules e server dicono cose diverse.

---

## Parte A. Consensi foto e social (sessione S1)

### Dati attuali (produzione, sola lettura)

| Attività | Firmate | Foto: sì / no / senza risposta | Social: sì / no / senza risposta |
| --- | --- | --- | --- |
| Viaggio al tempio 16/10 | 59 | 45 / 1 / **14** | 48 / 2 / **10** |
| Attività precedente (concluse) | 55 | 47 / 0 / **8** | non contato |

Sei firme del viaggio hanno "social: sì" e "foto: senza risposta": la scelta
lasciata aperta produce combinazioni incoerenti.

### Proposta

1. **Scelta obbligatoria.** Nel passo "Foto e video" restano due opzioni per
   domanda, "Acconsento" e "Non acconsento", nessuna preselezionata. "Avanti" è
   disattivo finché entrambe non hanno una risposta; il messaggio sotto il
   bottone dice quale manca. "Decido dopo" sparisce (vedi C2).
2. **Callable.** `parentAuthorizationConfirm` rifiuta `invalid-argument` con
   messaggio italiano se uno dei due valori non è `accepted` o `refused`. Il
   valore `not_answered` resta valido solo per i documenti già scritti e per i
   template creati prima della firma. Compatibilità: una scheda lasciata aperta
   o una PWA con la shell vecchia mandano ancora `not_answered`; ricevono
   l'errore con il testo "Scegli una risposta per le foto e per i social" e il
   bottone per ricaricare. Il service worker si aggiorna nello stesso deploy.
   Ogni scelta salva anche la versione dell'informativa mostrata
   (`consentTextVersion`).
3. **Social sì implica foto sì.** Se il genitore sceglie "Acconsento" ai social
   e "Non acconsento" alle foto, il modulo lo segnala ("Per pubblicare sui
   social serve anche il consenso alle foto") e la callable rifiuta la
   combinazione.
4. **Strada indietro (revoca).** Il genitore cambia la scelta in qualunque
   momento: dalla pagina famiglia (`/family`, scheda del figlio, "Consensi foto")
   per chi ha l'account, e dal link "Cambia le scelte su foto e social" nella
   copia firmata via mail per chi non ce l'ha. Il cambio non rifà la firma: scrive
   `photoConsent`/`socialPublicationConsent`, `consentUpdatedAt` e una riga nel
   log di audit (`revoked` resta il valore per "prima sì, ora no"). La copia PDF
   firmata non si rigenera; il log è la fonte, e il genitore riceve una ricevuta
   via mail con la scelta nuova. Una revoca non toglie da sola le foto già
   fatte: crea per gli admin un compito "Consenso foto revocato per Marco R.:
   controlla album e social" con stato (da fare / fatto), e la pill
   dell'iscritto diventa "Foto: revocato".
5. **Lo staff vede il consenso.** Nella tab Iscritti e nella scheda
   dell'iscritto: pill "Foto: sì / no / da chiedere". Nell'export Excel due
   colonne. Nella vista unità lo stesso. È la cosa che serve davvero sul posto:
   sapere chi non fotografare.

### Firme già raccolte (scelta C1)

| Opzione | Cosa succede | Pro | Contro |
| --- | --- | --- | --- |
| **C1-a (consigliata)** | "senza risposta" vale come **nessun consenso** ovunque. Una callable manda ai genitori interessati (22 firme) una mail con il link "Completa le scelte su foto e social": pagina con le sole due domande, nessuna nuova firma, scrittura come la revoca | rispetta la regola "il silenzio non è consenso"; pochi minuti per il genitore | 22 mail da mandare (azione verso l'esterno: serve il tuo ok sul testo e sull'invio) |
| C1-b | Si chiede di rifirmare tutto il modulo | documento unico e completo | peso sproporzionato, molti non lo rifaranno |
| C1-c | Si lascia così, conta solo per le firme nuove | nessun lavoro | i 22 restano ambigui per sempre |

Per il viaggio di domani nessuna di queste è pronta: se vuoi, ti preparo in
privato (fuori dal repo) l'elenco dei 14 ragazzi con la foto senza risposta,
da dare a chi scatta per l'album dello staff.

### Stato di S1: in produzione dal 2026-10-18

Rilasciata il 2026-10-18 nell'ordine rules → functions (`parentConsentGetContext`,
`parentConsentUpdate`, `parentConsentRequestCompletion`, più `onRoomRegistrationUpdated`
delle stanze) → hosting con service worker v19. Verificato: ruleset live identico a
git, callable che rispondono con gli errori previsti, pagina `/parent-consent` con
link non valido. La mail di completamento ai genitori non è ancora stata inviata.

Decisioni C1-a e C2-a approvate. Codice costruito su `main` il 2026-10-16, deploy
rimandato a dopo il viaggio del 16-18/10 (galleria in uso). Dati prod riletti il 2026-10-16 in sola lettura:

| Attività | Firmate (non annullate) | Foto senza risposta | Social senza risposta | Con almeno una scelta mancante |
| --- | --- | --- | --- | --- |
| Viaggio al tempio | 60 | 14 | 10 | 17 |
| Attività precedente | 52 | 7 | 2 | 7 |

Totale destinatari della mail di completamento oggi: **24** (la stima di 22
era del 15/10), più 4 firme annullate che non la ricevono. Firme con social sì
e foto non sì: 11 (incoerenti, la pill e l'export le trattano come social "da
chiedere").

| Pezzo | Dove |
| --- | --- |
| Logica dei consensi, link di gestione | `functions/lib/consentCore.js` |
| `parentAuthorizationConfirm` con scelte obbligatorie, `consentTextVersion`, link nella copia firmata | `functions/lib/parentAuthorization.js` |
| `parentConsentGetContext`, `parentConsentUpdate` (cambio, ricevuta, compito admin), `parentConsentRequestCompletion` (simulazione di default) | `functions/lib/parentConsent.js` |
| Mail (copia firmata con link, ricevuta, completamento) | `functions/lib/brevo.js` |
| Rules `consentTasks` | `firestore.rules` |
| Modulo, pagina `/parent-consent/:token`, riga in `/family` | `src/components/ConsentChoices.tsx`, `src/pages/public/`, `src/pages/family/` |
| Pill staff, compiti, export, pannello di completamento | `src/components/PhotoConsentPills.tsx`, `AdminEventDetailPage`, `UnitActivityPage`, `registrationExcel.ts` |

Dati: `parentAuthorization.consentTextVersion`, `consentUpdatedAt`,
`consentCompletionRequestedAt` (dentro la mappa già ammessa dalle rules, nessuna
allowlist da toccare); collection server-only `parentConsentLinks/{hash}` (link
di un anno, valido solo se la mail del genitore non è cambiata);
`activities/{a}/consentTasks/{id}` (compiti, solo admin).

Procedura di rilascio (dopo il 18/10, con conferma esplicita): rules, poi
functions (`parentAuthorizationConfirm`, `parentConsentGetContext`,
`parentConsentUpdate`, `parentConsentRequestCompletion`), poi hosting con
service worker aumentato. Subito dopo l'hosting: Matteo Conti di prova non c'è
in prod, quindi provare con un account QA. La mail ai 24 genitori si manda
dal pannello "Scelte su foto e social da completare" nella tab Consensi
dell'attività: prima "Controlla chi riceverebbe la mail", poi l'invio, che
richiede il numero di destinatari visto e una conferma.

Aperto (non fatto in S1): link di gestione per le firme già raccolte con
entrambe le scelte (le loro copie firmate non lo contengono: chi non ha
l'account chiede al dirigente); cancellazione di `parentConsentLinks` e
`consentTasks` nella pulizia account (nel repo non c'è un flusso di
cancellazione account); notifica push agli admin per i nuovi compiti; l'admin
può ancora riscrivere `parentAuthorization` dalle rules (preesistente).

---

## Parte B. Appartenenza verificata (sessione S2)

S2 parte da un **contratto di autorizzazione** scritto e provato prima del
codice applicativo: matrice ruolo × stato di appartenenza × dato (galleria,
media su Storage, record, sondaggi, momenti), con un test nell'emulatore per
ogni cella usando l'SDK client e le query esatte dell'app, compresa la PWA
vecchia ancora in cache.

### Modello

`stakes/{stakeId}/members/{uid}`, scritto **solo dal server** (callable
`stakeMembership`, `stakePeople` e trigger), letto dal titolare e dallo staff
competente. Esiste per **tutti**, staff compreso: è l'unico documento che rules
Firestore e Storage devono leggere per sapere se qualcuno è dentro.

| Campo | Tipo | Note |
| --- | --- | --- |
| `status` | `pending` \| `active` \| `declined` \| `withdrawn` \| `removed` \| `blocked` | `withdrawn` = richiesta ritirata dall'utente o uscita volontaria; `blocked` = rimozione per sicurezza, che nessun codice o invito riattiva (solo un admin) |
| `sources` | array di `{kind, ref, at}` | tutti i motivi indipendenti di appartenenza: `migration`, `link_code`, `parent_link`, `manual_registration`, `staff_approval`, `staff_invite`. Togliere un motivo (es. "Scollega") non tocca gli altri |
| `previous` | map \| null | stato e motivi prima dell'ultima azione, per "Annulla" |
| `staffRole` | `admin` \| `unit_leader` \| null | copia server del ruolo, così Storage non deve leggere anche il profilo |
| `claimedUnitId`, `claimedUnitName` | string | unità dichiarata, per instradare la richiesta |
| `displayName`, `birthYear` | string, int \| null | copie per la coda, niente data completa |
| `registrationHints` | array ≤ 5 di `{activityId, title}` | contesto per chi approva, calcolato dal server |
| `staffNote` | string ≤ 200 | solo staff: es. "stesso nome e data di un membro attivo" (mai mostrato al richiedente) |
| `reviewNeeded` | bool | membri migrati da confermare (vedi A3) |
| `requestedAt`, `decidedAt` | Timestamp | `serverTimestamp()` |
| `decidedBy` | uid \| `system` | |
| `declineCount` | int | |
| `version` | int | ogni scrittura lo incrementa; "Annulla" passa la versione che ha visto e fallisce se nel frattempo qualcuno ha cambiato il documento |

`users/{uid}.stakeId` resta: diventa **il palo scelto**, cioè dove l'utente
vuole entrare e cosa mostrano le pagine pubbliche. Non dà più nessun permesso.

### Chi vede, chi scrive

| Dato | Utente (sé) | Membro attivo | Dirigente di unità del palo | Admin del palo | Super admin |
| --- | --- | --- | --- | --- | --- |
| `members/{uid}` proprio | legge (senza `staffNote`: il campo vive in `members/{uid}/staff/note`, leggibile solo dallo staff) | legge | legge | legge | legge |
| `members` del palo (list) | no | no | solo `claimedUnitId == ` la propria unità (la query deve filtrare per unità) | tutti | tutti |
| Creare la richiesta | callable `request`, solo per sé, palo esistente, non anonimo, tetti | | | | |
| Ritirare la richiesta, uscire dal palo | callable, per sé | | | | |
| Approvare / rifiutare | no | no | callable, solo la propria unità; "Non è della mia unità" la passa agli admin | callable, tutte | callable |
| Rimuovere, bloccare | no | no | no | callable, non sé stesso, non l'ultimo admin | callable |
| Scrittura client diretta | **mai** (rules `if false`) | | | | |

Rules:

```
function memberDoc(stakeId) {
  return /databases/$(database)/documents/stakes/$(stakeId)/members/$(request.auth.uid);
}
function isStakeMember(stakeId) {          // stesso nome, nuovo significato
  return isNonAnonymousSignedIn()
    && exists(memberDoc(stakeId))
    && get(memberDoc(stakeId)).data.status == 'active';
}
match /stakes/{stakeId}/members/{uid} {
  allow get: if isSelf(uid) || isStakeAdmin(stakeId)
    || (isUnitLeaderOfStake(stakeId) && resource.data.claimedUnitId == currentUser().unitId);
  allow list: if isStakeAdmin(stakeId)
    || (isUnitLeaderOfStake(stakeId) && resource.data.claimedUnitId == currentUser().unitId);
  allow create, update, delete: if false;
}
```

Lo staff è membro come gli altri (documento con `status: active` e
`staffRole`), quindi `isStakeMember` non deve più leggere anche il profilo.

**Storage**: le rules Storage possono leggere al massimo due documenti Firestore
per richiesta e ogni lettura si paga. Oggi la galleria legge il profilo; con la
proposta legge **solo** `members/{uid}` (e il documento galleria dove serve la
finestra di caricamento): mai profilo + appartenenza + galleria insieme. Va
provato nell'emulatore Storage con upload, lettura e cancellazione.

**URL già distribuiti**: i link di download con token di Storage restano validi
anche dopo una rimozione. Chi viene rimosso o bloccato perde l'accesso
all'elenco e ai nuovi file, ma un link già salvato continua ad aprire la foto.
Mitigazione: la galleria non mostra mai URL con token permanenti nell'elenco
(si genera al bisogno con `getBlob`/`getDownloadURL` dopo il controllo), e la
revoca dei token sul singolo file resta lo strumento per i casi gravi (già
usata dalla segnalazione).

Dove passa da `users.stakeId` a `isStakeMember`: `galleries`, `media`, like,
commenti, segnalazioni, Storage della galleria, `records` (r.1484, oggi controlla
`currentUser().stakeId` direttamente), `surveyQuestions`/`surveyResponses`, le
callable `activityGallery` e `recordNightParticipant`, e i momenti del blocco 3.
**Non** cambia: iscriversi a un'attività pubblica, leggere attività e unità
pubbliche, le proprie iscrizioni.

**Ruoli e appartenenza restano coerenti**: oggi `isStakeAdmin` e
`isUnitLeaderOfStake` leggono solo il ruolo del profilo, e un admin può
riscrivere il ruolo di un altro direttamente da client
(`canAdminAssignUserRole`, r.1049), senza guardie né audit. In S2 la rimozione
o il blocco di un membro con ruolo staff lo riporta anche a `participant` nella
stessa transazione; in S4 la scrittura diretta del ruolo da client si chiude
(tutto passa da `stakePeople`).

### Come si diventa membro attivo (scelta A1)

| Via | Effetto | Perché |
| --- | --- | --- |
| Migrazione (account esistenti, A3) | vedi sotto | |
| Codice di collegamento dato dallo staff sul posto (blocco 1) | `active` | una persona dello staff ha visto il ragazzo |
| Collegamento a un'iscrizione `manual_` con il codice | `active` | l'admin conosce la persona |
| Invito dello staff (blocco 4) | `active` dopo la conferma finale dell'admin | il link può essere inoltrato |
| Collegamento fatto dal genitore (blocco 1) | **in coda**, con la richiesta già compilata: "Collegato dal genitore Paola R. all'iscrizione al Viaggio al tempio" | essere genitore membro non prova che quel figlio esista: chi approva lo conosce in un tocco |
| Genitore di un ragazzo attivo | in coda con "Genitore di Marco R." | stesso motivo, al contrario |
| Registrazione libera, anche con iscrizione a un'attività | in coda | chiunque può iscriversi a un'attività pubblica: l'iscrizione da sola non dimostra niente |

### Migrazione (scelta A3)

Script idempotente con dry-run (`functions/scripts/migrateStakeMembers.js`).
Un'iscrizione libera non prova l'appartenenza, ma togliere oggi la galleria a
135 persone durante l'anno sarebbe un costo vero. Proposta:

| Gruppo | 2026-10-15 | 2026-10-20 | Stato |
| --- | --- | --- | --- |
| admin, unit_leader | 31 | 31 (10 admin, 21 dirigenti) | `active`, `staffRole` |
| participant/parent con almeno un'iscrizione inviata e non chiusa nel palo (propria, di un figlio, o da ospite poi collegato allo stesso account; non contano bozza, annullata, rifiutata dal genitore) | ~104 | 108 (101 participant, 7 parent) | `active` con `reviewNeeded: true` |
| account senza iscrizioni | 45 | 41 (39 participant, 2 parent) | `pending`, etichetta "account esistente" |

Riletti il 2026-10-20 in sola lettura (solo conteggi): 180 profili, tutti
`roma-est`; dei 108 con iscrizione, 90 solo con iscrizioni proprie, 6 solo come
genitore, 1 solo da ospite collegato, 11 misti. 8 participant non hanno
un'unità nel profilo e una unità con un iscritto non ha dirigenti: quelle
richieste vanno agli admin. 48 uid hanno iscrizioni ma nessun profilo (sessioni
ospite): non diventano membri.

Ogni dirigente trova in Persone "Conferma i membri della tua unità": elenco con
"Lo conosco" (toglie `reviewNeeded`) e "Non lo conosco" (passa in coda, accesso
sospeso). Dopo 30 giorni, chi è ancora da confermare compare agli admin in
evidenza. Ordine di deploy: script in dry-run, script reale, **poi** rules
(altrimenti per qualche minuto nessuno vede la galleria), poi callable e client.

### Tetti

- Una richiesta `pending` per utente e palo; dopo un rifiuto, nuova richiesta
  solo dopo 7 giorni e massimo 3 rifiuti, poi serve il codice di uno staff.
- Cambio di palo: una richiesta aperta alla volta; la vecchia appartenenza resta
  finché la nuova non è attiva, poi passa a `withdrawn` (non `removed`) nello
  stesso momento in cui la nuova diventa `active`. L'admin del palo vecchio vede
  "è passato a X".

### Stati e ritorni

| Stato | Cosa vede l'utente (`/me`, home) | Cosa vede lo staff | Da qui dove si va, e come si annulla |
| --- | --- | --- | --- |
| `pending` | banner "Stiamo verificando che tu faccia parte del palo" con "Hai un codice da un dirigente?" e "Chi verifica?"; attività e iscrizioni libere; galleria e record con "Si sbloccano dopo la verifica" | coda "Richieste di accesso", badge | → `active` (approva o codice), → `declined`; l'utente "Ritira la richiesta" → `withdrawn` |
| `active` | tutto | Persone | → `removed` o `blocked` (admin); l'utente "Esci dal palo" → `withdrawn` con conferma |
| `declined` | testo unico: "Non siamo riusciti a confermare che fai parte del palo. Se pensi sia un errore chiedi un codice a un dirigente." + contatto del palo. Mai il motivo interno | "Rifiutate", 30 giorni | staff: "Annulla rifiuto" → stato e motivi di prima (`previous`); utente: nuova richiesta dopo 7 giorni, o codice |
| `withdrawn` | "Non fai parte di nessun palo" + "Chiedi di entrare" | "Usciti" | utente: nuova richiesta (stessi tetti); staff: nessuna azione necessaria |
| `removed` | "Non fai più parte di questo palo" + contatto | "Rimossi" | staff: "Riattiva" → stato, motivi e ruolo di prima; un codice di collegamento lo riattiva |
| `blocked` | uguale a `removed` | "Bloccati", con nota | solo un admin: "Sblocca" → `pending` (non `active`): va riverificato |

Ogni azione dello staff mostra un toast con "Annulla" (5 secondi) che
ripristina `previous` se `version` non è cambiata; l'annullamento entra nel log.

### Utente che sbaglia

| Caso | Comportamento |
| --- | --- |
| Sceglie il palo sbagliato | dal banner "Ho sbagliato palo": scelta del palo, la richiesta vecchia passa a `withdrawn` |
| Dichiara l'unità sbagliata | la richiesta va al dirigente sbagliato, che con "Non è della mia unità" la passa agli admin (non è un rifiuto) |
| Abbandona a metà registrazione | il profilo incompleto non crea richiesta; al prossimo accesso riparte da "Completa il profilo" (come oggi) |
| Ha già un account membro e ne crea uno nuovo | il nuovo è `pending`; solo lo staff vede la nota "stesso nome e data di un membro attivo" e può rispondere "Ha già un account": all'utente arriva il testo unico di rifiuto più il link "Non ricordi con quale account sei entrato?" (aggiunto a ogni rifiuto, così non rivela niente) |
| Non sa nulla e aspetta | dopo 48 ore in coda, push agli admin del palo (riuso `adminPushDevices`) |
| Esce dal palo per sbaglio | "Esci dal palo" chiede conferma; dopo, "Chiedi di entrare" ripassa dalla coda (scelta deliberata: uscire è raro, rientrare deve essere verificato) |

### Contratto di autorizzazione (2026-10-20)

Scritto prima del codice applicativo di S2. Ogni cella ha un test
nell'emulatore con l'SDK client, utenti veri dell'emulatore Auth e le query
esatte dell'app di oggi (che per S2 è la "PWA vecchia"):
`functions/tests/stakeMembershipContractEmulator.test.mjs`. Le rules Firestore
lo applicano dal branch di S2; le celle Storage valgono dopo la fase B di
`gugd-storage-eu` (stesse persone, blocco Storage dello stesso test). Le rules
in `firestore.rules` sono la fonte: se una cella qui e una rule non dicono la
stessa cosa, è un bug di una delle due.

**Una regola sola.** Galleria, media, like, commenti, contenuti nascosti,
record aperti, sondaggi e interazioni del feed sono dei **membri del palo**:
chi ha `stakes/{s}/members/{uid}` con `status == 'active'`, oppure lo staff del
palo (admin e dirigenti di unità, ruolo nel profilo assegnato da un admin).
`users.stakeId` non dà più nessun permesso. Una sessione anonima non è mai
membro, qualunque documento abbia. Lo staff ha sempre anche il proprio
documento members attivo con `staffRole` (migrazione, trigger sul ruolo); il
ramo "staff dal profilo" esiste perché un documento mancante non tolga la
galleria a chi la modera, e i poteri dello staff (cancellare contenuti altrui,
leggere segnalazioni) restano quelli del ruolo. Perché ruolo e appartenenza
non divergano:

- ogni uscita da `active` di chi ha `staffRole` (esce dal palo, rimosso,
  bloccato, passato a un altro palo) lo riporta a `participant` e azzera
  `staffRole` nella stessa transazione; "Annulla" li ripristina da `previous`;
- l'ultimo admin del palo non può uscire, né essere rimosso o bloccato;
- un ruolo staff si assegna solo a chi ha un palo nel profilo e non ha il
  documento o è `pending` o `active` (le rules lo negano negli altri stati:
  prima si riattiva, poi si promuove); il trigger su `users` porta il documento ad `active` con
  `staffRole`; togliere il ruolo azzera `staffRole` e lascia l'appartenenza;
- rimuovere o bloccare toglie l'uid anche dagli elenchi dello staff delle
  attività del palo (`management/campStaff`, `management/recordNight`).

**Chi.**

| Sigla | Persona | Come si riconosce |
| --- | --- | --- |
| V | visitatore senza login | nessun `request.auth` |
| O | sessione anonima (ospite) | `sign_in_provider == 'anonymous'`, anche con un profilo o un members che puntano al palo |
| N | account senza documento members nel palo | profilo con `users.stakeId` uguale al palo, nessun `members/{uid}`: account nuovo, o creato dalla PWA vecchia prima che il trigger lo metta in coda |
| P | in attesa | `status == 'pending'` |
| M | membro attivo | `status == 'active'`, con o senza `reviewNeeded` |
| F | fuori | `declined`, `withdrawn`, `removed`, `blocked` |
| X | membro attivo di un altro palo | members attivo nel palo B, chiede sul palo A |
| D | dirigente di unità del palo | ruolo `unit_leader` e `users.stakeId` del palo (assegnati da un admin) |
| A | admin del palo, super admin | ruolo `admin` con `users.stakeId` del palo, o `super_admin` |

Lo staff "in elenco" di un'attività (`staffUids` del campeggio o della Notte
dei Record, scelto da un admin) vale solo per quella funzione e non dà
appartenenza.

**Firestore** (✓ permesso, ✗ negato; "propri" = documenti con il proprio uid).

| Dato e operazione dell'app | V | O | N | P | M | F | X | D | A |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `members/{sé}` get, anche se non esiste | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `members/{altro}` get | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | solo chi ha dichiarato la sua unità | ✓ |
| `members` list | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | solo `where('claimedUnitId','==',<sua unità>)` | ✓ |
| `members/{uid}/staff/*` (note dello staff) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | get, solo la sua unità dichiarata | ✓ |
| `members` scrittura da client | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `galleries` `where('activityId','==',a)`, get | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ |
| `media` onSnapshot, `orderBy('createdAt','desc')` + `limit`, getDocs | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ |
| `media` create in batch con `mediaCount` +1 (finestra aperta, `uploadedBy` = sé) | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ |
| `media` delete in batch con `mediaCount` −1 | ✗ | ✗ | ✗ | ✗ | propri | ✗ | ✗ | ✓ | ✓ |
| like di un media (get proprio, batch con `likeCount` ±1) | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ |
| commenti di un media: list, create | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ |
| commenti di un media: delete | ✗ | ✗ | ✗ | ✗ | propri | ✗ | ✗ | ✓ | ✓ |
| `hiddenMedia` `where('uploadedBy','==',sé)` / tutti | ✗ | ✗ | ✗ | ✗ | propri | ✗ | ✗ | ✓ | ✓ |
| `reports` (il client non li legge) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ |
| `records` `where('status','==','open')` | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ |
| `records` senza filtro (gestione; anche lo staff in elenco) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ |
| `recordEntries` `where('ownerUid','==',sé)` | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `surveyQuestions` `orderBy('order')` | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ |
| `surveyResponses` get per id, set della bozza e dell'invio | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ |
| `surveyResponses` list (risultati) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| `feedPosts` `where('published','==',true)` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| like di un post: get del proprio | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| like di un post: batch con `likeCount` ±1 | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ |
| commenti di un post (oggi nessun client) | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ |

Righe "incoerenti", provate apposta:

| Caso | Esito |
| --- | --- |
| `users.stakeId` del palo, nessun members (N) | negato su tutto ciò che è dei membri: è il cuore di S2 |
| `galleries/{g}/members/{uid}` o `users/{uid}/unlockedGalleries/{g}` presenti (codici galleria vecchi), nessun members attivo | negato: le rules non leggono mai quei documenti né `gallerySecrets` |
| sessione anonima con un members `active` o con un profilo staff | negato |
| D o A con il proprio members mancante o `removed` | permesso: decide il ruolo, e la callable che rimuove toglie anche il ruolo |
| members `active` nel palo A, `users.stakeId` già cambiato verso B | permesso in A finché l'appartenenza in A non passa a `withdrawn` |
| like mosso di 2, o senza il proprio documento like nello stesso batch; `mediaCount` mosso di 2 | negato |
| ruolo `admin` o `unit_leader` assegnato da client a chi è `declined`, `withdrawn`, `removed` o `blocked` | negato |
| query del dirigente su `members` senza il filtro della sua unità, con `in`, `!=`, `not-in`, `count()` senza filtro, `collectionGroup('members')` | negato |

**Storage** (dopo la fase B di `gugd-storage-eu`). Path
`protected/stakes/{s}/galleries/{g}/media/{m}/{file}`; stesse persone,
stessa regola. Membro = `members/{uid}` attivo; staff = `staffRole` su quel
documento, e solo se il documento manca o non è attivo il profilo (ramo staff).
Mai più di **due** documenti Firestore per richiesta: `members/{uid}` per
primo, poi il profilo (solo per chi non è membro attivo) oppure `media/{m}`
(solo per leggere un file altrui).

| Operazione | V O N P F X | M | D A |
| --- | --- | --- | --- |
| get del proprio file prima che esista il doc media (`metadata.uploadedBy` = sé) | ✗ | ✓ | ✓ |
| get di un file con il doc media | ✗ | ✓ | ✓ |
| list della cartella del media (nomi senza token) | ✗ | ✓ | ✓ |
| create di un file nuovo con `uploadedBy` = sé, immagine < 30 MB, video < 300 MB | ✗ | ✓ | ✓ |
| delete | ✗ | propri | ✓ |

Gli URL con token già distribuiti restano validi dopo una rimozione (vedi sopra
"URL già distribuiti"); i link dei media nascosti li rigenera la callable.

**Callable.**

| Callable | Contratto |
| --- | --- |
| `activityGallery` | `ensure` e `report`: membro, letto da `members/{uid}` e non più dal profilo; `restore` e `delete`: staff (ruolo). Stessa regola delle rules: se una cambia, cambia anche l'altra |
| `recordNightParticipant` | `context` resta com'è (solo le proprie iscrizioni). `propose` e `challenge`: iscrizione attiva all'attività **e** membro; `edit`, `withdraw`, `restore` dei propri tentativi: come oggi, così chi esce dal palo può ancora ritirarsi. Lo staff (ruolo o elenco dell'admin) non cambia |
| `stakeMembership` (nuova) | `request` solo per sé, non anonimo, palo esistente, tetti; ritiro e uscita solo per sé; approva, rifiuta e "Non è della mia unità": D per la sua unità dichiarata, A per tutte; rimuovi, blocca, sblocca, riattiva: solo A, mai su sé stesso né sull'ultimo admin; "Lo conosco" / "Non lo conosco": D per la sua unità, A; "Annulla" passa la `version` vista e fallisce se è cambiata. Ogni transizione segue i punti su ruolo e appartenenza qui sopra, nella stessa transazione, e ricalcola tutto dal documento (trigger doppi o fuori ordine non cambiano l'esito) |
| `unlockGalleryWithCode`, `setGallerySecretCode` | live in produzione, sorgente fuori dal repo (codici galleria tolti da Paolo, 2026-10-07); da cancellare nel rilascio di S2 (S2-1, approvata). Scrivono solo `galleries/{g}/members`, `users/{uid}/unlockedGalleries` e `gallerySecrets`, che nessuna rule legge per dare accesso: **nessuna delle due apre la galleria a chi non è membro**, oggi e dopo S2 (riga "codici galleria vecchi" sopra). Proposta di cancellarle: scelta S2-1 |

**Chi scrive members** (solo server, Admin SDK): lo script di migrazione; la
callable `stakeMembership`; un trigger su `users/{uid}` che (1) copia il ruolo
staff in `staffRole` e attiva chi riceve un ruolo staff da un admin, (2) crea
la richiesta `pending` quando un profilo completo sceglie un palo in cui non ha
un documento (copre anche chi si registra con la PWA vecchia, che non chiama
`request`), (3) al cambio di palo apre la richiesta nel palo nuovo senza
toccare quella vecchia. `tools/create-stake.mjs` crea anche il members attivo
del primo admin. Cancellazione account: members e note dello staff del uid in
ogni palo, nella stessa pulizia (oggi il repo non ha un flusso di
cancellazione: va costruito con S2).

**PWA vecchia** (bundle in cache, service worker v29): per M, D e A non cambia
nulla. Per N, P e F (i 41 "account esistente" e chi si registra dopo la
migrazione) le letture qui sotto passano da permesso a negato finché il client
nuovo non arriva:

| Dove | Cosa vede chi non è membro, con la PWA vecchia |
| --- | --- |
| home `/me`, `/unit`, `/admin`, famiglia | si aprono come prima: ogni lettura colpita ha il suo `catch`, nessun `Promise.all` cade |
| galleria dell'attività | "Qualcosa non ha caricato" con il messaggio inglese di Firebase e sotto "La galleria si apre all'inizio dell'attività" (motivo sbagliato) |
| card "foto" nelle home | resta senza miniature e invita a caricare le prime foto, ma il caricamento non parte |
| post del feed su una galleria | titolo "Galleria" e "non ci sono ancora media"; like senza effetto |
| commenti di una foto | "Nessun commento ancora"; l'invio mostra il messaggio inglese |
| Notte dei Record | "Non riesco a caricare i record. Controlla la connessione e riprova." (motivo sbagliato) |
| sondaggio | messaggio inglese e "Non ci sono ancora domande"; in `/me` la sezione sondaggi sparisce |
| `activityGallery` `ensure` | finché la callable legge il profilo, crea la galleria anche per loro (senza mostrargliela): la versione che legge members va pubblicata subito dopo le rules, nello stesso rilascio |

Quello che il telefono ha già scaricato resta visibile finché vive la cache
(la lettura "cache prima" non cancella i dati quando il server nega, e gli URL
con token restano validi): vale come per gli URL già distribuiti. Il client
nuovo decide "membro" dal proprio documento members di quel palo, non da
`users.stakeId` (oggi `useGalleryAccess`), e su un diniego svuota la cache di
quella galleria.

Nessuna pagina si rompe, ma i testi danno motivi falsi: il client nuovo
(banner "in attesa", "Si sbloccano dopo la verifica") deve uscire subito dopo
rules e callable, e i 41 "account esistente" non hanno iscrizioni, quindi
difficilmente aprono una galleria nel frattempo.

**Non cambia**: attività e unità pubbliche, iscriversi, le proprie iscrizioni
e quelle dei figli, consensi, stanze, `recordEntries` proprie, Notte dei Record
senza account, feed in lettura.

**Ordine di deploy**: migrazione in dry-run → migrazione reale (con il numero
visto nel dry-run) → rules Firestore e trigger su `users` nello stesso giro →
callable (`activityGallery`, `recordNightParticipant`, `stakeMembership`) →
client. Rules Storage con la fase B di `gugd-storage-eu` o dopo. Ogni passo con
conferma di Paolo. S2 è efficace solo quando rules Firestore, rules Storage e
le due callable leggono tutte `members`: finché una legge ancora il profilo,
quella strada resta aperta a chi ha solo scelto il palo.

### Callable e trigger: interfaccia (fase 2, 2026-10-20)

Scritta prima del codice, come il contratto: i test della fase 2 la provano
nell'emulatore Functions con utenti veri dell'Auth emulator e l'SDK client
(`functions/tests/stakeMembership*Emulator.test.mjs`, config
`firebase.membership-functions-test.json`).

**`stakeMembership`** (callable gen2, `europe-west1`). Richiesta
`{ action, stakeId, uid?, version? }`: `uid` è la persona su cui agisce lo
staff, assente nelle azioni per sé. Ogni azione è una transazione che rilegge
`members/{uid}` del palo, il profilo `users/{uid}` della persona e quello di
chi chiama, e ricalcola tutto da lì: due chiamate insieme o ripetute non
cambiano l'esito. Risposta `{ ok: true, action, status, version, changed }`;
`changed: false` quando lo stato era già quello (nessuna scrittura, `version`
invariata). Ogni scrittura incrementa `version`, mette in `previous` lo stato
di prima (`status`, `sources`, `staffRole`, `reviewNeeded`, `claimedUnitId`,
`claimedUnitName`, `declineCount`, `decidedAt`, `decidedBy`, più `role` se
l'azione ha cambiato `users.role`, `staffLists` se ha tolto l'uid dagli
elenchi dello staff, `moved` se ha portato a `withdrawn` l'appartenenza in un
altro palo) con `action` e `by`, e aggiunge una riga a
`members/{uid}/history/{id}` (`action`, `by`, `at`, `fromStatus`,
`toStatus`, `version`; solo server, nessuna rule la apre).

| action | Chi | Da → a | Effetti nella stessa transazione |
| --- | --- | --- | --- |
| `request` | sé, non anonimo, `stakeId == users.stakeId`, profilo completo | nessun documento, `withdrawn`, `declined` (7 giorni dopo il rifiuto e `declineCount < 3`) → `pending`; `pending` e `active` → nessun cambio | `requestedAt`, unità, nome, anno e `registrationHints` dal profilo; `reviewNeeded: false`; ogni `pending` dello stesso uid in un altro palo → `withdrawn` |
| `withdraw` | sé | `pending` → `withdrawn` | |
| `leave` | sé | `active` → `withdrawn` | uscita dello staff (sotto) |
| `approve` | D della unità dichiarata, A | `pending` → `active` | motivo `staff_approval` (`ref` = uid di chi approva), `reviewNeeded: false`; ogni `active` dello stesso uid in un altro palo → `withdrawn` con `movedToStakeId` |
| `decline` | D della unità dichiarata, A | `pending` → `declined` | `declineCount + 1` |
| `notMyUnit` | D della unità dichiarata | `pending` → `pending` con `claimedUnitId: ""` (la vedono gli admin) | `claimedUnitName` resta |
| `confirmKnown` ("Lo conosco") | D della unità dichiarata, A | `active` con `reviewNeeded` → `reviewNeeded: false` | |
| `markUnknown` ("Non lo conosco") | D della unità dichiarata, A | `active` con `reviewNeeded` → `pending`, `reviewNeeded: false` | |
| `remove` | A | `active` → `removed` | uscita dello staff, elenchi dello staff |
| `block` | A | ogni stato tranne `blocked` → `blocked` | uscita dello staff, elenchi dello staff |
| `unblock` | A | `blocked` → `pending` | |
| `reactivate` | A | `removed` → stato, motivi e ruolo di `previous` (senza `previous` attivo: `active` con `staffRole: null`) | il ruolo torna solo se `users.stakeId` è ancora questo palo |
| `undo` | A; D solo per le proprie azioni | ripristina `previous` se `version` è quella passata e l'ultima azione è dello staff | ruolo, elenchi e appartenenze spostate tornano come prima, ciascuno solo se nel frattempo non è cambiato; dopo, `previous: null` |

Uscita dello staff (`leave`, `remove`, `block`, e `decline`/`markUnknown` se
la persona ha un ruolo staff): `users.role` → `participant` e `staffRole:
null`; un `super_admin` tiene il ruolo (non è un ruolo del palo). L'ultimo
admin del palo (nessun altro profilo con `role: admin` e lo stesso `stakeId`)
non può fare `leave` né subire `remove` o `block`. Elenchi dello staff:
`remove` e `block` tolgono l'uid da `management/campStaff` e
`management/recordNight` di ogni attività del palo.

Mai su sé stesso le azioni dello staff; un dirigente non agisce su chi ha un
ruolo staff; un admin del palo non agisce su un `super_admin`.

| Caso | Errore | `details.reason` |
| --- | --- | --- |
| senza login | `unauthenticated` | |
| sessione anonima, ruolo che non basta, unità diversa, azione su sé stesso, dirigente su staff, admin su super admin | `permission-denied` | |
| palo inesistente; `members` della persona inesistente (azioni dello staff) | `not-found` | |
| `action`, `stakeId`, `uid` o `version` non validi | `invalid-argument` | |
| stato di partenza che non ammette l'azione | `failed-precondition` | `invalid_state` |
| `request` prima di 7 giorni dal rifiuto | `failed-precondition` | `cooldown` (con `retryAt` ISO) |
| `request` dopo 3 rifiuti | `failed-precondition` | `too_many_declines` |
| `request` su un palo diverso da `users.stakeId` / profilo incompleto | `failed-precondition` | `stake_not_chosen` / `profile_incomplete` |
| ultimo admin | `failed-precondition` | `last_admin` |
| `undo` con `version` cambiata / senza nulla da annullare | `failed-precondition` | `version_conflict` / `nothing_to_undo` |

"Profilo completo" è `needsProfileCompletion` del client
(`src/utils/profileCompletion.ts`): nome vero, unità, palo e, per chi non è
genitore, data di nascita e gruppo; per il genitore il comune.

**Trigger `onUserStakeMembership`** (`onDocumentWritten` su `users/{uid}`,
`europe-west1`). Non usa i dati dell'evento: rilegge in una transazione il
profilo attuale, l'utente Auth e i `members` del uid in ogni palo, così un
evento doppio o fuori ordine dà lo stesso risultato. Sessioni anonime e
profili cancellati: niente. Con `S = users.stakeId` (palo esistente):

1. ruolo `admin`, `unit_leader` o `super_admin`: `members` di S assente →
   `active` con `staffRole` e motivo `staff_approval` (`ref: "role"`);
   `pending` o `active` → `active` con `staffRole`, `reviewNeeded: false`;
   negli altri stati non scrive (le rules non assegnano il ruolo lì: un caso
   così nasce solo dalla console);
2. ruolo senza poteri: `staffRole: null` dove c'era, l'appartenenza resta;
3. profilo completo senza `members` in S → `pending` come `request`
   (non tocca mai un documento esistente, quindi non scavalca i tetti);
4. nei pali diversi da S: `staffRole: null` dove c'era, e `pending` →
   `withdrawn` (una richiesta aperta alla volta, quella del palo scelto);
   gli `active` degli altri pali restano finché quello nuovo non è approvato.

**`activityGallery`**: staff = profilo (`super_admin`, o `admin` /
`unit_leader` con `stakeId` del palo, mai anonimo); membro = `members/{uid}`
del palo `active`; altrimenti `permission-denied`. `ensure` e `report` a staff
e membri, `restore` e `delete` allo staff.

**`recordNightParticipant`**: `propose` e `challenge` vogliono, oltre
all'iscrizione attiva, che chi chiama sia staff (stesso ramo del profilo) o
membro attivo, altrimenti `permission-denied`; `context`, `edit`, `withdraw`,
`restore` come prima.

**Script S2-1** `functions/scripts/cleanupGalleryCodes.js`: dry-run di
default, stampa solo conteggi in una riga JSON (`codeGalleries`,
`gallerySecrets`, `galleryMembers`, `unlockedGalleries`, `deletes`). Con
`--apply` porta ogni galleria `accessMode: "code_required"` a `"open"` e
cancella `stakes/*/gallerySecrets/*`, `stakes/*/galleries/*/members/*` e
`users/*/unlockedGalleries/*`; fuori dall'emulatore vuole `--expect-galleries
<n> --expect-deletes <m>` uguali al dry-run, altrimenti esce con 2 senza
scrivere. Non tocca mai `stakes/*/members` (l'appartenenza di S2): per questo
scorre le gallerie, non `collectionGroup('members')`. Idempotente.

Decisioni tecniche della fase 2 (dentro la spec, da rivedere se Paolo le vede
diverse): `request` solo per il palo scelto nel profilo (cambiare palo è
salvare il profilo, poi ci pensa il trigger); `block` anche da `pending`,
`declined`, `withdrawn` (ferma chi ripete le richieste); il trigger non
riallinea unità e nome di una richiesta già aperta (il dirigente sbagliato usa
"Non è della mia unità").

## Parte C. Primo passo: accesso e registrazione (esce con S3)

Una sola schermata d'ingresso, raggiunta da "Accedi", da "Iscriviti" su
un'attività e da ogni pagina che chiede il login. Direzione grafica del mockup
della galleria: fondo pergamena, titolo Fraunces, card bianche radius 22,
bottone ambra per l'azione principale, pill. Mockup:
`.claude/mockups/pali/01-accesso.png` (fuori da git).

**Schermata 1 "Entra"**: titolo "Ciao! Hai già un account?", tre card grandi.

1. **Ho già un account** → Google in alto, poi email e password, "Password
   dimenticata".
2. **È la prima volta** → Google o email e password (minimo 8 caratteri, come
   il cambio forzato), poi:
   - "Chi sei?": *Sono un ragazzo o una ragazza* / *Sono un genitore* / *Sono un
     dirigente o un accompagnatore*. Sostituisce il `window.confirm` sull'età.
     "Dirigente" non dà permessi: crea un participant adulto in coda, e il ruolo
     lo assegna un admin (blocco 4).
   - "Di quale palo fai parte?": pill dei pali attivi; se ce n'è uno solo è
     già scelto e si vede come testo. Mai un default silenzioso.
   - nome, cognome, data di nascita (ragazzi), unità.
   - fine: "Richiesta inviata ai dirigenti di <unità>". Se c'è un'iscrizione
     da completare, si torna lì.
3. **Non ricordo con cosa sono entrato** → aiuto del blocco 1.

Sotto le card, una riga: "Ti ha iscritto un genitore o un dirigente? Crea il tuo
account e chiedi il codice per collegarti."

**Errori**: mappa completa dei codici Firebase in italiano
(`toUserFacingAuthError`): `invalid-credential` → "Email o password non
corrette."; `email-already-in-use` → "Esiste già un account con questa email."
con bottone "Accedi"; `popup-closed-by-user` → nessun errore; `too-many-requests`
→ "Troppi tentativi: riprova tra qualche minuto."; `network-request-failed` →
"Sei offline". Con la protezione dall'enumerazione attiva, il reset password
risponde sempre "Se l'indirizzo è registrato, ti arriva una mail per
reimpostare la password." (oggi dice "Ti abbiamo inviato il link", che è falso
per un indirizzo sconosciuto). Il signup rivela comunque se un'email esiste:
è un limite di Firebase, accettato.

### Stati e ritorni del primo passo

| Schermata | Indietro | Se chiude l'app |
| --- | --- | --- |
| Entra | torna alla pagina da cui è arrivato (`redirect`) | niente da salvare |
| Crea account, dopo Google | "Esci" (logout) e torna a Entra; l'account Firebase resta senza profilo e al prossimo accesso riprende da "Chi sei?" | riprende da "Chi sei?" |
| Chi sei / palo / dati | freccia al passo precedente, valori conservati | riprende dall'ultimo passo non completato (bozza in `sessionStorage`) |
| Fine | "Vai alle attività" o ritorno all'iscrizione | la richiesta è già inviata |

## Scelte per Paolo

| Id | Domanda | Opzioni | Consiglio |
| --- | --- | --- | --- |
| C1 | Firme già raccolte con "senza risposta" | a) nessun consenso + link per completare; b) rifirma; c) lasciare | **a** |
| C2 | "Decido dopo" | a) tolto, scelta modificabile dopo; b) tenuto ma conta come no | **a** |
| A1 | Attivazione automatica | a) solo collegamenti fatti dallo staff (codice sul posto, iscrizione a mano, invito confermato); il genitore precompila la richiesta ma non attiva; b) anche il collegamento del genitore attiva; c) anche ogni iscrizione libera | **a** (Codex: un genitore membro non certifica qualunque figlio inserito; c è la porta aperta oggi) |
| A2 | Chi approva | a) admin + dirigenti dell'unità dichiarata; b) solo admin | **a**: 21 dirigenti conoscono i ragazzi, 10 admin non tutti |
| A3 | Migrazione | a) attivi lo staff e chi ha un'iscrizione, ma "da confermare" dal proprio dirigente; 45 senza iscrizione in coda; b) attivi solo i 31 dello staff, tutti gli altri in coda (proposta di Codex); c) tutti attivi | **a**: nessuno perde la galleria dall'oggi al domani, e la verifica si fa comunque, distribuita sui dirigenti |
| A4 | Pagine pubbliche per chi è in attesa | a) attività e iscrizioni libere, il resto bloccato; b) anche le attività bloccate | **a** |
| S2-1 | Codici galleria (2026-10-20): `unlockGalleryWithCode` e `setGallerySecretCode` sono live senza sorgente nel repo; il client ha ancora il modulo del codice (irraggiungibile) e il pulsante del codice per le gallerie vecchie; in produzione restano una galleria con `accessMode: code_required`, il suo codice e 30 documenti di sblocco | a) cancellare le due functions, il codice client morto e il pulsante, portare quella galleria ad `open` e cancellare codice e documenti di sblocco, nel deploy di S2 dopo le rules; b) lasciare tutto (non apre niente, ma resta codice live che nessuno legge) | **a**, approvata il 2026-10-20 |
| S2-2 | Notte dei Record per chi è iscritto all'attività ma ancora in attesa di verifica | a) elenco, proposte e sfide solo da membro (come dice la parte B: un'iscrizione libera non prova niente; ritirarsi resta sempre possibile); b) l'iscrizione all'attività basta, cioè l'elenco dei record si apre a chiunque si iscriva | **a**, approvata il 2026-10-20 |
