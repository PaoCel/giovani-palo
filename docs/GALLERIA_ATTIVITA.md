# Foto e video dell'attività

Stato: **D1-D7 confermate da Paolo il 2026-10-15** (tutte come consigliato).
Mockup approvato: `.claude/mockups/galleria-attivita/01-flusso.png` (fuori da
git); è anche la direzione grafica per il rinnovo dell'app.

I ragazzi caricano foto e video durante l'attività; finiscono nella galleria di
quell'attività, visibile agli altri. Si riusa tutto quello che c'è già per il
campeggio: `galleries/{id}/media`, `UploadManagerProvider` + `UploadDock`,
`CampGallery`, `MediaLightbox`. Niente transcodifica video (scelta già presa).

## Cosa esiste oggi (verificato in codice e in prod, sola lettura)

- Prod: 3 gallerie. Campeggio 142 media da 7 persone (video max 207 MB, galleria
  `published: false` ma usata lo stesso), viaggio al tempio di aprile 141 media da
  1 persona, Caminetto 1. Il viaggio del 16/10 non ha galleria.
- L'upload aperto a tutti è raggiungibile solo da `/campeggio/:id`. La pagina
  attività dei ragazzi mostra la tab Galleria solo sui campeggi;
  `/me/galleria/per-attivita/:id` è in sola lettura; la pagina pubblica dice ancora
  "Inserisci il codice ricevuto" (codici tolti).
- Consensi del viaggio del 16/10 (118 iscrizioni): foto `accepted` 46,
  `not_answered` 36, `refused` 1. La liberatoria A copre foto "da parte dei
  responsabili" per "album dell'attività, materiale per le famiglie partecipanti".

### Buchi nelle rules attuali (da chiudere in questo lavoro)

| Dove | Oggi | Rischio |
| --- | --- | --- |
| `galleries` get/list | `if true` | titoli e contatori leggibili senza login |
| `media` get/list, commenti | `isSignedIn()` | sessioni anonime (ospiti record/iscrizioni) e utenti di altri pali leggono foto di minori |
| `media` create | qualunque loggato, nessuna allowlist | anonimi e altri pali caricano; campi arbitrari |
| `galleries.update` | qualunque loggato su `mediaCount` | contatore riscrivibile a qualunque valore |
| `media.update` | qualunque loggato su `likeCount` | like falsificabili |
| Storage write | qualunque loggato, anche **sovrascrittura** di file altrui | si può sostituire la foto di un altro |
| Storage delete | solo admin | chi cancella la propria foto lascia il file: resta raggiungibile dal link |

## Chi vede, chi scrive (proposta)

"Membro del palo" = utente non anonimo con `users/{uid}.stakeId == stakeId`,
oppure admin del palo.

| Dato | Legge | Crea | Modifica | Cancella |
| --- | --- | --- | --- | --- |
| `galleries/{id}` | membri del palo | admin; membri solo con id deterministico `act_<activityId>` e payload fisso, durante la finestra | admin; membri solo `mediaCount` ±1 + `updatedAt` | admin |
| `media/{id}` | membri del palo; i nascosti solo admin (e l'autore) | membri, finestra aperta, `uploadedBy == auth.uid`, allowlist `hasOnly`, `likeCount == 0`, `hidden == false`, `activityId` uguale alla galleria | admin; membri solo `likeCount` ±1 coerente col proprio like; chiunque dei membri `hidden: true` + segnalazione | autore o admin (dirigenti di unità: scelta D5) |
| `media/{id}/reports/{uid}` | admin | membri, uno a testa, motivo da elenco | no | admin |
| `likes`, `comments` | come oggi ma solo membri del palo | | | |
| Storage `.../media/{mediaId}/**` | membri del palo | membri, solo file nuovi (`resource == null`), `customMetadata.uploadedBy == auth.uid`, immagini < 30 MB, video < tetto D6 | no (admin sì) | autore (dal metadata) o admin |

Invariante confermata: `uploadedBy` è sempre `auth.uid` di chi carica, mai
`gallery.createdBy` (rule + test).

Finestra di caricamento: da `startDate` dell'attività a `endDate` + 7 giorni,
salvo `uploadsClosed` messo da un admin. Calcolata nella rule dai campi
dell'attività, così vale anche per i client vecchi.

Compatibilità: i client già installati scrivono il payload di `createMediaDoc`
(stessi campi, nessuno nuovo) e il contatore con `increment(1)`: passano. Chi è
anonimo o di un altro palo smette di leggere: oggi la UI campeggio già li manda
via (`CampRoute`), quindi nessun percorso ospite rompe; `HomeFeed` legge solo da
loggati. Prima del deploy: cercare ogni lettura di `galleries` da sloggati.

## Ingressi (mockup)

1. Home di tutti i ruoli: card "In corso" con anteprima e "Aggiungi foto o video"
   finché la finestra è aperta (generalizza `CampHighlightCard`).
2. Pagina attività (ragazzo `/me/activities/:id`, pubblica `/activities/:id` per
   genitori e ospiti, dirigente `/unit/activities/:id`): card "Foto e video" sotto
   il titolo, accanto a quella della Notte dei Record. Da sloggati o anonimi:
   "Accedi per vedere foto e video".
3. Galleria `/activities/:eventId/foto` (`CampGallery` generalizzato, filtri Tutti
   / Foto / Video / I tuoi, bottone unico in basso). `/campeggio/:id` resta.
4. Visualizzatore: Mi piace, Scarica, Elimina (tuoi), Segnala (altrui).

## Flusso da utente che sbaglia

| Caso | Comportamento |
| --- | --- |
| Upload interrotto (rete) | upload resumable, riprova automatica al ritorno della rete (`online`), "Riprova" nella dock |
| App chiusa a metà | l'upload muore (limite web); avviso `beforeunload` già presente; file orfani senza doc invisibili, ripuliti da uno script |
| Foto troppo grande | compressa sul telefono prima dell'invio; sopra 25 MB messaggio chiaro |
| Video lungo | controllo sul telefono prima di partire: "Troppo pesante: massimo 300 MB, circa 3 minuti." |
| Foto per errore | filtro "I tuoi" + Elimina, che ora toglie anche il file |
| Connessione debole | 2 caricamenti alla volta (oggi tutti insieme), foto già compresse |
| Doppio tocco / stessa foto due volte | scarto i file uguali (nome, peso, data) già in coda |
| Galleria chiusa | bottone sostituito da "Caricamenti chiusi"; la rule nega comunque |
| Nessun palo nel profilo, anonimo | "Accedi per vedere foto e video" |

## Scelte (confermate il 2026-10-15)

- **D1 Visibilità**: membri del palo con account; anonimi e altri pali esclusi.
- **D2 Apertura**: galleria automatica su ogni attività, `galleries/act_<activityId>`,
  creata dalla callable al primo accesso a finestra aperta (o da un admin).
- **D3 Finestra**: inizio attività - 2 ore (ritrovo) → fine + 7 giorni, scritta
  sulla galleria come `uploadsOpenFrom`/`uploadsOpenUntil` (Timestamp). Un admin
  chiude (`uploadsClosed`) o riapre per 7 giorni (`uploadsWindowSource: "manual"`).
- **D4 Segnala**: la callable sposta il media in `hiddenMedia` (lo vedono staff e
  autore), scrive `reports/{mediaId}_{uid}` e il trigger
  `sendAdminPushForGalleryReport` avvisa gli admin. Tetto 10 segnalazioni a
  testa per galleria. Lo staff rimette o elimina (file compresi).
- **D5 Chi toglie**: autore, admin, dirigenti di unità del palo.
- **D6 Video**: 300 MB, controllati sul telefono e in `storage.rules`.
- **D7 Consenso**: avviso nella card + Segnala. Dati del viaggio del 16/10: un
  solo consenso foto rifiutato (stesso genitore che per un'altra iscrizione ha
  lasciato la foto senza risposta e rifiutato i social: scelta coerente, da
  confermare con la famiglia). **14 autorizzazioni firmate hanno il consenso foto
  "senza risposta"**: il modulo lascia firmare senza scegliere. Da chiudere a
  parte (scelta obbligatoria nel modulo).

## Implementazione

| Pezzo | File |
| --- | --- |
| Callable `activityGallery` (ensure, report, restore, delete) | `functions/lib/activityGallery.js` |
| Push agli admin sulla segnalazione | `functions/index.js` (`sendPushToAdminDevices` condiviso con le iscrizioni) |
| Rules | `firestore.rules` (`isStakeMember`, `validMemberMediaCreate`, `validLikeCountUpdate`, blocco `galleries`), `storage.rules` |
| Finestra lato client | `src/utils/galleryWindow.ts` (stesse costanti della callable) |
| Coda di caricamento | `src/app/providers/UploadManagerProvider.tsx`: bottone unico foto+video, 2 alla volta, scarto per file, doppioni ignorati, ripartenza a rete tornata, pulizia dei file se il doc non si salva |
| Galleria | `src/components/gallery/ActivityGallery.tsx`, pagina `/activities/:id/foto` |
| Ingressi | `ActivityMediaCard` (pagina attività di ragazzi, genitori, dirigenti), `ActivityMediaHighlight` (home di tutti i ruoli, ripiega sulla card campeggio) |
| Admin | tab Galleria dell'attività: stato caricamenti, Chiudi / Riapri per 7 giorni |

Difetti trovati e sistemati nello stesso giro: `deleteMediaPath` riceveva la
cartella del media e `deleteObject` la ignorava in silenzio (nessun file è mai
stato cancellato da annullamenti ed eliminazioni); emoji nella UI campeggio;
"si e iscritto" / "E arrivata" senza accento nelle push admin.

Sostituiti: `CampGallery` (ora `ActivityGallery`, anche dentro `/campeggio/:id`)
e la pagina in sola lettura `/me/galleria/per-attivita/:id` (redirect).
