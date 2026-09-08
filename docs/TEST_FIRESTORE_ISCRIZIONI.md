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

Per correggere un genitore registrato come partecipante, usare il profilo
figlio e l'ID canonico `child_<parentUid>_<childId>`. L'account personale del
figlio resta separato: l'iscrizione famiglia viene gestita dall'account genitore.
Conservare l'iscrizione errata annullata e i documenti firmati originali,
invalidare il vecchio token e richiedere un nuovo consenso per il partecipante
corretto. Applicare la correzione in modo atomico con precondizioni sulle
versioni lette; nessun nominativo, contatto o snapshot reale va nel repository.
