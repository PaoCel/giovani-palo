# Admin: iscrizione a mano e correzione dei dati

Task `gugd-admin-iscritti`. Scelte approvate da Paolo il 2026-10-20: tutte come consigliato (in fondo). Rivista da un secondo modello (PASS WITH CONCERNS, punti recepiti: link da invalidare, ordine e budget delle rules, push, campi, transizioni, rifiuto riaperto, `status` legacy).
Fatti letti dal codice il 2026-10-20. Mockup: `side-session-notes/local_0456cb35…/mockups/admin-iscritti/`
(`admin-iscritti.png`, sorgente `index.html`), fuori da git.

## Perché

Oggi un'iscrizione `manual_` si crea solo con uno script e credenziali owner:
13 sul viaggio al tempio, tutte senza data di nascita, 3 senza unità, 4 "in
attesa del genitore" senza email del genitore (nessuna mail è mai partita).
L'admin non può correggere nome, unità o data di nascita: solo stato ed email
del genitore. Le rules danno all'admin `create` e `update` senza nessun
controllo del payload (`firestore.rules:1498-1504`).

## Chi vede, chi scrive

| Dato | Scrive | Legge |
| --- | --- | --- |
| `manual_<id>` nuova | admin e super admin del palo | admin, dirigente della sua unità (`unitId`), staff del campeggio |
| nome, cognome, data di nascita, categoria, unità, email e telefono della persona | admin (nuovo); il titolare come oggi dal modulo, senza `unitId` | come sopra, più il titolare |
| richiesta di autorizzazione (`answers.parentAuthorizationRequest`) | admin (nuovo: solo nome, email e telefono del genitore); il titolare dal modulo | come sopra |
| firma, consensi foto e social, stato `confirmed`/`rejected_by_parent` | solo il server | invariato |

I dirigenti di unità non aggiungono e non correggono (`AUTONOMIA_MULTI_PALO.md:124`).

## Superfici

**A. Tab Iscritti.** "Aggiungi a mano" in cima all'elenco, prima dei due
tasti Excel, e nello stato vuoto ("Nessun iscritto"). Le righe `manual_`
hanno la pill "A mano".

**B. Foglio "Aggiungi a mano".** Nome, cognome, data di nascita, categoria
(GU, GD, Dirigente, Accompagnatore), unità (le attive del palo), email e
telefono della persona (facoltativi). Se la data dice minorenne e l'attività
chiede l'autorizzazione, compare il blocco "Genitore": nome, cognome, email,
telefono. Sotto i campi, l'esito del salvataggio, calcolato con le stesse
regole del salvataggio (lezione `parentStepNotice`):

| Persona | Attività | Stato | Mail |
| --- | --- | --- | --- |
| adulto | qualsiasi | Attiva | no |
| minorenne | senza autorizzazione | Attiva | no |
| minorenne | con autorizzazione, email del genitore | In attesa del genitore | sì, dal trigger esistente |
| minorenne | con autorizzazione, senza email | In attesa del genitore | no: in scheda "Chiedi l'autorizzazione" |

Il tasto dice cosa fa: "Aggiungi", oppure "Aggiungi e manda la mail".
Possibile doppione (stesso nome e cognome, o stesso nome e data di nascita,
fra le iscrizioni non annullate): avviso nel foglio con "Apri la sua
iscrizione" e "Aggiungi lo stesso".

**C. Scheda dell'iscrizione** (modale di oggi). In più: "Modifica dati"; la
riga "Aggiunta a mano da {admin}, il {data}"; se è in attesa senza email del
genitore, il riquadro "Manca l'email del genitore" con "Chiedi
l'autorizzazione". "Riattiva" segue la regola dello stato (vedi sotto).

**D. Foglio "Modifica dati".** Nome, cognome, data di nascita, categoria,
unità, email e telefono della persona. Non qui: email del genitore (tab
Consensi, "Modifica email genitore" + "Reinvia"), stato (Annulla/Riattiva),
consensi (solo il genitore). Se la correzione rende minorenne la persona in
un'attività con autorizzazione e manca la richiesta, compaiono i campi del
genitore come in B. Sopra i tasti, "Salvando", una riga per effetto,
calcolata da una funzione pura condivisa con il salvataggio; il tasto dice
"Salva e manda la mail" quando parte una mail.

**E. Foglio "Chiedi l'autorizzazione".** Nome, cognome, email e telefono del
genitore. Scrive la richiesta e lo stato "In attesa del genitore"; la mail la
manda il trigger. Serve anche alle 4 `manual_` di ottobre ferme senza email.

## Cosa succede se cambiano data di nascita, unità o nome

Minorenne = meno di 18 anni oggi, come badge, filtri e rules
(`isMinorBirthDate`). Le righe valgono per un'iscrizione non annullata; su
un'annullata cambiano solo i dati.

| Cambio | Stato | Consensi foto e social | Chi la vede | Avviso prima di salvare |
| --- | --- | --- | --- | --- |
| adulto → minorenne, attività con autorizzazione, nessuna firma | Attiva → In attesa del genitore; con l'email nella richiesta parte la mail | pill "da chiedere"; le spunte da adulto spariscono da scheda ed Excel | invariato | "Diventa minorenne: passa in attesa del genitore" + "parte la mail a …" oppure "manca l'email: la chiedi dopo" |
| adulto → minorenne, attività senza autorizzazione | invariato | pill "da chiedere" | invariato | "Foto e social: decide il genitore" |
| minorenne → adulto, in attesa, nessuna firma | In attesa → Attiva; il server invalida i link pendenti (vedi Functions) | pill sparite; per l'adulto le spunte restano vuote | invariato | "Diventa maggiorenne: torna attiva e il link mandato al genitore smette di valere" |
| data cambiata con autorizzazione già firmata o rifiutata | invariato | invariati (la firma vale a ogni età) | invariato | "Il modulo firmato resta con la data di prima" |
| unità | invariato | invariati | la vedono i dirigenti della nuova unità, non più quelli della vecchia; senza unità nessun dirigente | "La vedranno i dirigenti di {nuova}, non più quelli di {vecchia}" |
| nome o cognome | invariato | invariati | invariato | solo se firmata: "Il modulo firmato resta con il nome di prima" |
| categoria giovane ↔ adulto con una stanza assegnata | invariato | invariati | invariato | "È nella stanza {stanza}: ricontrolla il piano stanze" |
| qualsiasi, iscrizione legata a un account (`user_`, `child_`) | — | — | — | "Il profilo dell'account non cambia: la prossima iscrizione partirà da lì" |

Si scrivono sempre insieme: `firstName`, `lastName`, `fullName`;
`unitId`, `unitNameSnapshot`, `answers.unitName`; `birthDate`,
`answers.birthDate`; `genderRoleCategory`, `answers.genderRoleCategory`,
`answers.youthGroup`. Restano con i dati di prima, e lo si sa: il PDF
firmato, il nome nel link già mandato, i nomi copiati nelle pattuglie salvate
e nella Notte dei Record, gli abbinamenti delle preferenze stanza degli altri
(fino a "Normalizza richieste").

## Stati e ritorni

| Stato | Elenco | Scheda | Modifica dati | Dirigente di unità |
| --- | --- | --- | --- | --- |
| Attiva | riga normale | Modifica, Annulla, Elimina | come da tabella sopra | la vede se è della sua unità |
| In attesa del genitore, mail partita | pill di stato | Modifica, Annulla, Elimina; Reinvia in Consensi | se diventa adulto torna attiva | uguale |
| In attesa, senza email | pill "manca l'email" | + Chiedi l'autorizzazione | uguale | uguale |
| Confermata (firmata) | pill di stato | Modifica, Annulla, Elimina | la firma resta | uguale |
| Rifiutata dal genitore | pill di stato | Modifica, Annulla, Elimina | il rifiuto resta | uguale |
| Annullata | fra le annullate | Riattiva, Elimina, Modifica | solo dati | non la vede fra le attive |

Come si torna indietro:

- **Aggiungi a mano**: "Annulla", Esc o tocco sul fondo prima di salvare;
  con campi già scritti chiede "Esci senza salvare?". L'id `manual_` si fissa
  all'apertura del foglio: un "Aggiungi" ripetuto dopo un errore di rete non
  crea un doppione. Dopo il salvataggio si apre la scheda della nuova
  iscrizione con l'esito; l'errore si rimedia con "Elimina iscrizione" (la
  mail già partita resta partita: per questo il tasto lo dice prima).
- **Modifica dati**: "Annulla" riporta alla scheda con i dati di prima;
  salvato, si torna indietro rimodificando. Il cambio di stato e la mail
  sono gli unici effetti che non si annullano, e l'avviso li dice prima.
- **Chiedi l'autorizzazione**: "Annulla" chiude senza scrivere; dopo,
  l'email si corregge da "Modifica email genitore" e si rimanda con "Reinvia".
- **Riattiva** di un minorenne in un'attività con autorizzazione e senza
  firma: torna "In attesa del genitore", non "Attiva" (oggi scrive sempre
  `active`: è il buco chiuso il 2026-10-19 per il titolare, ancora aperto per
  l'admin). Con la richiesta presente il trigger rimanda link e mail; se il
  genitore aveva rifiutato, la mail nuova riapre il rifiuto: in quel caso, e
  solo quando parte una mail, "Riattiva" chiede conferma in un foglio
  ("Il genitore aveva rifiutato: riceverà una nuova mail per autorizzare").
  Il vecchio campo `status: "cancelled"` non va riallineato: il censimento in
  sola lettura del 2026-10-20 ne ha trovati 0 su 348 (3 con `status:
  "active"`).

## Functions (nuovo, dal secondo parere)

- **Uscita da "in attesa" senza firma ⇒ link invalidati.** Oggi la firma
  controlla solo che il link sia valido e l'iscrizione non annullata, e
  scrive `confirmed`: dopo una correzione minorenne → adulto il genitore
  firmerebbe un adulto, e dopo un ripensamento (di nuovo minorenne) il
  trigger vede il `tokenId` vecchio e non manda un link nuovo. Nel trigger
  delle autorizzazioni, il passaggio `before` in attesa → `after` non in
  attesa, senza firma, invalida i link pendenti di quell'iscrizione e azzera
  `tokenId` nella stessa transazione; il ritorno in attesa riparte come una
  reiscrizione (link e mail nuovi). Test nell'emulatore che conta link vivi e
  mail partite.
- **Dalla review del codice (Codex, 2026-10-20):** la firma rilegge il link
  nella transazione finale e si ferma se nel frattempo è stato invalidato;
  "Autorizza ora" emette un link solo per un'iscrizione in attesa (come
  mostra Famiglia); il reinvio dell'admin solo se l'autorizzazione serve
  ancora (in attesa, o meno di 18 anni in un'attività che la chiede); ogni
  ingresso in attesa da un altro stato riparte come una reiscrizione (link
  e mail nuovi), così un ritorno rapido in attesa non resta col link vecchio.
- **Dal secondo giro di review (2026-10-20):** firma e rifiuto si fermano
  anche se l'autorizzazione non serve più (non in attesa, e 18 anni o più o
  attività senza autorizzazione); la riattivazione diretta da annullata ad
  attiva invalida i link rimasti; la copia firmata e il link delle scelte
  partono dopo la transazione della firma (prima un rifiuto lasciava al
  genitore un "firmato" falso). Lato titolare: un'iscrizione attiva senza
  firma il cui modulo ora chiede il genitore (data corretta) passa in
  attesa, l'avviso del passo genitore lo dice e le rules ammettono il
  passaggio da attiva ad attesa.
- **Avviso "nuovo iscritto" agli admin.** Oggi scatta a ogni creazione con
  "{nome} si è iscritto a {attività}": per una `manual_` niente push (l'ha
  fatta un admin), o il testo "aggiunta a mano da {admin}" (scelta I8).

## Campi del documento `manual_`

`submittedByMode: "anonymous"` come le 13 di oggi (il valore è già nella lista
delle rules); `email`, `phone` stringhe, vuote se mancano; `unitId` e
`unitNameSnapshot` stringhe; `createdBy` (uid dell'admin) nuovo nel tipo
`Registration`, nella lista dei campi ammessi e fra gli invariati del
titolare; "A mano" in scheda ed Excel si ricava dal prefisso `manual_`. Il
controllo doppioni rilegge le iscrizioni dal server (non dalla cache) prima
di creare.

## Rules (blocco delle iscrizioni)

Oggi `isStakeAdmin` basta per creare e aggiornare qualunque campo, consensi
firmati e stato `confirmed` compresi. Proposta (scelta R):

- Ordine: prima i rami del titolare (annullamento, modulo, staff del
  campeggio), per ultimo l'admin con la sua lista; nella `create` il
  controllo `manual_` per primo. Va misurato il caso "admin che salva dal
  modulo la propria iscrizione o quella del figlio" (paga il ramo admin
  fallito più quello del titolare) e le due sonde sintetiche oggi a 972/974
  con `createdBy` aggiunto: se sfora, `createdBy` vale solo nel ramo admin.
- `create` admin: id `manual_*`, `createdBy == request.auth.uid`, titolare
  vuoto (`userId`, `anonymousUid`, `parentUid`, `childId` null), stato
  `active` o `pending_parent_authorization` con la regola del minorenne,
  consensi, firme e assegnazioni vuoti, campi della persona tipizzati.
- `update` admin: solo `registrationStatus`, `updatedAt`, `answers` (solo
  `parentAuthorizationRequest`, `birthDate`, `genderRoleCategory`,
  `youthGroup`, `unitName`), `parentAuthorization` (solo `parentEmail`,
  `emailLastError`, `updatedAt`), `roomPreferenceMatches`, nome e cognome,
  `birthDate`, `genderRoleCategory`, `unitId`, `unitNameSnapshot`, `email`,
  `phone`. Lo stato si
  controlla come transizione: invariato sempre ammesso (correggere i dati di
  una confermata o rifiutata); verso `confirmed` o `rejected_by_parent` mai;
  verso `active` per un minorenne in un'attività con autorizzazione solo se
  già firmata; e una data di nascita cambiata che fa risultare meno di 18
  anni non lascia attiva un'iscrizione senza firma (anche nel ramo del
  titolare). Alla creazione le risposte ammettono solo i dati della persona
  e la richiesta al genitore: un `parentConfirmed` scritto a mano varrebbe
  come consenso per il recupero delle approvazioni del vecchio metodo.
- `createdBy` entra nella lista dei campi ammessi e nel gruppo "invariati"
  del titolare, misurando il budget delle 1000 espressioni.
- Prima di stringere: le scritture admin delle build in giro sono
  `adminSetRegistrationStatus`, `adminUpdateParentAuthorizationEmail`,
  `normalizeRoomPreferenceMatches`, `adminDeleteRegistration` e il batch di
  pattuglie e comitati di `campManagementService` (oggi passa anche da
  `validCampAssignmentUpdate`): restano tutte dentro. Con la PWA già
  pubblicata, "Riattiva" di un minorenne senza firma riceve
  permission-denied e mostra "Impossibile riattivare l'iscrizione": è il
  comportamento voluto finché l'admin non aggiorna. Censimento in sola
  lettura delle iscrizioni in produzione (stati, `status` legacy, campi fuori
  lista); test nell'emulatore con le chiamate esatte del client.

## Fuori da questo task

"Mostra codice" e collegamento all'account (S3); note solo admin; correzione
del profilo dell'account (S4 "Persone"); iscrizione a mano da parte del
dirigente di unità.

## Scelte per Paolo

| Id | Domanda | Consiglio |
| --- | --- | --- |
| I1 | Data di nascita obbligatoria in "Aggiungi a mano"? | Sì: senza, un minorenne passa da adulto e il consenso si salta (0 su 13 oggi) |
| I2 | Unità obbligatoria? | Sì: senza, nessun dirigente di unità la vede (3 su 13 oggi) |
| I3 | Minorenne in attività con autorizzazione: in attesa del genitore e mail se c'è l'email? | Sì; senza email resta in attesa con "Chiedi l'autorizzazione" |
| I4 | Una correzione che rende minorenne un adulto (attività con autorizzazione, nessuna firma) lo mette in attesa e manda la mail? E al contrario torna attiva? | Sì in tutti e due i versi, con l'avviso prima di salvare |
| I5 | Il campo "Note" del piano autonomia | Fuori: sull'iscrizione lo leggerebbero famiglia e dirigente; note solo admin in S4 |
| I6 | La correzione aggiorna anche il profilo dell'account (`users`, figlio)? | No in questo task: lo dice l'avviso; il profilo si corregge con S4 |
| I7 | Dati sanitari (allergie, farmaci) nell'aggiunta di un minorenne? | No: l'admin di solito non li sa e il genitore non li scrive nella pagina di firma; restano vuoti come oggi per le `manual_` |
| I8 | Push "nuovo iscritto" agli admin per un'aggiunta a mano | Nessuna push: l'ha fatta un admin, e il testo "si è iscritto" sarebbe falso |
| R | Allowlist delle rules per l'admin come sopra, con "Riattiva" che segue la regola del minorenne | Sì |
| F | Il trigger invalida i link quando un'iscrizione esce da "in attesa" senza firma (serve un deploy delle functions) | Sì: senza, una correzione della data fa firmare un adulto o lascia un minorenne senza link |
