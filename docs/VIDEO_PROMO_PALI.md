# Video promozionale per gli altri pali

Stato: **terza versione dei video, 12/11/2026**: dopo la seconda prova Paolo ha chiesto meno peso alle autorizzazioni e più alle iscrizioni sotto controllo, alle statistiche e ai sondaggi anonimi. Quattro file: 2:51 in 16:9 e teaser 43 s in 9:16, in italiano e in inglese (fuori dal repo, sul Mac di Paolo in `~/Movies/gugd-video-demo/`; le versioni precedenti in `versione-1/` e `versione-2/`).

Destinatari: presidenze di palo, dirigenti dei Giovani Uomini e delle Giovani
Donne, consulenti di altri pali italiani. Lo ricevono su WhatsApp o per mail,
quasi sempre dal telefono e spesso senza audio.

È un video diverso da quello di 3 minuti in [KIT_DEMO.md](KIT_DEMO.md), che è un
giro guidato per FSY e la sede europea. Qui l'obiettivo è uno solo: far venire
voglia di scrivere "lo vogliamo anche noi". Le riprese sono le stesse: si
registra una volta sola e si montano due video, in italiano e in inglese.

## Il messaggio

**Le attività dei giovani del palo, sotto controllo.** Chi è iscritto, da
quale unità arrivano, com'è andata. L'app è nata per questo (Paolo, 12/11);
le autorizzazioni dei genitori sono una funzione tra le altre e nel video
occupano un passaggio breve.

Tono: da dirigente a dirigente. Niente "rivoluziona", niente superlativi, niente
frasi personali di Paolo. Testi corti, un solo concetto per scena.

Limite da sapere: una classifica persona per persona di chi partecipa di più
non esiste. Le statistiche mostrano le iscrizioni per unità e per
organizzazione, e il video dice solo questo.

## Formati

| Versione | Durata | Formato | Per cosa |
| --- | --- | --- | --- |
| Principale | 2:51 | 16:9, 1080p | mail, presentazioni, consiglio di palo |
| Teaser | 43 s | 9:16 verticale | WhatsApp e stati, si apre a tutto schermo |

Il teaser usa solo le scene girate sul telefono. Ognuna delle due esiste in
italiano e in inglese: cambiano solo i testi, le riprese sono le stesse.

## Regole di montaggio

- **Solo testo, nessuna voce.** Ogni scena ha un titolo grande (il beneficio,
  non la funzione) e, se serve, una riga piccola sotto. I testi sono la
  scaletta qui sotto, parola per parola.
- Tempo di lettura: almeno 1 secondo ogni 3 parole, e il testo resta fermo
  finché non è finita la ripresa.
- Telefono dentro una cornice di iPhone su sfondo pieno; desktop in una finestra
  del browser pulita, senza schede né segnalibri. Zoom lento sul punto che
  conta, mai il cursore che vaga.
- Colori e font dei titoli: quelli del tema dell'anno dell'app, così il video e
  l'app sembrano la stessa cosa.
- **Musica: una traccia strumentale leggera e bassa** (decisa da Paolo
  l'11/11). Su WhatsApp il video parte muto e non cambia niente; in una
  presentazione o aperto dal computer, due minuti e mezzo di silenzio sembrano un video
  rotto. Va presa da una libreria con licenza d'uso libera (per esempio
  YouTube Audio Library), niente brani commerciali. Il video deve reggere anche
  senza.

## Video principale (2:51)

La firma di Matteo, «chi manca» e le stanze sono tutte del Viaggio al Tempio;
l'iscrizione di Sofia è al Campeggio d'inverno, le foto vengono dal campeggio
d'autunno concluso. In montaggio la scena del dirigente viene dopo la firma,
ma si registra prima (vedi Registrazione).

Ritmo (deciso il 12/11 dopo la prima versione, che a 1,6-1,8 volte non si capiva):
le riprese vanno a velocità reale con pause da persona fra un gesto e l'altro;
ogni scena tiene fermo il primo fotogramma per 1,2 secondi mentre compare il
titolo e l'ultimo per 1,6 secondi; le sole attese di rete (schermo fermo) sono
accorciate a 1,8 secondi; nell'iscrizione si salta la compilazione dei campi
del genitore.

Scene e ripresa (proposta di Grok del 12/11, verificata sul codice e sul seed):

| Scena | Titolo | Riga sotto | Cosa si vede (ripresa) |
| --- | --- | --- | --- |
| apertura | Sai chi è iscritto al prossimo campeggio? | | tavola blu |
| iscritti | Chi è iscritto, nome per nome | In alto i totali; ogni riga dice unità e stato della persona. | admin, Viaggio al Tempio → Iscritti: 16 attivi, ricerca «Pietro», scheda di Pietro Rossi in lista d'attesa (`registrations`) |
| statistiche | Da quale unità arrivano | Le iscrizioni del palo, per unità e per organizzazione. | admin, `/admin/stats`: 39 iscritti, barre per unità e per organizzazione (`stats`, primi 14 s) |
| sondaggio | Dopo, si chiede com'è andata | Sondaggi anonimi: si vede la categoria, non il nome. | admin, campeggio d'autunno → Sondaggi: 11 risposte, 4,36 su 5, una risposta aperta (`surveys`) |
| telefono | Si iscrivono dal telefono | Il modulo lo decide il palo: chiede solo quello che serve. | Sofia si iscrive al Campeggio d'inverno, senza la compilazione dei campi del genitore (`register`) |
| autorizzazioni | Le autorizzazioni arrivano firmate | Se serve, il genitore riceve un link e firma dal telefono. | genitore, dalla firma a «Tutto completato» (`parent`) |
| dirigente | Il dirigente vede la sua unità | Quanti iscritti, chi ha bisogno di un passaggio, cosa manca. | dirigente, `/unit`: i quattro riquadri e le prime righe (`unithome`, primi 11,5 s) |
| stanze | Ognuno vede la sua stanza | Le stanze si preparano nell'app, e ogni ragazzo vede solo la sua. | admin, piano stanze; Sofia, «La tua stanza» (`rooms`, `myroom`) |
| foto | Le foto restano nel palo | Dopo l'attività le foto sono nell'app, visibili solo ai membri del palo. | Sofia, galleria del campeggio d'autunno (`gallery`) |
| numeri | Palo di Roma Est, da marzo 2026 | 326 iscrizioni, 116 autorizzazioni firmate dal telefono | tavola chiara |
| FAQ | Domande frequenti | cinque righe (sotto) | tavola chiara, 18 s |
| chiusura | Se serve anche al vostro palo, scrivete a Paolo Celestini. | gugditalia.it | tavola blu |

Fuori dal montaggio ma già girate e negli script: elenco consensi e ZIP
(`consents`), dirigente fino a Matteo in attesa (`leader`), attività rapida
(`quick`), home admin coi tre numeri (`adminhome`). Nelle statistiche la card
«Città» resta tagliata sul bordo: nel seed la città non c'è.

**Domande frequenti** (idea di Paolo del 12/11, una sola tavola per 18 secondi;
ogni risposta verificata sui testi dell'app):

| Domanda | Risposta |
| --- | --- |
| Chi si può iscrivere? | Ragazzi, dirigenti e accompagnatori. I genitori iscrivono i figli dal loro account. |
| Serve un account? | Lo decide il palo per ogni attività: possono bastare nome ed email. |
| Bisogna installare qualcosa? | No: si apre dal browser del telefono. |
| Chi vede i dati? | Iscritti: admin e dirigente di unità. Sondaggi: senza nomi. Note sanitarie: admin. Foto: membri del palo. |
| È un'app ufficiale della Chiesa? | No: è uno strumento locale, nato in un palo. |

**Numeri** (1:55-2:03): citati con l'ok di Paolo dell'11/11. Riletti da
produzione l'11/11 in sola lettura, solo conteggi: 326 iscrizioni non annullate
(348 create) e 116 autorizzazioni dei genitori firmate online, uguali al 16
ottobre. Se passano settimane prima di mandare il video, si rileggono (stessa
procedura delle note del progetto). Il numero di attività non si cita: oggi ne
risultano 6 contro le 5 del kit, e la differenza non è verificata.

## Teaser verticale (43 secondi)

| Tempo | Titolo | Ripresa |
| --- | --- | --- |
| 0:00-0:04 | Sai chi è iscritto al prossimo campeggio? | titolo |
| 0:04-0:23 | Si iscrivono dal telefono | Sofia si iscrive al Campeggio d'inverno |
| 0:23-0:31 | Ognuno vede la sua stanza | Sofia: «La tua stanza» |
| 0:31-0:38 | Le foto restano nel palo | Sofia: galleria, una foto aperta |
| 0:38-0:43 | Se serve anche al vostro palo, scrivete a Paolo Celestini. | titolo finale con gugditalia.it |

Sta sotto i 60 secondi degli stati di WhatsApp.

## Versione in inglese

Si fa subito, perché senza voce costa solo un secondo giro di titoli. Limite da
sapere: **l'app oggi è solo in italiano** (la traduzione è il task `gugd-i18n`,
non ancora iniziato), quindi nelle riprese l'interfaccia resta in italiano. Per
la sede europea va bene così; quando l'app sarà tradotta si rigirano le
riprese con l'interfaccia in inglese.

Stessi tempi e stesse riprese della versione italiana; cambiano solo i testi.

| Scena | Title | Line below |
| --- | --- | --- |
| apertura | Do you know who's signed up for the next camp? | |
| iscritti | Every youth, by name | Totals at the top; each row shows the person's unit and status. |
| statistiche | Which unit they come from | Stake sign-ups, by unit and by organization. |
| sondaggio | Afterward, you ask how it went | Anonymous surveys: you see the group, not the name. |
| telefono | They sign up on their phones | The stake decides what the form asks: only what's needed. |
| autorizzazioni | Permission slips come back signed | When needed, the parent gets a link and signs on the phone. |
| dirigente | Leaders see their own unit | How many signed up, who needs a ride, what's missing. |
| stanze | Everyone sees their own room | Leaders assign rooms in the app. Each youth sees only their own. |
| foto | Photos stay in the stake | After the activity, photos stay in the app, visible only to stake members. |
| numeri | Rome Italy East Stake, since March 2026 | 326 sign-ups, 116 permission slips signed by phone |
| FAQ | Who can sign up? / Is an account required? / Anything to install? / Who sees the data? / Is it an official Church app? | Youth, leaders and adult helpers. Parents register their children from their own account. / The stake decides for each activity: a name and email can be enough. / No: it opens in the phone's browser. / Sign-ups: admins and the unit leader. Surveys: no names. Medical notes: admins. Photos: stake members. / No: it's a local tool, born in one stake. |
| chiusura | Could your stake use it too? Write to Paolo Celestini. | gugditalia.it |

Il teaser in inglese prende gli stessi titoli dalle righe corrispondenti. I
testi sono stati riletti da Grok l'11/11 sul lessico della Chiesa in inglese
(stake, youth, permission slip) e sul nome ufficiale del palo.

## Secondo parere

Codex non era disponibile (quota esaurita l'11/11); il parere è di Grok.
Accolto: l'apertura passava subito dal gancio al logo e a "vi mostro com'è
fatta", quindi la firma ora segue il gancio; «chi manca» è anticipato; il
calendario è ridotto a un lampo; via il PDF come scena a sé, il sondaggio e i
numeri animati; via le frasi da venditore («in dieci secondi», «pronto da
scaricare», «vuoi provarla», «ve lo attiviamo noi»); titolo sull'obiezione del
genitore che non installa nulla.

## Cosa non si promette

Ogni frase del video deve essere vera il giorno in cui si manda.

- **«Scrivete a Paolo Celestini»**, non «registra il tuo palo»: oggi un palo
  nuovo lo crea Paolo con `tools/create-stake.mjs`. La console dei pali e gli inviti dello
  staff sono in S4, non ancora fatta.
- **«Dati in Europa»** non si dice finché la migrazione di Storage non è chiusa
  (task `gugd-storage-eu`, fase E in attesa).
- **«Visibili solo ai membri del palo»** si può dire: l'appartenenza verificata
  (S2) è in produzione dal 3 novembre.
- Prezzi e gratuità restano fuori dal video, come nel kit.
- Niente iscrizione senza account: sulla demo è spenta, e la home pubblica dice
  ancora «Iscriviti, anche senza account». Quella scritta non si inquadra.

## Registrazione

Vale tutto quello che dice [KIT_DEMO.md](KIT_DEMO.md) nella parte del video di
3 minuti: solo su `demo.gugditalia.it`, seed con `--reset --apply` e `--today`
del giorno, link di firma di Matteo dall'output del seed, account dei quattro
ruoli, scena del dirigente **prima** della firma del genitore, niente casella di
posta né scheda admin di un ragazzo nell'inquadratura.

In più, per la versione promozionale:

- Telefono: registrazione schermo di un iPhone vero in Safari, non la vista
  mobile di Chrome. Batteria piena, modalità Non disturbare, ora fissa se si
  riesce.
- Desktop: finestra a 1440 px, zoom del browser al 110-125% perché il testo si
  legga sul telefono di chi guarda.
- Ogni scena si gira due volte, una lenta e una a ritmo normale: in montaggio
  si sceglie.

## Come sono fatti e come si rigirano

Li ha girati e montati Claude l'11/11 e rifatti due volte il 12/11 (scaletta e scene nuove scritte con Grok), senza toccare la demo vera: emulatori
Firebase sul Mac mini col seed demo (`--today 2026-11-11`), account di prova
degli emulatori, browser automatico. Gli script sono in `tools/video-demo/`:

| File | Cosa fa |
| --- | --- |
| `record.mjs <scena>` | registra una scena (leader, register, parent, rooms, myroom, gallery, quick, consents) con la cattura di Chrome: telefono 390×844 a densità 2, desktop 1280×800 a densità 1,5, cursore e tocchi disegnati |
| `build.py <scena> ready end` | trasforma i fotogrammi in un mp4 a 30 fps tra due segni |
| `makeplates.mjs` | genera sfondi, cornici e testi in italiano e inglese (Roboto e colori del tema dell'anno) |
| `compose.py it en` | monta i quattro video e ci mette la musica (`MUSIC=<file>`) |

Ordine: emulatori con `firebase.multistake-test.json`, seed con `--reset
--apply`, dev server con le variabili di `vite-demo-emulators`, poi le scene
con **leader prima di parent** (la firma di Matteo vale una volta; per rifarla
si riapplica il seed). Si lancia tutto da una cartella di lavoro fuori dal
repo, con `PLAYWRIGHT_MODULE` che punta a un `playwright-core` installato lì.

Ritmo: `record.mjs` allunga ogni pausa con `PACE` (1,7 di default) e
`build.py` accorcia gli schermi fermi (`MAXSTILL` 1,8 s, `LASTSTILL` 2,5 s).
Sul mini gli emulatori vanno lanciati con `TMPDIR` su DevServer
(`mini --env 'TMPDIR=$MINI_CACHE/tmp'`): il 12/11 il disco interno aveva 1,7 GB
liberi e lo Storage emulato si è chiuso a metà del seed, lasciando Firestore
appeso sulla porta 8180.

Musica: generata con ElevenLabs Music (strumentale) e salvata accanto ai video:
`musica-lunga.mp3` (172 s, usata dalla seconda versione); le tracce da 95 s
della prima versione restano come alternativa.
Quando l'app sarà tradotta (task `gugd-i18n`) si rigirano le scene con
l'interfaccia in inglese e si rimonta solo la versione inglese.

## Decisioni di Paolo (2026-11-11)

1. Nome e numeri del Palo di Roma Est: sì.
2. Contatto nel titolo finale: Paolo Celestini (il video lo manda lui, quindi
   basta il nome; nessuna mail o numero nel video né in questo file).
3. Nessuna frase personale in chiusura: suona come una vendita.
4. Solo testo, nessuna voce, con una musica strumentale bassa.
5. Sottotitoli in italiano; versione in inglese con gli stessi tempi.
