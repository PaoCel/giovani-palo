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

| Gruppo (2026-10-15) | Quanti | Stato |
| --- | --- | --- |
| admin, unit_leader | 31 | `active`, `staffRole` |
| participant/parent con almeno un'iscrizione non annullata nel palo (propria o di un figlio) | ~104 | `active` con `reviewNeeded: true` |
| account senza iscrizioni | 45 | `pending`, etichetta "account esistente" |

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
