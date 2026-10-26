# Home dei giovani: dalle attività alle persone

Proposta del 26 ottobre 2026, primo blocco di `gugd-home-social`.
Base verificata: `main` a `3a59dad`. Nessuna modifica al client, alle rules
o ai dati. Prototipo separato in `docs/prototypes/home-social/`.
Rilascio subordinato a S2 e alla review del contratto effettivamente integrato.

## Esperienza proposta

Aprendo Home capisco dove ci ritroviamo, vedo cosa abbiamo vissuto e posso
contribuire alle foto dell'attività. La home racconta la vita del palo; il
dettaglio dell'attività contiene programma, iscrizione e strumenti pertinenti.
La gestione resta nelle superfici staff. Nessun editor organizzativo nel feed.

La rendono nostra il logo esistente senza cornice, Fraunces, la carta chiara
della galleria, una prossima attività blu con l'illustrazione dei giovani già
presente e una fotografia ampia. Niente icone decorative generiche, emoji,
storie finte, classifiche di popolarità o contatori di persone inventati.

Ordine mobile:

1. Palo e profilo, saluto breve. Nessuna campanella nuova.
2. Una sola prossima attività pertinente, con data, luogo e stato personale.
3. «Dalle attività»: filtro locale Tutto / Foto e video / Aggiornamenti.
4. Post galleria con anteprima, contesto dell'attività e ingresso alle foto;
   annunci e promemoria dello staff, ordinati per pubblicazione.
5. Navigazione esistente: Home, Calendario, Attività, Profilo.

Se c'è una galleria con caricamenti aperti, il riuso di
`ActivityMediaHighlight` compare fra la prossima attività e «Dalle attività»,
anche senza un post galleria pubblicato. Se riguarda la stessa attività già
in evidenza, le azioni foto entrano in quella card invece di duplicarla.
Se la prossima attività è diversa, la card «In corso / Appena concluso» è
compatta e conserva il suo titolo. Questa sorgente non dipende dal filtro P2
dei post. Famiglia mantiene tutti gli ingressi alle foto già presenti anche
se P3 rinvia l'ingresso al feed.

Desktop: navigazione a sinistra, stesso feed al centro (massimo 620 px),
prossima attività nella colonna destra. Niente doppione della stessa card.
Il feed mobile non diventa una griglia desktop: conserva ordine e lettura.

## Tre decisioni di prodotto da ratificare

| Decisione | Proposta per il primo rilascio | Motivo / alternativa rinviata |
| --- | --- | --- |
| P1 Autori e conversazioni | Post pubblicati dagli admin del palo; giovani contribuiscono alle gallerie e commentano le singole foto/video | È il modello già raggiungibile. Commenti ai post richiedono moderazione e segnalazioni proprie prima dell'attivazione |
| P2 Foto nel feed | Conservare il filtro attuale dei post galleria legati a un'attività: iscrizione personale non annullata, oltre al permesso S2 | L'appartenenza al palo è un requisito, non una decisione implicita di mostrare ogni album a tutti; l'accesso diretto alla galleria mantiene il contratto esistente |
| P3 Superfici | Prima `/me`; `/unit` riusa le card senza perdere gli strumenti del dirigente; ingresso al feed in Famiglia resta una consegna successiva esplicita | Il genitore non eredita l'iscrizione del figlio. Va definita la selezione del figlio e l'accesso ai suoi contenuti senza confondere identità |

Nessuna proposta di post liberi, DM, follower, nuove notifiche, reazioni
multiple o esposizione pubblica. Il «Mi piace» è l'unica reazione esistente.
Le scelte sopra sono proposte, non approvazioni di Paolo.

## Azioni quotidiane e scoperta

| Bisogno | Ingresso e destinazione | Cosa resta fuori dal feed |
| --- | --- | --- |
| Quando ci vediamo? | Card prossima attività → dettaglio; Calendario resta sempre raggiungibile | Elenco iscritti e dati personali |
| Devo iscrivermi? | «Iscriviti» per un'attività aperta e pertinente, senza iscrizione attiva → flusso esistente | Nessun «Partecipo» che scavalca firma o requisiti |
| Ho già un'iscrizione | «Dettagli attività» e stato reale: confermata, attesa genitore, annullata | Non chiamare «Iscritto» una firma ancora da completare |
| Cosa fare dentro l'attività? | Dettaglio attività → programma e Notte dei Record, quando già disponibili | Partecipazioni ai momenti generici sono future (`PROGRAMMA_A_MOMENTI.md`), nessuna CTA operativa nuova |
| Voglio condividere una foto | Post galleria / card In corso → «Aggiungi foto o video» se finestra aperta → selettore e coda esistenti | Nessun compositore di post libero; niente upload senza attività |
| Voglio rivedere le foto | Anteprima → visualizzatore della foto esatta, «Vedi tutte» → galleria | Nessun nuovo album globale o download di tutte le foto del palo |
| Voglio reagire | Mi piace del post resta del post; nel visualizzatore Mi piace riguarda quella foto | Nessuna somma fra like post e foto; nessun elenco pubblico dei like |
| Voglio commentare | Etichetta «Apri foto e commenti» apre una foto e i commenti esistenti | Nessun numero commenti sull'intero album, nessuna lettura preventiva dei thread |
| Una foto non va bene | Visualizzatore → Segnala → motivo → conferma; nascondimento gestito dal flusso esistente | Non promettere «annulla segnalazione» se il server non lo prevede |

Scoperta: i controlli sono etichettati, non affidati a icone; la CTA di upload
è nella card della galleria mentre è utile. L'assenza di una galleria nel feed
non cancella l'ingresso alle foto dal dettaglio attività. Niente badge «nuovo»
senza una fonte già esistente: il timestamp è `publishedAt` del post.

## Stati, superfici e ritorni

| Stato | Home | Dettaglio / foglio | Indietro, annulla, errore |
| --- | --- | --- | --- |
| Appartenenza da verificare | Banner S2, nessuna lettura feed/foto; attività pubbliche ancora raggiungibili | Percorso S2 esistente | Ritorno Home conserva il banner; non aggirarlo dalla galleria |
| Non membro / revoca / altro palo | Nessuna anteprima privata, like o nomi dalla cache | Chiusura visualizzatore e strumenti privati | Cambio account/palo elimina dati e bozze locali del vecchio contesto |
| Primo caricamento | Skeleton distinti per prossima attività e feed | Nessun «vuoto» anticipato | Focus stabile; nessuno spostamento al termine |
| Feed vuoto | Illustrazione giovani e «Qui arriveranno le novità delle attività» | Attività resta raggiungibile | Nessun invito a creare un post |
| Nessuna prossima attività | Invito compatto ad aprire Attività | Catalogo esistente | Feed continua normalmente, niente grande card vuota |
| Filtro senza risultati | «Nessun contenuto in questo filtro» + Tutto | Filtro locale, nessuna scrittura | Tutto ripristina lista; ritorno da foto conserva filtro e posizione |
| Errore di rete | Messaggio e Riprova sulla sezione fallita, altre sezioni restano | Bozze di commento conservate per account e foto | Errore permessi distinto da rete; non trasformarlo in elenco vuoto |
| Offline | Avviso, contenuti già autorizzati solo se contratto S2 lo consente | Nuove mutazioni dal feed disabilitate prima della scrittura | Nessun nuovo invio accodato dal feed; retry esplicito idempotente. Upload già confermati mantengono la ripartenza automatica della dock esistente |
| Iscrizione assente | Iscriviti solo se consentita; altrimenti Dettagli attività | Flusso iscrizione esistente | Annulla torna al punto d'ingresso senza creare iscrizione |
| Attesa genitore | Stato «In attesa del genitore», Dettagli attività | Il giovane apre il proprio dettaglio/iscrizione con lo stato e gli ingressi già previsti. «Autorizza ora» spetta solo al genitore nel suo contesto esistente; lo staff non firma per lui | Back ritorna al feed o al contesto genitore di provenienza. Non promettere link email ancora valido; nessun nuovo potere dalla card |
| Iscrizione annullata | Stato distinto, reiscrizione secondo flusso attuale | Nuovo ciclo di autorizzazione quando dovuto | Non ripristinare firma o appartenenza dal feed |
| Galleria aperta / chiusa | Aperta: Aggiungi foto o video; chiusa: Vedi tutte | Se la finestra chiude durante la selezione, errore comprensibile e nessun successo finto | Chiudere il selettore non crea media; upload già partiti nella dock, annulla dal flusso esistente |
| Visualizzatore aperto | Posizione congelata sotto | Foto scelta, commenti della sola foto, controlli autore/staff | Chiudi / Esc / indietro ripristinano filtro, scroll e focus sulla miniatura |
| Mi piace in corso | Disabilitare solo quel controllo, conferma dal server | Secondo tocco dopo conferma rimuove il proprio like | Errore riporta esattamente like e contatore precedenti; doppio tocco non duplica |
| Commento non inviato | Nessuna anteprima nel feed | Bozza distinta per foto e account; cambio foto non invia e tornando alla precedente il testo è recuperabile | Chiudi, Back ed Esc applicano la stessa protezione: «Continua a scrivere» resta, «Scarta bozza» chiude. Revoca/cambio account elimina le bozze del contesto precedente |
| Commento inviato / eliminazione | Nessun aggregato nuovo | Testo visibile dopo conferma; Elimina per autore/admin | Foglio «Tieni il commento» non cambia nulla; eliminazione confermata irreversibile dichiarata |
| Segnalazione | Nessun nascondimento prima della conferma | Motivo, Annulla, Segnala; avvisa che la foto sarà nascosta alla consultazione ordinaria e lo staff controllerà. Autore e staff conservano l'accesso al contenuto nascosto previsto da D4 | Annulla lascia tutto. Successo: chiudi visualizzatore e torna alla card aggiornata per il membro segnalante, senza esporre l'identità di chi segnala. Nessun falso undo, può ripristinare lo staff |
| Foto eliminata / nascosta nel frattempo | Anteprima rimossa alla rivalidazione | «Questa foto non è più disponibile», nessun commento residuo | Chiudi torna alla card; errore di lettura non mostra una foto vicina fingendo sia quella richiesta |

Il browser Back chiude prima i fogli aperti e poi torna al feed. Non aggiungere
una seconda copia della Home nella history; usare provenienza e posizione
nel router esistente. Con deep link senza provenienza il fallback è la Home
del ruolo. Gli URL canonici delle attività e dei record non cambiano.

Durante un invio commento il controllo resta bloccato sulla richiesta reale,
con id fissato per il retry. Chiudere non annulla una richiesta già partita:
il foglio spiega lo stato e conserva l'esito nel contesto della foto; un timeout
non crea un secondo invio. La conferma di scarto riguarda soltanto testo
non inviato. Nel prototipo l'invio è intenzionalmente spento: si verificano
chiusura, conservazione e scarto di una singola bozza, non la rete.

## Chi vede e chi scrive, prima di nuove query

Contratto richiesto per l'integrazione, **non risultato di un test rules**:

| Dato | Lettura | Scrittura |
| --- | --- | --- |
| Post pubblicato destinato ai membri | Membro attivo del medesimo palo secondo S2; pubblico del post rispettato lato server | Admin del palo per creazione, modifica, pubblicazione e ritiro |
| Bozza / admins_only | Admin del palo | Admin del palo |
| Galleria e media | Contratto S2 del medesimo palo; P2 è un filtro ulteriore della home, non la protezione server | Upload solo con finestra e permessi già previsti; autore/staff eliminano secondo il contratto galleria |
| Like post / media | Proprio stato e contatore visibile sul contenuto autorizzato; nessuna nuova lista di nomi | Il titolare del like, una volta per contenuto; aggiornamento aggregato atomico/autoritativo secondo contratto verificato |
| Commenti media | Solo chi può leggere quel media | Autore crea, autore/admin eliminano nella UI attuale; nessuna nuova facoltà dello staff implicita |
| Commenti post | Nessun nuovo ingresso UI | Inattivi in questa proposta; non basta che esista un match nelle rules |
| Partecipazione e stato firma | Solo titolare e staff già autorizzato | Flusso esistente, mai mutate dalla card feed |

Non si legge un elenco completo di persone per avatar, facce, «amici che
partecipano» o «piace a». Non si espongono nomi dai `createdBy` senza un
contratto: l'autore visivo dei post è «Staff del palo», senza qualifica di
verifica individuale. Cache e bozze hanno chiave uid+palo+contenuto e si
svuotano alla revoca secondo S2, anche durante un visualizzatore aperto.

### Inventario verificato su main e vincoli per l'integrazione

- `feedService.listPublishedPosts`: collection del palo, `published == true`,
  poi ordine locale pinned → `publishedAt ?? createdAt` discendente.
- `HomeFeed`: gallerie legate all'attività filtrate sulle iscrizioni personali
  non annullate. Media scelti dai `mediaIds` del post, con lista della galleria
  caricata dal service. Il prototipo non modifica questi criteri.
- `userActivitiesService.listForSession`: attività e lookup personale tramite
  service esistente. La prossima attività riusa questo risultato; niente
  query ai profili dei partecipanti.
- `galleryCommentsService.list`: sottocollezione della singola foto, ordine
  locale per `createdAt`; chiamata solo all'apertura del visualizzatore.
- `ActivityMediaHighlight`: finestra della galleria e ultime 3 anteprime
  esistenti. Riutilizzare questa fonte, non avviare un listener per ogni card.
- `firestore.indexes.json` letto: nessun indice composito feed in questa base.
  Nessun nuovo campo o query introdotto dal prototipo. Il filtro per tipo è
  locale. Nessuna promessa di paginazione infinita: prima misurare letture e
  media; limitare il rendering non equivale a limitare la query.
- All'integrazione con S2, trascrivere qui la query esatta autorizzata da S2
  prima del codice: il filtro `visibility` non va affidato al client. Non
  ipotizzare che la query della base passi nel contratto finale.
- Rimozione dei vecchi ingressi con codice e riconciliazione della visibilità
  sono competenza S2, non un secondo intervento sul suo branch.

Nessun campo «letto», «ultima visita» o contatore commenti; nessun nuovo
trigger, cron o notifica. Qualunque ampliamento richiede schema, rules,
indici, cleanup account e test prima dell'applicativo.

## Finitura e verifica prevista

- Testo di lettura 16 px, secondario almeno 13 px, bersagli almeno 44 px;
  contrasto AA. Radius 18–22 px; niente nuovi token globali nell'app.
- Token copiati esplicitamente nel prototipo da `base.css` e
  `activityGallery.css`: primary `#235d90`, primary-strong `#1b3f67`,
  heading `#101c30`, ink `#1e2a3b`, paper `#f4f5f1`, amber `#e8a857`.
- Un solo scroll pagina; barra inferiore con safe area e spazio di rispetto;
  foglio con scroll interno e sfondo bloccato. Campo commento 16 px.
- Niente salti automatici al refresh. Immagini con proporzioni riservate,
  riduzione movimento, focus visibile, descrizioni delle foto.
- QA 320/390/430 e desktop 1440; filtro, apertura/chiusura foto, like e
  ripensamento, segnalazione annullata, back, empty/loading/error/pending.
- Per l'implementazione: test indipendenti di query per ruolo/stato/palo,
  revoca/cambio account, doppio invio, errore in commenti, finestra chiusa,
  Safari con tastiera e confronto mockup/screenshot alla stessa scala.

## Perimetro della consegna

Prototipo senza Firebase, rete dati o persistenza: tutti i nomi, i testi di
post, le date, i conteggi e le immagini di attività sono sintetici. Il logo
e l'illustrazione sono asset di brand già nel repo. La fotografia è generata
per questa anteprima; la didascalia dichiara il dato sintetico.
Il prototipo dimostra composizione e ritorni locali, non prova autorizzazioni,
upload reali, invio commenti, iscrizioni o moderazione in produzione.

Non tocca editor attività, S2, service worker o bundle. I PNG di review sono
artefatti locali persistenti; sorgenti e verbale di verifica sono sul branch.
Il task completo resta aperto: qui si consegna soltanto il progetto della home.
