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

Per correggere un genitore registrato come partecipante, usare il profilo
figlio e l'ID canonico `child_<parentUid>_<childId>`. L'account personale del
figlio resta separato: l'iscrizione famiglia viene gestita dall'account genitore.
Conservare l'iscrizione errata annullata e i documenti firmati originali,
invalidare il vecchio token e richiedere un nuovo consenso per il partecipante
corretto. Applicare la correzione in modo atomico con precondizioni sulle
versioni lette; nessun nominativo, contatto o snapshot reale va nel repository.
