# Accesso al sondaggio

Richiesta di Paolo, 23 ottobre 2026: link leggibile, accesso ordinato e
possibilità di rispondere senza registrazione. Le risposte non contengono
nome o identificativo dell'account, anche quando si entra con un account.

## Percorso e ritorni

| Stato | Azione | Esito e ritorno |
| --- | --- | --- |
| Link breve, nessun account | Google o email | Accesso compatto, poi domande senza completare il profilo |
| Accesso con email aperto | Altri modi per accedere | Chiude i campi, conserva quanto digitato |
| Credenziali errate, popup annullato | Riprova o continua senza account | Resta nella scelta, nessun dato del sondaggio perso |
| Nessun account o account dimenticato | Continua senza account | Sessione tecnica Firebase anonima; nessun profilo, iscrizione o account da completare |
| Ospite già presente sul dispositivo | Continua senza account | Riusa la sessione, senza crearne un'altra |
| Account già connesso | Apertura link | Domande direttamente, per tutti i ruoli e senza vincolo di iscrizione all'attività |
| Domande | Torna all'attività | Conserva la bozza sul dispositivo |
| Invio fallito | Riprova | Domande e risposte conservate |
| Invio riuscito | Torna all'attività | Conferma esplicita, invio definitivo non sovrascrivibile |

Il link è `/sondaggio/tempio-ottobre-2026`; una mappa esplicita risolve palo e
attività. Il precedente link `/campeggio/:id?tab=sondaggio` continua a
funzionare e porta alla nuova pagina prima di chiedere accesso. Slug sconosciuti
mostrano un errore con ritorno alle attività. La pagina non è indicizzabile;
non è una nuova pagina pubblica da aggiungere alla sitemap.

## Dati e permessi

`surveyGuestEnabled` è un booleano facoltativo sull'attività, assente = falso.
Lo scrive solo l'admin del palo; il normale salvataggio attività con update
conserva il campo. Si abilita solo per il sondaggio richiesto da Paolo.

L'ospite autenticato anonimamente legge il documento dell'attività pubblica
e le sole domande attive con query `where('status', '==', 'active')`;
l'ordinamento per `order` avviene nel client. Nessun indice composito nuovo.
Può salvare e riprendere la propria risposta tramite l'identificativo casuale
conservato sul dispositivo e inviarla definitivamente. Non può elencare le
risposte o modificarne una già inviata. La risposta non contiene uid o nome;
per l'ospite la categoria è vuota.

L'eccezione ospite richiede attività pubblica, visibile, non in bozza e flag
attivo; non concede permessi su galleria, iscrizioni o record. I permessi degli
account esistenti restano compatibili. Il ramo S2 deve conservare questa
eccezione esplicita quando applicherà l'appartenenza al palo ai sondaggi.

Nessuna nuova collection o copia di dati personali: cleanup dell'attività
invariato. Deploy nell'ordine rules, attivazione del flag e hosting, poi
verifica della query con un token Firebase reale. Nessuna risposta di prova
in produzione; gli invii si collaudano negli emulatori.

L'attivazione del flag usa `functions/scripts/setSurveyGuestAccess.js` con
progetto, palo, attività e `--enable` o `--disable` espliciti. Senza `--apply`
esegue soltanto il controllo; per applicare serve un backup privato. Una
transazione verifica che l'attività non sia cambiata e la rilettura conferma
il valore. Il controllo delle domande pubblicate è una query semplice e non
richiede indici nuovi.

## Verifiche

1308 test del client e build di produzione sul Mac mini. Quindici prove
indipendenti delle rules con SDK client, token dei ruoli e query esatte:
ospite abilitato/disabilitato, evento non pubblico o inesistente, domande non
attive, payload, risposta definitiva e accessi collaterali negati. Review
indipendente completata senza blocchi.

25 controlli browser su emulatori: ingresso compatto a 320/390/430, email
errata, annullamento, recupero password, ospite senza profilo, riuso sessione,
bozza, invio e refresh senza risposte duplicate; account dei quattro ruoli
senza iscrizione all'attività; tre link legacy, slug ignoto e flag spento.
I campi sono disabilitati durante l'invio definitivo; il salvataggio attende
le bozze in corso e cancella quello pianificato, senza scrivere dopo l'invio.
Prima del deploy la produzione non aveva ricevuto modifiche al flag.
Il 23 ottobre 2026, dopo conferma esplicita, sono stati pubblicati rules e
hosting (SW v32), poi verificati gli asset e le rules live. Flag attivato solo
sul viaggio richiesto. Una sessione anonima reale ha aperto le otto domande;
nessun campo compilato e nessuna risposta di prova in produzione.
