# Kit demo: FSY Italia e sede europea

Stato: **piano, 2026-10-16**. Nessun codice. Prezzi e forma di un eventuale
accordo restano fuori da questo documento.

Destinatari: gli organizzatori di FSY Italia (evento nazionale del prossimo
anno) e la sede europea della Chiesa. La demo parla a chi ragiona su molti
pali, su dati di minori e su un ufficio che chiede garanzie.

Questo file sta in un repo pubblico. Il dettaglio delle verifiche di
conformità e continuità fatte il 2026-10-16 (regioni per servizio, backup,
conservazione, intestazione dei servizi) è nelle note private del progetto,
fuori dal repo; qui c'è il piano.

## In breve

- La demo mostra quattro percorsi (ragazzo, genitore, dirigente di unità,
  admin) su `demo.gugditalia.it`, con dati finti. Gran parte è già in
  produzione; la storia "molti pali, membri verificati" dipende dalla roadmap
  (S2-S4).
- Prima di presentare a un ufficio centrale vanno chiusi alcuni punti di
  conformità e continuità emersi dalla verifica di oggi, e l'appartenenza al
  palo verificata (S2): oggi chi si registra e sceglie il palo vede le foto
  dell'attività.
- FSY Europa ha già un sistema ufficiale di iscrizione
  (`registration.fsy-europe.org`). gugditalia si presenta per ciò che succede
  dopo l'iscrizione: stanze, staff e gruppi, programma, galleria, serate.

Legenda delle dipendenze usata sotto:

| Sigla | Significato |
| --- | --- |
| Oggi | in produzione su gugditalia.it |
| R1-R6 | voce di scope del [REDESIGN_BRIEF.md](REDESIGN_BRIEF.md) (1 dettaglio attività, 2 home ragazzo, 3 famiglia, 4 modulo iscrizione, 5 admin, 6 micro-interazioni) |
| S1-S5 | sessione della [ROADMAP_PALI.md](ROADMAP_PALI.md) approvata il 2026-10-16 |

## 1. Cosa deve mostrare la demo

### Ragazzo (`/me`)

| Passo | Cosa si vede | Stato | Dipende da |
| --- | --- | --- | --- |
| 1 | Catalogo e dettaglio attività dal telefono | Oggi | R1 (hero, chip, CTA fissa) |
| 2 | Iscrizione con Google o email, oppure senza account | Oggi | R4 (stepper); sullo staging "senza account" oggi dà errore, vedi §2 |
| 3 | Home con la prossima attività, la stanza quando lo staff pubblica il piano, la checklist zaino del campeggio | Oggi | R2 |
| 4 | Galleria dell'attività: carica foto e video, segnala | Oggi | UI già nella direzione nuova |
| 5 | Notte dei Record: propone un record, si iscrive, stampa il certificato | Oggi (pagina su misura) | S5b la trasforma in un momento del programma |
| 6 | Programma a momenti: cosa succede adesso, turni | Da fare (oggi il programma è un campo di testo) | S5a |
| 7 | Collegarsi sul posto con un codice dello staff, "Non ricordo l'account" | Da fare | S3 |

### Genitore (`/family` e link di firma)

| Passo | Cosa si vede | Stato | Dipende da |
| --- | --- | --- | --- |
| 1 | Mail con link personale, pagina di firma, PDF firmato in copia | Oggi, sulle attività che richiedono l'autorizzazione | fuori dal redesign (testi legali invariati) |
| 2 | Scelta obbligatoria su foto e social, link per cambiarla dopo | Su `main`, non in produzione | S1 (rilascio dopo il viaggio del 16-18/10) |
| 3 | Account famiglia con più figli, "Autorizza ora" dall'app | Oggi | R3 |
| 4 | Invito del genitore e collegamento del figlio | Da fare | S3 |

### Dirigente di unità (`/unit`)

| Passo | Cosa si vede | Stato | Dipende da |
| --- | --- | --- | --- |
| 1 | Iscritti della propria unità, autorizzazioni mancanti, note di trasporto | Oggi | non è nello scope del redesign: va aggiunto al brief |
| 2 | Consenso foto a colpo d'occhio nella lista | Su `main` | S1 |
| 3 | Coda "Richieste di accesso" della propria unità | Da fare | S2 |
| 4 | Codice di collegamento per un ragazzo sul posto | Da fare | S3 |

### Admin di palo (`/admin`)

| Passo | Cosa si vede | Stato | Dipende da |
| --- | --- | --- | --- |
| 1 | Crea l'attività e il modulo, decide se serve l'autorizzazione del genitore, apre le iscrizioni | Oggi | R5 |
| 2 | Iscritti con filtri, export, ZIP delle autorizzazioni firmate | Oggi | R5; pill dei consensi S1 |
| 3 | Piano stanze con compagni suggeriti dal server, pubblicazione ai ragazzi, modulo della foresteria | Oggi | nessuna |
| 4 | Staff del campeggio, pattuglie e comitati | Oggi (solo attività `camp`) | nessuna |
| 5 | Moderazione di galleria e Notte dei Record, push agli admin | Oggi | nessuna |
| 6 | Statistiche e sondaggi dopo l'attività | Oggi | R5 |
| 7 | Persone del palo: ruoli, unità, inviti ai dirigenti, iscrizioni a mano | Parziale: oggi dall'app si promuove solo ad admin; dirigenti di unità e iscrizioni a mano passano da console o script | S4 |
| 8 | Creare un palo nuovo dall'app (super admin) | Da fare (oggi `tools/create-stake.mjs`) | S4 |

### Tre livelli di demo

| Livello | Cosa racconta | Serve |
| --- | --- | --- |
| A, subito | un palo gestisce un'attività dall'iscrizione alle foto | seed arricchito e fix dello staging (§2), meglio con R1-R5 |
| B, ufficio centrale | consensi completi e foto visibili solo ai membri verificati | S1 in produzione, S2, punti del §4 |
| C, sede europea | un palo nuovo parte da solo, senza lo sviluppatore | S3 e S4 |

Per FSY conta soprattutto S5a (programma della settimana): vedi §5 e la
domanda M7 della roadmap.

Nota sul brief: il [REDESIGN_BRIEF.md](REDESIGN_BRIEF.md) parla di blu
`#235d90` e sabbia, ma la direzione approvata il 2026-10-15 è quella del
mockup della galleria (palette campeggio, card scura "In corso", bottone
ambra). Va riallineato prima della sessione di redesign, insieme a `/unit` e
`/campeggio` che il brief non copre.

## 2. Ambiente demo

Base: progetto `giovani-palo-staging`, dominio `demo.gugditalia.it` (risponde,
`robots.txt` con `Disallow: /`, verificato il 2026-10-16), seed
`tools/seed-demo.mjs` con il palo `palo-demo`, i quattro account di ruolo, due
attività (viaggio e campeggio) e 25 iscrizioni. Procedure in
[MULTI_PALO_DEMO.md](MULTI_PALO_DEMO.md).

Regole che non cambiano:

- **Solo dati finti.** Mai copiare, esportare o fotografare dati di
  produzione: sono dati di minori. Screenshot, slide e video si fanno solo su
  `demo.gugditalia.it`, con l'indirizzo visibile nell'inquadratura.
- Le immagini della galleria demo non mostrano volti di minori: paesaggi,
  oggetti, illustrazioni, con licenza libera o generate.
- Nomi sintetici, email `@example.invalid`, una sola casella vera
  (`DEMO_PARENT_EMAIL`) nell'allowlist dello staging.
- L'app dichiara già di non essere un sito ufficiale (`UnofficialDisclaimer`):
  resta visibile anche nella demo.

### Cosa manca per una demo guidata (la conduce Paolo)

| # | Cosa | Perché |
| --- | --- | --- |
| 1 | Seed riapplicato a ridosso della presentazione | le date sono relative a `--today` (ultimo seed 2026-10-07) e la firma di Matteo, se usata, va ripristinata con `--reset --apply` |
| 2 | Seed più ricco | oggi mancano galleria, piano stanze pubblicato, Notte dei Record, staff del campeggio con pattuglie, sondaggio con risposte, post nel feed: senza questi metà percorsi sono vuoti |
| 3 | Un'attività di taglia FSY (circa 550 ragazzi e 80 staff) | in produzione l'attività più grande ha 108 iscrizioni: elenchi, export e piano stanze non sono mai stati provati a quella scala |
| 4 | Reset senza chiave temporanea | oggi serve una chiave del service account creata e cancellata a mano; meglio un job pianificato sullo staging |
| 5 | Pulsanti che falliscono | con la registrazione chiusa "Crea un account" e "senza account" mostrano un errore: nasconderli o spiegarli sullo staging (decisione aperta) |
| 6 | Redesign sulle pagine dei percorsi | R1-R5; la prima impressione di un ufficio è grafica |

### Cosa manca in più per una demo pubblica da far provare

| # | Cosa | Perché |
| --- | --- | --- |
| 1 | Ingresso per ruolo senza password ("Entra come genitore") solo sullo staging | una password pubblicata si può cambiare e blocca la demo per tutti |
| 2 | Isolamento fra visitatori: un palo demo per visitatore o per revisore, cancellato dopo 24 ore | con un palo condiviso il revisore successivo trova le modifiche, e le immagini, del precedente. Minimo accettabile: galleria e feed in sola lettura |
| 3 | "Posta della demo" dentro l'app | l'allowlist ammette solo la casella di Paolo e le altre mail risultano "simulate" nei log: chi prova il percorso genitore deve vedere la mail e il link |
| 4 | Difese dall'abuso | App Check sulle callable della demo, tetto di sandbox per giorno, banner "Dati finti, si cancella ogni notte" |
| 5 | Registrazione che resta chiusa | se si riapre, le mail di verifica e reset di Firebase Auth partono verso indirizzi qualsiasi, fuori dall'allowlist |
| 6 | Token di firma per sandbox | il link di Matteo deriva da una regola nota (vedi [MULTI_PALO_DEMO.md](MULTI_PALO_DEMO.md)): accettabile con dati finti e un solo palo, non con molti visitatori |

Raccomandazione: per FSY e per la sede europea bastano la demo guidata, il
video e un accesso **su invito** (un palo per revisore creato con
`create-stake` e il seed reso parametrico sul palo). La sandbox pubblica vale
una sessione di lavoro in più e ha senso solo se il link deve girare oltre le
persone invitate.

## 3. Numeri d'uso reali

Letti il **2026-10-16** da produzione in sola lettura: query `runQuery` con
field mask e conteggi aggregati, conteggio account Auth senza dati utente,
nessuna scrittura e nessun dato personale stampato. Il viaggio al tempio è in
corso (16-18/10): **rileggere tutto la settimana prima della presentazione**.

| Dato | Valore | Nota |
| --- | --- | --- |
| Pali | 1 (Roma Est), 9 unità | multi-palo pronto nel codice e provato sullo staging, non ancora usato in produzione |
| Account con profilo | 180: 140 ragazzi, 21 dirigenti di unità, 10 admin, 9 genitori | la roadmap del 15/10 riporta 141 e 8 |
| Figli gestiti da un account famiglia | 16 | |
| Account di accesso (Firebase Auth) | 269 | comprende le sessioni anonime delle iscrizioni senza account (dedotto, non contato) |
| Attività gestite | 5 da marzo 2026 | escape room, due viaggi al tempio, un caminetto, un campeggio; prima iscrizione 25/03/2026 |
| Iscrizioni | 347 create, 326 non annullate | |
| Iscrizioni per canale (non annullate) | 224 con account, 71 senza account, 16 da un genitore, 15 inserite dallo staff | staff = 13 `manual_` e 2 con prefisso `admin_`, creati fuori dall'app |
| Autorizzazioni dei genitori firmate online | 116 (112 su iscrizioni non annullate) | tutte dal campeggio di luglio in poi; 26 in attesa di firma |
| Consenso foto nelle firme | 93 sì, 1 no, 22 senza risposta | i "senza risposta" li chiude S1 |
| Registro dei consensi | 742 eventi | |
| Foto e video condivisi | 284 in 3 gallerie | |
| Notte dei Record (prima edizione) | 21 record, 37 iscrizioni | |
| Risposte ai sondaggi | 24 | |

Per attività (iscrizioni non annullate / autorizzazioni firmate): escape room
21/0, viaggio di aprile 92/0, caminetto 25/0, campeggio di luglio 80/55,
viaggio di ottobre 108/61. La firma online è stata usata solo nelle due
attività che la richiedevano.

Frase per la slide, da confermare coi numeri riletti: *Da marzo un palo ha
gestito 5 attività e 326 iscrizioni, con 116 autorizzazioni dei genitori
firmate dal telefono.* Citare il palo e i suoi numeri richiede l'ok della
presidenza di palo (domanda aperta).

## 4. Pacchetto privacy e sicurezza

Quello che un ufficio centrale chiederà, con cosa c'è e cosa va preparato.
Lo stato puntuale di ogni voce, verificato il 2026-10-16, è nelle note private.

| Tema | Cosa c'è | Cosa serve |
| --- | --- | --- |
| Dove stanno i dati | Firestore `eur3` (Belgio e Paesi Bassi, verificato via API), Functions `europe-west1`, mail con Brevo (Francia), Hosting senza dati personali | un inventario per servizio (database, file, accesso, mail, push) nella DPIA, e informativa e [SECURITY.md](../SECURITY.md) allineati a quell'inventario: la verifica di oggi ha trovato un punto da correggere. L'informativa non cita ancora la galleria |
| Regole e test | rules default-deny con ruoli per palo e campi ammessi in elenco; dati sensibili solo da callable (compagni di stanza calcolati sul server, massimo 5 nomi); gate delle rules al commit; ruleset live confrontato con git prima dei deploy; 35 file di test, 14 contro l'emulatore con utenti veri e le query del client (circa 900 casi) | un documento leggibile da un ufficio: matrice ruolo × dato con l'esito dei test (è il primo passo di S2). Poi una revisione esterna |
| Dati sanitari | allergie e note mediche nel modulo, visibili allo staff dell'attività | base giuridica per categorie particolari (art. 9) e minimizzazione; per FSY non si importano |
| Consenso dei genitori | sotto i 18 anni firma sempre il genitore, sulle attività per cui l'admin lo richiede; link personale che scade e si invalida se cambia la mail; PDF firmato in copia; registro dei consensi; foto e social separati; firma dall'app per gli account famiglia | S1 in produzione (scelta obbligatoria, link per cambiarla, completamento delle firme senza risposta). Da dichiarare: l'identità del genitore coincide con il possesso della mail scritta nel modulo, spesso dal ragazzo. Da decidere: cosa succede alle foto già caricate quando un consenso viene revocato |
| Cancellazione e conservazione | richiesta a `privacy@gugditalia.it`, risposta entro 30 giorni | cancellazione dall'app con una procedura server che copra ogni collection e i file; job di conservazione coerenti con i tempi promessi dall'informativa |
| DPIA e ruoli | DPIA leggera di aprile 2026, fuori dal repo ([SECURITY.md](../SECURITY.md)) | aggiornarla con galleria, Notte dei Record con richieste anonime, link di gestione dei consensi, multi-palo. Con un incarico l'ente diventa titolare e Paolo responsabile (art. 28) con un contratto; DPA dei fornitori archiviati; registro dei trattamenti e degli incidenti |
| Accesso | email e password, Google, sessione anonima per le iscrizioni senza account | MFA per gli admin di palo. Account della Chiesa: nessuna integrazione; Identity Platform dovrebbe accettare un provider OIDC senza cambiare uid né rules (da verificare), ma serve che la Chiesa registri l'app nel suo sistema di accesso, cosa che si chiede solo dentro un incarico. Risolverebbe "con quale account sono iscritto" (S3) e, se la Chiesa espone unità e ruolo, l'appartenenza verificata (S2) |
| Foto dei minori | galleria visibile solo a chi ha un account nel palo, segnalazione che nasconde subito, finestra di caricamento limitata | appartenenza verificata con coda (S2); condizioni d'uso per i contenuti caricati dai ragazzi |
| Se lo sviluppatore smette | codice pubblico su GitHub con licenza MIT, documentazione in `docs/`, deploy mirati e test | un piano di subentro concordato col committente: secondo Owner, backup con retention, runbook (deploy, segreti, rinnovi), trasferimento di progetto e dominio a un'organizzazione del committente |
| Uso dell'AI | l'app non manda dati a servizi AI (scelta esplicita sulla Notte dei Record) | una pagina su come si sviluppa: agenti AI con revisione del codice, dati di produzione letti solo in aggregato. SECURITY.md cita una mappatura sui principi della Chiesa per l'uso dell'AI: va aggiornata |

Ordine consigliato prima di presentare: i punti di conformità delle note
private (lavoro di produzione, in una sessione dedicata e con conferma), S1 in
produzione, S2.

## 5. FSY: un complemento, non un doppione

Verificato su fonti pubbliche il 2026-10-16:

- FSY in Europa ha un suo sistema di iscrizione online,
  `registration.fsy-europe.org`. La pagina FSY italiana rimanda all'evento
  `italia2025` e indica due finestre: staff e consiglieri da novembre a
  febbraio, giovani da febbraio a giugno. La pagina dell'Area Europa Centrale
  usa lo stesso sistema per le sessioni 2026.
- Negli USA e in Canada l'iscrizione richiede l'account della Chiesa, i
  contatti dei genitori, i dati medici e l'approvazione del vescovato. Per
  l'Europa la pagina dei genitori non descrive moduli: i dettagli sono per
  sessione.
- Edizioni italiane: Assisi 2022 con circa 400 giovani; Grosseto 2025,
  sessione Italia e Albania con 550 giovani.

Quindi iscrizione, consensi e dati sanitari restano nel sistema ufficiale.
gugditalia si propone per il "dopo l'iscrizione":

| Bisogno della settimana | Cosa c'è già | Cosa serve per FSY |
| --- | --- | --- |
| Stanze | piano con vincoli (giovani uomini e giovani donne separati, età), compagni suggeriti dal server, pubblicazione al ragazzo, export | elenco importato, prova a 550, più edifici, assegnazione fatta dalla struttura come punto di partenza |
| Staff e gruppi | staff per attività scelto dall'admin, pattuglie e comitati, unità | gruppi con i loro consiglieri per qualsiasi attività: oggi le pattuglie esistono solo nel campeggio |
| Logistica sul posto | programma in testo, note di trasporto per unità, checklist zaino, push agli admin | programma a momenti con orari e turni (S5a) |
| Galleria | caricamento durante l'attività, segnalazione, visibilità ai membri | membri = partecipanti della sessione (S2); consenso foto preso dal sistema ufficiale |
| Serate | Notte dei Record con moderazione e certificato | altri tipi di serata (S5b) |
| Dopo | sondaggio, galleria aperta 7 giorni | nessuna |

Come presentarlo:

- Una frase: *L'iscrizione resta dov'è; gugditalia comincia quando l'elenco
  degli iscritti è chiuso.*
- Nessun dato passa prima di un incarico: l'elenco degli iscritti appartiene
  al titolare (la Chiesa) e si può esportare verso gugditalia solo con un
  contratto art. 28 approvato dall'ufficio privacy competente.
- Con l'incarico, dati minimi: si importa da file l'elenco esportato dal
  sistema ufficiale (nome, palo e rione, fascia d'età, giovane uomo o giovane
  donna per le stanze, ruolo di staff). Niente dati sanitari né moduli copiati;
  del consenso foto basta un sì o no, se il sistema ufficiale lo esporta. Meno
  dati vuol dire una DPIA più corta.
- Un evento nazionale nel modello di oggi: un "palo" contenitore (per esempio
  `fsy-italia-2027`) con i gruppi come unità. Stanze, staff e galleria
  funzionano senza codice nuovo; servono l'import e i gruppi generici.
- I ragazzi entrano con un codice dato sul posto (S3) o con l'account della
  Chiesa se concesso, senza creare account con email.
- Nella demo per FSY non si mostrano modulo di iscrizione, firma del genitore e
  dati sanitari: sarebbero il doppione. Si citano solo come prova che l'app
  regge un palo intero.

Domande che un organizzatore farà e che vanno preparate:

- **Telefoni**: molte sessioni FSY ne limitano l'uso. Se i ragazzi non li
  hanno in mano, il valore sta nello staff (stanze, gruppi, programma) e la
  parte ragazzo della demo si accorcia.
- **Supporto durante la settimana**: chi risponde se qualcosa si blocca il
  mercoledì sera, con uno sviluppatore solo.
- **Connettività** del luogo dell'evento: cosa funziona con rete scarsa.
- **Stanze**: a FSY i ragazzi di pali diversi si mescolano apposta e spesso
  le stanze le assegna la struttura; i compagni suggeriti vanno presentati come
  opzione, non come regola.
- **Nome FSY**: l'app è indipendente e non ufficiale; usare il nome FSY in una
  proposta va chiarito con gli organizzatori.

Cosa manca, solo per FSY: import da file (nuovo), gruppi generici (nuovo),
S5a, prova di carico a 550, lingua (una sessione congiunta con l'Albania;
l'app è solo in italiano). Per la sede europea si aggiungono le altre lingue,
l'autonomia multi-palo (S4) e il pacchetto del §4.

Calendario: se il 2027 segue il 2025, lo staff si iscrive da novembre 2026.
Per entrare nell'organizzazione di FSY la demo dovrebbe essere pronta fra
dicembre e gennaio. Le date vanno confermate (domande aperte).

## 6. Materiali

### Una pagina (A4, PDF)

Tre screenshot dal telefono presi dalla demo, token grafici del redesign. Testo
di partenza, da rivedere da Paolo che lo firma:

> **gugditalia.it, l'app delle attività giovanili del Palo di Roma Est**
>
> Un campeggio con cento ragazzi minorenni vuol dire raccogliere
> un'autorizzazione per ciascuno e tenere aggiornati gli elenchi fino alla
> partenza. Dal 2026 il nostro palo lo fa con un'app che ragazzi e genitori
> usano dal telefono.
>
> - **Ragazzo**: si iscrive dal telefono e, quando lo staff le pubblica, trova
>   lì la sua stanza e le foto dell'attività.
> - **Genitore**: firma l'autorizzazione dal link che riceve per email e ne
>   riceve la copia in PDF.
> - **Dirigente di unità**: vede chi della sua unità è iscritto e a chi manca
>   l'autorizzazione.
> - **Admin del palo**: crea l'attività, assegna le stanze ed esporta elenchi e
>   autorizzazioni firmate.
>
> **I numeri** (riquadro): 5 attività, 326 iscrizioni, 116 autorizzazioni
> firmate online, 180 account, 284 foto condivise.
>
> **Privacy**: il database e i server sono nell'Unione Europea e ogni accesso
> è controllato per ruolo da regole verificate con test automatici. L'app non
> usa analytics né pubblicità.
>
> **Per FSY**: l'iscrizione resta nel sistema ufficiale. gugditalia lavora
> sull'elenco già chiuso, con stanze, staff e gruppi e la galleria; il
> programma della settimana è in sviluppo.
>
> Progetto indipendente, non ufficiale. Paolo Celestini, volontario del Palo
> di Roma Est. Contatto: privacy@gugditalia.it

Il paragrafo "Privacy" si stampa solo dopo aver chiuso i punti di conformità
delle note private (§4).

### Video di 3 minuti

Registrato su `demo.gugditalia.it` con il seed appena riapplicato: telefono a
390 px per ragazzo e genitore, desktop per admin e dirigente. Voce di Paolo,
sottotitoli in italiano (in inglese per la sede europea). Niente dati veri,
niente volti.

| Tempo | Sullo schermo | Voce (traccia) |
| --- | --- | --- |
| 0:00-0:15 | home della demo sul telefono, titolo | "Questa è l'app con cui il nostro palo organizza le attività dei giovani." |
| 0:15-0:40 | admin crea il campeggio, chiede l'autorizzazione dei genitori, apre le iscrizioni | "L'admin crea l'attività in pochi minuti e decide cosa chiedere nel modulo." |
| 0:40-1:05 | ragazzo si iscrive dal telefono | "Il ragazzo si iscrive dal telefono. Se è minorenne, al genitore arriva la richiesta di autorizzazione." |
| 1:05-1:30 | genitore apre la mail, firma, sceglie il consenso foto, riceve il PDF | "Il genitore firma da un link e sceglie se le foto si possono usare." |
| 1:30-1:50 | dirigente di unità vede chi manca | "Il dirigente vede chi della sua unità non ha ancora l'autorizzazione." |
| 1:50-2:15 | piano stanze con i compagni suggeriti, pubblicazione; il ragazzo vede "La tua stanza" | "Le stanze si fanno qui, con i vincoli già applicati, e ognuno vede solo la sua." |
| 2:15-2:40 | galleria durante l'attività, segnalazione; Notte dei Record | "Durante l'attività i ragazzi caricano le foto, e una segnalazione le nasconde subito." |
| 2:40-2:55 | i numeri reali e le due righe di privacy | "Da marzo: 5 attività, 326 iscrizioni, 116 autorizzazioni firmate online." |
| 2:55-3:00 | contatto | "Se vi serve per FSY o per altri pali, parliamone." |

Dopo S2 la riga della galleria può dire che le foto le vedono solo i membri
verificati del palo; prima no. Versione per FSY: al posto del genitore
(1:05-1:30) l'import dell'elenco degli iscritti, quando esiste; più spazio a
stanze, gruppi e programma della settimana.

## Domande aperte per Paolo

1. **Date di FSY 2027** in Italia e finestre di iscrizione dello staff: decidono
   quando la demo deve essere pronta.
2. **Chi presenta**: tu da solo, con il presidente di palo, o con un dirigente
   che ha usato l'app?
3. **Canale tramite i dirigenti**: chi è il riferimento per FSY Italia e chi per
   la sede europea, e se serve una lettera della presidenza di palo.
4. Si possono citare **il nome e i numeri** del Palo di Roma Est?
5. **Punti di conformità** delle note private: si chiudono prima della demo, in
   una sessione dedicata?
6. Demo da far provare: **solo su invito** (consigliato) o sandbox pubblica?
7. Repo pubblico con licenza MIT: che cosa si offre a un committente
   (servizio, manutenzione, adattamenti) e se il repo resta pubblico.
8. Con un incarico, **chi sarebbe titolare** del trattamento.
9. **Lingue**: servono per la sede europea o per una sessione FSY congiunta?
10. **Telefoni a FSY**: i ragazzi li hanno durante la settimana? Cambia il peso
    del percorso ragazzo.
11. Roadmap M7: FSY 2027 è "la prossima attività con serate"? Se sì, S5 passa
    prima di S4.
12. Brief del redesign da riallineare alla direzione della galleria e da
    estendere a `/unit` e `/campeggio`?

## Fonti

- [FSY, pagina italiana](https://it.chiesadigesucristo.org/fsy) (finestre di
  iscrizione, link `registration.fsy-europe.org/italia2025`)
- [FSY, Area Europa Centrale](https://europecentral.churchofjesuschrist.org/fsy)
  (sessioni 2026 sullo stesso sistema di iscrizione)
- [FSY, checklist di iscrizione USA e Canada](https://churchofjesuschrist.org/youth/childrenandyouth/fsy/about/registration-checklist?lang=eng)
- [FSY, domande frequenti](https://www.churchofjesuschrist.org/events/fsy/FAQ)
- [FSY per i genitori, Italia](https://it.chiesadigesucristo.org/fsy-genitori?lang=ita-it)
- [FSY 2022 ad Assisi](https://it.chiesadigesucristo.org/fsy-%C3%A8-tornato-fra-noi)
- [FSY 2025 Italia e Albania a Grosseto](https://news-europe.churchofjesuschrist.org/article/during-the-2025-italian-albanian-fsy-conference-14-to-18-years-old-youth-prepared-1250-school-kits-to-donate)
