---
id: gugd-s2-appartenenza
title: "S2: appartenenza al palo verificata e coda Richieste"
status: needs-paolo
impact: 2
urgency: 2
effort: L
delivery: deploy
surface: [web, rules, functions, storage]
source: paolo
opened: 2026-10-20
started_at: 2026-10-20
touched: 2026-10-26
due:
blocked_by: ["decisione: conferma fresca per il rilascio coordinato B"]
branch:
worktree:
session: 01a17799-4984-7af2-857e-2a02f5b4db11
stopped_at: "S2 integrato con Storage UE, home e attività su main 41a215c; contratto completo finale verificato, migrazione non applicata"
next: "Dopo conferma B: ricontrollare dry-run180, migrare prima delle rules, pubblicare Functions/rules e rimuovere codici legacy secondo piano"
verified: "Finale 41a215c: 1924 S2 + 51 Home sulle rules, upload 300 MB, 115 query SDK, 31 diretti Storage/PDF, 44 puri, 57 HTTP consensi e 26 camp; build e 1524 client, browser 8 Home + 6 upload + 5 contesto. Review PASS. Dry-run prod: 180 profili (31 staff, 108 da verificare, 41 in coda), cleanup 31 e query dei 10 admin riusciti. Nessuna migrazione S2 o deploy B"
links: [docs/APPARTENENZA_AL_PALO.md, docs/ROADMAP_PALI.md]
done_at:
---

## Contesto

Oggi il palo lo sceglie l'utente (`users.stakeId`) e basta per vedere foto di
minori, record e sondaggi. S2 introduce `stakes/{s}/members/{uid}` scritto solo
dal server, con la coda "Richieste di accesso" per admin e dirigenti di unità.
È la base di tutta la gestione admin (S4) e di qualunque home "social": un feed
del palo su un'appartenenza autodichiarata mostrerebbe i ragazzi a chiunque
scelga il palo. Scelte A1-A3 approvate il 2026-10-16 (A3 come proposta da
Claude: attivi staff e iscritti, questi ultimi da confermare).

## Fatto quando

- rules Firestore e Storage leggono `members/{uid}` al posto di
  `users.stakeId` per galleria, media, like, commenti, segnalazioni, record,
  sondaggi; Storage legge un solo documento Firestore per richiesta;
- coda Richieste con approva, rifiuta, "Non è della mia unità", toast Annulla
  con `version`; stato "in attesa" per l'utente con le sue uscite;
- migrazione A3 eseguita con dry-run e poi reale, prima delle rules;
- cleanup di `members` nella cancellazione account;
- matrice provata nell'emulatore con l'SDK client, le query esatte e la PWA
  vecchia; collaudo nel browser per ogni stato.

## Da fare

Fase 1 (fatta il 2026-10-20): numeri A3 riletti, contratto ruolo × stato ×
dato nella spec, test dell'emulatore scritti da un altro agente, rules
Firestore di `members` e di ciò che è dei membri, logica e script della
migrazione con dry-run e `--expect-create`, `members` del primo admin in
`create-stake` e nel seed demo. Niente deployato.

Fase 2 (fatta il 2026-10-20): interfaccia di callable e trigger scritta nella
spec prima del codice («Callable e trigger: interfaccia»); test dell'emulatore
scritti da un altro agente (Fable) dalla spec; callable `stakeMembership`
(richiesta, ritiro, uscita, approva, rifiuta, "Non è della mia unità", "Lo
conosco"/"Non lo conosco", rimuovi, blocca, sblocca, riattiva, Annulla con
`version`) e trigger `onUserStakeMembership` in `europe-west1`;
`activityGallery` e `recordNightParticipant` da `members` (S2-2); S2-1 sul
branch (client senza codici galleria, script `cleanupGalleryCodes.js`).
Niente deployato.

Fase 3 (fatta il 2026-10-21, sessione nata dalla "top" nel worktree
`kind-rosalind-0307da`): `main` unito (`2a1fa42`, service worker v30) e
batteria verde; stati e ritorni del client e aggiunte server scritti nella spec
prima del codice («Aggiunte server della fase 3», «Client della fase 3»);
mockup mostrato a Paolo (cartella note del gruppo, `mockups/01-fase3.png`).
Server: nota "stesso nome e data" in `members/{uid}/staff/note`, azione
`hasAccount` (per il richiedente resta `decline`), promemoria
`stakeMembershipQueueReminder` (ogni giorno alle 18, solo se consegnato).
Client: "membro" da `members/{uid}` con un ascolto condiviso
(`useStakeMembership`), banner in `/me` e `/family`, superfici dei membri
chiuse senza letture negate (galleria, card in home, record, sondaggi,
commenti, like, campeggio, certificato), uscita dal palo nel profilo, pagina
Persone (`/admin/persone`, `/unit/persone`: Richieste, Da confermare,
Rifiutate) con toast "Annulla", numero nel menu e card in dashboard. Test di
Fable dalla spec; review Codex BLOCKED (7 punti), recepita; verifica Codex
sulle correzioni. Niente deployato.

Scelte di prodotto proposte a Paolo il 2026-10-21 (costruite con la proposta,
reversibili): 1) niente "Hai un codice?" e "chiedi un codice" finché i codici
non esistono (S3), al loro posto "parlane con un dirigente della tua unità";
2) contatto = `supportContact` del palo (risolta: il campo esiste); 3) "Non lo conosco" del dirigente su un migrato da confermare passa la
richiesta agli admin come "Non è della mia unità" (scelta S2-3, Paolo il
2026-10-22: `markUnknown` del dirigente svuota `claimedUnitId`, l'admin lo vede
con "Il dirigente non lo conosce", "Annulla" rimette l'unità); 4) illustrazione della porta di "Iscrizione inviata" nel
banner; 5) voce "Persone" nel menu di admin e dirigenti.

Prossime fasi:

- decisione del 2026-10-22 già implementata in `0fa5d59`/`bf0963a`/`475ac0a`:
  lo stato di prima è in `members/{uid}/staff/previous`, solo staff. Sul
  documento members resta `previous: null`; Annulla e Riattiva supportano il
  campo legacy. Recupero e verifica finale del 2026-10-26, senza riproporre
  la decisione;
- "Ho sbagliato palo" e "Hai un codice?" con S3; uscita dello staff, dopo tre
  rifiuti e oltre i 30 giorni con S4 (Persone);
- cleanup di `members` (con discendenti `history` e `staff`) implementato il
  26 ottobre: helper idempotente e script dry-run/apply con conteggio atteso;
  il trigger del profilo lo esegue solo con account Auth e profilo assenti.
  Le callable e la riconciliazione non ricreano appartenenze dopo la cancellazione.
  Cancellare solo Auth non attiva il trigger: procedura di assistenza documentata
  (Auth, profilo, verifica), senza introdurre un trigger preview;
- rules Storage dopo la fase B di `gugd-storage-eu` (celle già scritte, si
  sbloccano con `S2_STORAGE_CONTRACT=1`);
- rilascio, ogni passo con conferma fresca di Paolo. Letture di produzione
  fatte il 2026-10-26 (dry-run in sola lettura, dal mini con le credenziali applicative):
  dry-run della migrazione 180 profili, 31 staff, 108 da confermare, 41 in coda,
  180 da creare, 0 members esistenti, 348 iscrizioni lette; dry-run di
  `cleanupGalleryCodes.js` 1 galleria, 31 cancellazioni (1 secret, 15 membri
  galleria, 15 sblocchi). Query dell'ultimo admin e API/rilievo functions del
  2026-10-22 da ricontrollare al rilascio. Service worker live e `origin/main`
  a v32 il 2026-10-26: al rilascio scegliere una versione superiore a quella
  live e a quella di main, mai il vecchio v31. Ordine (un passo alla volta):
  0. il coordinamento integra il branch in `main`, risolve le differenze
     successive al branch e completa le verifiche sul risultato unito; da una
     copia pulita di quel commit ricontrolla dry-run, query ultimo admin,
     API Scheduler/Pub/Sub e presenza delle callable vecchie. Il recupero
     S2 non modifica il checkout principale e non esegue questo merge;
  1. `node scripts/migrateStakeMembers.js --stake roma-est --apply
     --expect-create 180` (dal mini, cartella functions, credenziali
     applicative, progetto giovani-palo);
  2. `firebase deploy --project giovani-palo --only firestore:rules`
     e `--only functions:onUserStakeMembership` nello stesso giro;
  3. `--only functions:stakeMembership,functions:activityGallery,functions:recordNightParticipant,functions:stakeMembershipQueueReminder`;
  4. `node scripts/cleanupGalleryCodes.js --apply --expect-galleries 1
     --expect-deletes 31`, poi `firebase functions:delete
     unlockGalleryWithCode setGallerySecretCode --region europe-west1`;
  5. bump monotonico del service worker, build, `firebase deploy --project
     giovani-palo --only hosting`;
  6. verifica: ruleset live uguale a git, functions in elenco, banner e coda
     con un account vero, conteggi `members` in sola lettura;
- dopo che la PWA vecchia è uscita dalle cache: togliere dalle rules i match
  di `galleries/{g}/members`, `users/{uid}/unlockedGalleries` e
  `gallerySecrets`.

Scelte S2-1 e S2-2 approvate da Paolo il 2026-10-20 ("sì, vai con la fase
2"): cancellare `unlockGalleryWithCode`, `setGallerySecretCode`, il codice
client morto, il pulsante del codice e i documenti di sblocco (la cancellazione
in produzione resta un passo del rilascio, con conferma fresca); Notte dei
Record solo da membro (`propose`/`challenge`), ritirarsi sempre.

## Verificato

Integrazione Storage del 26 ottobre: rules dalla membership e staffRole,
senza modifiche alla configurazione del bucket. Test di contratto già scritti
da altri e ampliati dal coordinamento ai due attori anonimi con profilo staff:
1902/1902, zero errori e zero salti (1724 Firestore, 178 Storage), compresi
upload reali da 300 MB nell'emulatore. Review indipendente di altro modello:
PASS WITH CONCERNS, nessuna modifica obbligatoria residua; budget due documenti
rispettato nel contratto e nelle prove.
QA dedicata sul mini via SSH LAN con EXIT verificato in banda, perché il wrapper
mini è bloccato nel mount della cache SSD; nessun lavoro pesante sull'Air.
Log conservati nella QA s2-storage del 26 ottobre, contract-anon-staff.log.

Il cleanup è lavoro tecnico ancora eseguibile autonomamente, non una decisione
di prodotto mancante: l'informativa prevede già assistenza via email. Percorso
minimo da implementare: cancellazione ricorsiva idempotente in tutti i pali,
anche con root members assente; trigger sulla cancellazione del profilo e
script operativo con dry-run e guardie account/profilo assenti; protezione
contro ricreazioni concorrenti. Il solo trigger del profilo non copre una
cancellazione esclusivamente Auth: documentare la procedura completa.
Conferma fresca necessaria per ogni applicazione reale e deploy, non per
scrivere helper, script e test. Storage UE resta coordinato nel piano di
rilascio, senza impedire preparazione e test delle rules.

2026-10-20, sul mini, branch a `aba2cd2`: test del contratto 1724 pass, 0 fail,
164 Storage saltati; migrazione 54 pura + 13 nell'emulatore (con `--apply`
vero); 26 file di emulatore esistenti a 0 fail; `registrationUpdateRules.py`
5/5; client 969/970 (il rosso è il test degli accenti senza git sul mini, in
locale passa). Controllo all'indietro: con le rules di `main` 360 celle
diventano rosse. Review: Codex BLOCKED (6 punti) e Fable PASS WITH CONCERNS (4
punti), tutti recepiti. Non provato: niente in produzione, nessun account vero.

Fase 2, 2026-10-20, sul mini in una copia isolata (`~/qa/giovani-palo-s2f2`):
batteria completa a `0367e29` (prima delle correzioni di review, che toccano
solo callable, trigger e script) con 33 file di emulatore a 0 fail (contratto 1724/0 con 164 Storage
saltati, migrazione 13/0, i 26 esistenti), `registrationUpdateRules.py` 5/5,
test puri delle functions 409/409, client 969/970 (accenti senza git sul mini;
in locale 55/55) e build verde. Test della fase scritti da Fable dalla spec:
callable, trigger, accesso a galleria e record, script S2-1 (vedi «verified»
per i numeri finali). Controllo all'indietro: il file di accesso contro
`activityGallery.js` e `recordNight.js` di `main` dà 5 test rossi su 13 (N, P,
F, X ammessi). Primo giro della batteria: 3 file rossi per seed senza members e
una gara di tempi in `familyAnyAdultRulesEmulator`, corretti. Review: Fable
PASS WITH CONCERNS (9 punti, recepiti 1-7 e 9; l'8 sono residui pianificati),
poi Codex sulle correzioni PASS WITH CONCERNS (3 punti, recepiti). Non
provato: niente in produzione, nessun account vero, rules Storage.

Recupero del 2026-10-26, sulla base `475ac0a` e sul diff preesistente:

- QA distinta sul mini in `~/qa/giovani-palo-s2-recupero-20261026`, porte
  Auth/Firestore/Functions 9649/8649/5649, Vite 5349; query e contratto senza
  Functions su 9669/8669 (websocket 9169). Solo progetto `demo-*` e dati
  sintetici per le prove; produzione usata soltanto dai due dry-run;
- risultati finali nel campo `verified`. Test dei permessi con SDK client:
  il titolare legge `previous: null` e riceve `permission-denied` su
  `staff/previous`; admin e dirigente autorizzato leggono; altri pali/unità
  e tutte le scritture client sono negati. Legacy, spostamenti e Annulla
  provati dal test callable recuperato;
- guardia browser scritta da un agente indipendente, salvata in
  `tests/browser/stakeMembershipDetails.mjs` con fixture in
  `tests/browser/fixtures/`. Con Vite in modalità emulatori/demo:
  `QA_DETAILS_BASE_URL=http://127.0.0.1:5349
  PLAYWRIGHT_MODULE=/percorso/playwright-core/index.mjs node
  tests/browser/stakeMembershipDetails.mjs`. Cinque scenari: stesso
  uid/versione in due pali senza rimontare, errore parziale e Riprova,
  documento assente, legacy, risposta tardiva;
- errori dei giri preliminari e correzioni: callable
  `expected: request, actual: stake_changed` nell'altro palo (entrambi i
  percorsi previsti, ora si verificano le coppie azione/autore esatte);
  query `invalid-argument: Unsupported field value: a custom Timestamp
  object` (il nuovo payload client del test usa `Date`, poi le rules
  restituiscono il diniego atteso); client `fatal: not a git repository`
  (copia QA iniziale senza git, accenti 55/55 nel worktree; creata nella sola
  QA un'index dei file tracciati presenti, client finale 1390/1390);
- la fixture browser ha prima segnalato il blocco del font Google come
  backend, poi `lettura B conclusa: 2 !== 1`: corretta la guardia font del
  test e corretto il render della coda precedente nel client, senza
  indebolire l'asserzione sulla singola lettura. Esito permanente 5/5;
- review indipendente: due P2 del client (cache senza palo, errori trattati
  come assenza), entrambi corretti e riverificati. Seconda review di
  `gpt-6-astra` sui commit e sul diff, più controllo del filtro al cambio
  palo: nessuna modifica obbligatoria residua. Il giudizio statico non
  sostituisce gli esiti runtime registrati sopra;
- Storage (164 celle), integrazione delle modifiche successive di main,
  cleanup account e account vero in produzione restano non verificati.
  Nessuna migrazione, cancellazione, merge su main o pubblicazione eseguita.

### Cleanup account, 26 ottobre

Implementazione e test scritti da agenti diversi. Sul Mac mini, 20/20 test
puri e 17/17 test con Auth/Firestore Emulator; regressioni reali Functions
136/136, zero salti. Hash dei cinque sorgenti e test uguali tra worktree e
copia QA. Review indipendente PASS, nessuna modifica richiesta. La prova
di delivery reale al trigger Functions è passata (1/1): evento CREATE,
Auth senza profilo cancellato invariato, poi DELETE e cleanup ricorsivo su
due pali; altri utenti e iscrizioni intatti. Segreti sintetici locali, nessun
accesso a Secret Manager nel giro finale. Nessuna cancellazione
o altra scrittura di produzione.

### Integrazione su main, 26 ottobre

Merge c5be64c conserva sondaggi ospiti e Albo dei record successivi al branch.
La revoca chiude le proposte aperte e invalida le richieste tardive; dopo la
revoca restano modifica della propria proposta pendente, ritiro e Annulla,
senza suggerimenti privati. Test scritti da un altro agente.

QA mini: client 1472/1472 e build finale verdi, Functions puri 429/429,
regressioni Functions 136/136. Rules e query integrate 2353 pass, due upload
grandi saltati in quel giro; contratto completo ripetuto con upload 300 MB:
1902/1902 e zero salti. Browser RecordNight 4/4, inclusi famiglia e risposte
tardive. Delivery trigger reale 1/1. Exit in banda tutti 0; review indipendente
PASS senza modifiche obbligatorie residue.

La nuova home chiude separatamente la vecchia lettura pubblica dei post:
contratto e test nel task gugd-home-social. Il rilascio di S2 resta da fare.

### Collaudo finale del pacchetto unito

Codice `main` 4831334, tree 303c32a88ae1710e5dd4e4df9e022daa9dda735b
identico alla copia QA del mini. Build PASS; 1510/1510 client, contratto
S2/Home 1975/1975 (Storage 300 MB incluso), query SDK 115/115, camp backend
e rules 26/26, browser Home 8/8 e camp 39/39. Zero errori e zero salti;
exit per suite e finale 0, log ricontrollati dal coordinamento. Processi QA
finali arrestati. Nessuna operazione di produzione.

Strumenti fase A Storage: 23/23 mock API/CLI e letture reali senza scritture;
prossimo passo con conferma nel task gugd-storage-eu. Artefatti locali
preservati in .claude/qa-rilascio-integrato/ e nelle cartelle di ogni blocco.

## Pacchetto coordinato pronto, 26 ottobre

Codice integrato su main 41a215c, tree 74c544a742af74411a07eb820a12f38319b3bf25.
Build e 1524 test client passano sullo snapshot esatto; test indipendenti finali e
review PASS completati. Piano di rilascio in docs/STORAGE_FASE_B.md.
Solo la preparazione fase A Storage è stata eseguita in produzione; questo
incremento aspetta la conferma B. I task più ampi restano aperti per gli
incrementi successivi, senza richiedere una nuova richiesta di ripartenza.
