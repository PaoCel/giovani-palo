# Test delle modifiche alle iscrizioni

Il salvataggio completo di un'iscrizione gestita da un genitore superava il
limite Firestore di 1000 espressioni valutate e falliva con permission-denied
(riprodotto nell'emulatore il 2026-09-08). Le letture della famiglia riuscivano.

I campi obbligatori immutabili sono verificati insieme con
`MapDiff.unchangedKeys().hasAll(...)`. Per `parentUid` e `childId` resta la
compatibilità tra campo assente e `null`; l'autorizzazione deve invece rimanere
esattamente invariata, compresa la presenza del campo. Non cambiano ruoli,
ownership o query, quindi non servono nuovi indici.

Eseguire dalla radice del repository con JDK 21 e Firebase CLI:

```sh
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
firebase emulators:exec --only firestore --project demo-registration-rules \
  'python3 functions/tests/registrationUpdateRules.py'
```

Il test usa dati sintetici, accetta solo un progetto `demo-*` e un emulatore
locale. Verifica lettura e query famiglia, salvataggio completo del genitore,
salvataggio partecipante e legacy, annullamento, operazioni admin e rifiuto di
accessi estranei o modifiche a proprietà, assegnazioni e consensi.

Annullamento del genitore (fase 2 del flusso genitore, 2026-10-19): il client
manda solo `registrationStatus: cancelled` e `updatedAt`, e lo concede il ramo
`validOwnerCancellation`, valutato per primo perché `validRegistrationUpdate`
su un'iscrizione figlio superava il limite di 1000 espressioni. Il ramo
comincia dal confronto sullo stato, così gli altri update non pagano il diff.
Test con il client SDK e le chiamate esatte del client, compresi modifica e
reiscrizione di un figlio con `parentAuthorization` valorizzato:
`functions/tests/parentCancelRulesEmulator.test.mjs`; guardie delle callable
del link su iscrizioni annullate:
`functions/tests/parentAuthorizationCancelledEmulator.test.mjs` (comandi in
testa ai file).

Costo di `validRegistrationUpdate` (2026-10-19): il risalvataggio dal modulo e
la riattivazione di un'iscrizione figlio pesante (58 risposte, firma, stanza,
pattuglia, comitati) superavano il limite anche prima della fase 2. Ogni
accesso `request.resource.data.x` conta più espressioni (circa 8 contro 6 con
un `let` o un parametro, 10 con `.get()`), mentre una lista letterale conta un
elemento per voce: `diff().affectedKeys().hasAny([...])` su 18 chiavi ne costa
circa 25, i confronti campo per campo degli stessi campi circa 250. Ora i dati
passano da `let` e ogni gruppo di campi protetti ha la scorciatoia
`!changed.hasAny([...]) || <confronto dettagliato di prima>`: se nessuna chiave
del gruppo cambia il confronto è vero per costruzione, altrimenti si valuta
quello di sempre, quindi i permessi non cambiano. Il payload resta validato per
intero (saltare i campi invariati renderebbe modificabili documenti già
sporchi). Misure nell'emulatore, condizione intera di `allow update`:

| Scrittura del genitore | Prima | Dopo |
| --- | --- | --- |
| modulo, iscrizione in attesa | 951 | 649 |
| modulo, iscrizione firmata | 976 | 674 |
| modulo, iscrizione pesante | oltre 1000 | 707 |
| riattivazione, iscrizione pesante | oltre 1000 | 725 |
| riattivazione, ogni campo opzionale valorizzato | oltre 1000 | 780 |
| client vecchio: `assignedCommittees: []` su pesante legacy | oltre 1000 | 779 |
| codici, comitati e riattivazione insieme su pesante legacy | oltre 1000 | 913 |

I consensi manuali hanno una scorciatoia separata dagli altri campi protetti:
il client vecchio che aggiunge `assignedCommittees: []` alle iscrizioni legacy
pagava anche i loro 11 confronti (margine 97 invece di 214). L'ultima riga è
il caso sintetico di `parentCancelRulesEmulator.test.mjs` con due gruppi nel
confronto dettagliato nella stessa scrittura: nessun client la fa, è la sonda
del caso peggiore.

Misura: si carica una variante delle rules con
`PUT /emulator/v1/projects/<progetto>:securityRules` in cui la condizione è
`[0,0,…,0].size() >= 0 && (<condizione>)` e si cerca per bisezione la lista più
lunga che passa (ogni elemento vale un'espressione; con la sola condizione
`true` passano 993 elementi): 993 meno la lunghezza è il costo. Un campo nuovo
sull'iscrizione costa da 5 a 12 espressioni nel payload, più il suo confronto
se è protetto.

## Stato iniziale di un'iscrizione (2026-10-19)

Prima la creazione accettava qualunque stato: un client modificato poteva
creare un'iscrizione `confirmed` o `active` per un minore senza la firma del
genitore, e annullare e riattivare a `active` saltava il consenso. Ora:

- in creazione solo `pending_parent_authorization` o `active`; `confirmed` lo
  scrive solo la callable della firma;
- `active` no se l'attività ha `requiresParentAuthorization == true` e il
  partecipante è minorenne (`isMinorForParentAuthorization`: `birthDate`
  `YYYY-MM-DD` più 6573 giorni oltre `request.time`, un margine di uno o due
  giorni sul diciottesimo compleanno; data vuota o malformata vale
  maggiorenne, come in `src/utils/age.ts`);
- da `cancelled` si torna a `active` solo con `parentAuthorization.status ==
  'authorized'` o se l'autorizzazione non serve, come in
  `resolveRegistrationStatusOnSave`.

Prima di stringere, censimento in produzione in sola lettura: 348 iscrizioni,
nessuna `confirmed` senza firma, nessuna creazione dal client in stati diversi
da `active` e `pending_parent_authorization`; i 4 minori `active` senza firma
del viaggio al tempio (2026-10-10) li ha creati uno script operatore con
credenziali owner, che le rules non vedono. La data falsa resta un modo di
passare: è visibile all'admin, che vede comunque "autorizzazione mancante".

La creazione era già vicina al limite: 21 accessi `request.resource.data.x ==
null` per i campi che alla creazione devono restare vuoti. Ora passano da `let
next` e da un solo `next.diff({...}).changedKeys().size() == 0`
(`changedKeys()` guarda solo le chiavi presenti in entrambe le mappe: quelle
lette senza `in` le rende obbligatorie `validRegistrationPayload`). Costruire
la data limite dell'età come stringa costava circa 85 espressioni; con
`timestamp.date()` e i giorni circa 30, lettura dell'attività compresa.
Misure, documento massimo (55 risposte, codici e ogni campo ammesso
valorizzato; per l'update firma, consensi, stanza, turno, pattuglia,
comitati):

| Scrittura | Prima | Dopo |
| --- | --- | --- |
| crea figlio minore, in attesa | 950 | 806 |
| crea account adulto, attiva | 845 | 774 |
| crea ospite adulto, attiva | 906 | 829 |
| crea figlio, attiva, attività senza autorizzazione | 950 | 837 |
| riattiva figlio pesante firmato, attiva | 770 | 794 |
| riattiva adulto pesante senza firma, attiva | 723 | 796 |
| sintetico: codici, comitati e riattivazione, figlio firmato legacy | 948 | 972 |
| sintetico: codici, comitati e riattivazione, adulto senza firma legacy | 901 | 974 |

Le due righe sintetiche sono la sonda del caso peggiore (nessun client cambia
codici e comitati insieme alla riattivazione): un campo nuovo sull'iscrizione
va misurato lì prima di tutto. Test:
`functions/tests/registrationInitialStatusRulesEmulator.test.mjs`.

Per correggere un genitore registrato come partecipante, usare il profilo
figlio e l'ID canonico `child_<parentUid>_<childId>`. L'account personale del
figlio resta separato: l'iscrizione famiglia viene gestita dall'account genitore.
Conservare l'iscrizione errata annullata e i documenti firmati originali,
invalidare il vecchio token e richiedere un nuovo consenso per il partecipante
corretto. Applicare la correzione in modo atomico con precondizioni sulle
versioni lette; nessun nominativo, contatto o snapshot reale va nel repository.

## Ospite che collega un account (2026-10-19)

Un ospite (sessione anonima, iscrizione `guest_<uid>`) che poi collega Google o
un'email tiene lo stesso uid. Prima, al primo risalvataggio, il client copiava
il documento in `user_<uid>` (stato, `parentAuthorization`, firma, consensi,
stanza, pattuglia, comitati) e cancellava `guest_<uid>`: per un ospite in
attesa del genitore o già firmato `validRegistrationCreate` rifiuta quella
create, e l'id nuovo avrebbe staccato token del genitore, domande, stanze,
pattuglie e comitati che puntano a `guest_<uid>`. Ora `upsertRegistration`
aggiorna `guest_<uid>` sul posto con la stessa `updateDoc` del ramo "esiste
già" (le rules lo concedono: `anonymousUid == request.auth.uid` vale anche dopo
il collegamento), e le domande usano l'id dell'iscrizione mostrata invece di
ricostruire `user_<uid>` dalla sessione. Nessuna rule cambiata.

Censimento in produzione prima della correzione, in sola lettura: 71
iscrizioni `guest_`, tutte `active`, nessuna con autorizzazione, firma o
assegnazioni; 15 ospiti hanno poi collegato un account. Il campeggio aperto
ammetteva ospiti con autorizzazione del genitore: lì il caso poteva succedere.

Misure (documento ospite con 55 risposte; "pesante" = firmato con consensi,
stanza, turno, squadra, pattuglia e comitati):

| Scrittura dell'account collegato | Esito | Costo |
| --- | --- | --- |
| prima: create `user_` da ospite adulto attivo | passa | 747 |
| prima: create `user_` da ospite minore in attesa | negata | - |
| prima: create `user_` da ospite minore firmato pesante | negata | - |
| ora: update `guest_`, adulto attivo | passa | 632 |
| ora: update `guest_`, minore in attesa | passa | 637 |
| ora: update `guest_`, minore firmato pesante | passa | 725 |
| ora: riattivazione `guest_` firmato pesante | passa | 765 |

Restano negati in place: `pending` verso `confirmed`, la riattivazione ad
`active` di un minore non firmato e la scrittura di un altro account (questi
escono per il limite di 1000 espressioni, non per `false`: restano negati).
Test: `functions/tests/guestLinkedAccountRulesEmulator.test.mjs`.
