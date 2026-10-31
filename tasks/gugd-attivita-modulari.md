---
id: gugd-attivita-modulari
title: "Attività guidate: programma, gruppi, comitati e alloggi"
status: needs-paolo
impact: 2
urgency: 2
effort: L
delivery: deploy
surface: [web, functions, rules]
source: paolo
opened: 2026-10-26
started_at: 2026-10-26
touched: 2026-10-31
due:
blocked_by: ["decisione: conferma del rilascio di comitati e gruppi liberi (rules, due Functions, hosting)"]
branch: 
worktree: 
session: 905a5362-548d-40ee-8faa-06ff91e36473
stopped_at: "Comitati e gruppi liberi integrati su main il 2026-10-31, non in produzione: comitati creati ed eliminati su ogni tipo di attività, roster per i dirigenti, scrittura SDK del piano chiusa"
next: "Rilascio con conferma fresca di Paolo: rules, poi functions:campManagementSave e campManagementStaff, poi hosting; poi contratto della delega oppure finitura alloggi"
verified: "Quarto incremento su emulatori demo-gugd-comitati sul mini: puri 92/92, callable e rules 41/41, browser 56/56 in tre giri a 320/390/430, suite camp/room/unit/multipalo aggiornate e verdi, 15 mutanti presi, build verde, client 1514/1524 (accenti 55/55 sull'Air, 9 skip contratto). Review Codex in tre giri, ultimo PASS WITH CONCERNS senza P1/P2; censimento prod in sola lettura. Non provati: rilascio, Safari iOS, conflitto fra due admin nel browser"
links: [docs/ATTIVITA_MODULARI.md, docs/PROGRAMMA_A_MOMENTI.md, docs/PROGRAMMA_PRIMO_INCREMENTO.md, docs/AUTONOMIA_MULTI_PALO.md]
done_at:
---

## Contesto

Paolo, 26 ottobre: rendere configurabili dall'app le operazioni oggi affidate
all'operatore con accesso completo ai dati. Creazione essenziale, sottoattività
con iscrizioni, comitati con incarichi, gruppi dal nome configurabile e alloggi;
gestione anche da un responsabile esplicitamente delegato all'attività.

Priorità esplicita di Paolo del 26 ottobre: iniziare autonomamente e aprire
nuove chat per i filoni indipendenti. Registrato il superamento del limite
WIP globale; nessun altro task è stato parcheggiato automaticamente.

## Fatto quando

- Un admin di un secondo palo supera gli scenari di autonomia della spec
  senza console, script né interventi di Paolo.
- Bozza essenziale, opzioni su richiesta e pubblicazione esplicita; eventi,
  link, iscrizioni e firme esistenti conservati.
- Delega, rules, indici e test dei ruoli verificati per ogni nuovo modulo;
  collaudo mobile e review indipendente.
- Blocchi mergiati e deployati dopo conferma fresca, senza dichiarare fatto
  ciò che è solo implementato.

## Da fare

- Blocchi e dipendenze in docs/ATTIVITA_MODULARI.md; primo incremento:
  semplificazione della creazione, senza nuovi dati.
- Home social nel task esistente; Persone e provisioning in S2/S4.

## Verificato

Integrazione: corretti salvataggi concorrenti di attività/modulo e preservate
le personalizzazioni tra tipi non standard. Test correttivi permanenti in
tests/eventCreationConcurrency.test.mjs e tests/browser/eventCreationConcurrency.mjs.
Risultato finale sul mini: 1372 test, build e 70 controlli browser verdi,
review indipendente senza difetti obbligatori residui. Rilettura server prima
di modificare e dopo conflitto, nessun campo o collection nuovi. Il lavoro
complessivo resta aperto: programma modulare, gruppi/comitati/alloggi, delega
e rilascio non sono completati da questo incremento.

Primo incremento: 1343 test client verdi e build riuscita sul Mac mini.
76 verifiche browser/emulatore su secondo palo sintetico: 66 sul percorso
mobile, 2 atomicità, 2 locandina con servizio simulato, 3 rete/timeout/account
e 3 sui controlli fissi di anteprima.
Test di logica scritti separatamente dall'implementazione; review indipendente
del commit `68be40e` (PASS WITH CONCERNS: visibilità bozze e limite legacy già
documentati), con correzione dei rilievi. Mockup, screenshot prima/dopo e confronti
in `.claude/qa-creazione/` (ignorati). Nessuna nuova collection, campo, rule o indice.

Rimangono il controllo della visibilità delle bozze con S2 (le rules attuali
ammettono anche i dirigenti), il limite legacy-only del percorso precedente,
il deploy con conferma fresca. I moduli successivi della
roadmap restano aperti in questo stesso task; nessun secondo task duplicato.

### Secondo incremento: configurazione camp

I cinque comitati storici sono rinominabili, con incarico fino a 600 caratteri;
gruppi chiamabili Pattuglie, Gruppi, Compagnie, Team o Squadre. IDs, persone,
iscrizioni e consensi restano gli stessi. Vista personale, dirigente ed Excel
usano la denominazione e mostrano l’incarico pertinente. Non abilita ancora
comitati arbitrari o moduli dei viaggi.

Salvataggio con revisione server e transazione; proiezioni per lotti protette
contro revisioni superate e cancellazioni concorrenti. Client legacy senza
revisione e scritture dirette staff già ammesse mantengono la compatibilità.
Conflitto ricaricabile dal server, uscita/scarto protetti, richiesta pendente
riutilizzata; un errore dopo commit dichiara che il piano è già salvato e
invita a controllare e riallineare le assegnazioni. Nessun successo finto.

Review indipendente PASS e test separati dall’autore. Verifiche sopra e
verbale ATTIVITA_MODULARI.md; per pubblicare servono rules aggiornate e
`functions:campManagementSave` prima dell’hosting.

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

## Rilascio B pubblicato, 27 ottobre

Creazione e camp online. Programma essenziale in codex/gugd-momenti: authoring, adesione, rinuncia/ripresa, capienza e revisioni. Test e review indipendenti in corso, nessun deploy del nuovo modulo.

Esiti, approvazione e limiti in [STORAGE_FASE_B](../docs/STORAGE_FASE_B.md).

## Terzo incremento: programma essenziale, 27 ottobre

Triage: impatto 2, urgenza 2, sforzo L; parte nello stesso task su worktree
separato, senza interferire con il rilascio B autorizzato e in corso.
Confermato dal coordinamento e dal secondo parere: tipi info e turni, tipo
immutabile anche in bozza. Il primo turno ha un solo slot con capienza
richiesta. Etichette Solo informazione / Attività con iscrizione; titolo,
luogo e orari restano se si cambia tipo prima del primo salvataggio.
Spec incrementale: docs/PROGRAMMA_PRIMO_INCREMENTO.md. Nessun collegamento
S3 inventato, nessuna migrazione RecordNight o delega implicita.

Checkpoint di implementazione: i controlli browser dell'autore usano soltanto
fixture nel progetto demo, senza origini produzione raggiungibili. Non
sostituiscono i test permanenti di un altro autore. L'ultimo giro della suite
client esistente fallisce soltanto con
`src/copy/momenti.ts: MOMENTI non è in COPY (tests/glossary.test.mjs)`.
La guardia accenti passa con un indice git locale QA di 604 file presenti;
gli esempi .env non sono copiati nella QA. Decisione del coordinamento:
registrationStatus assente/null è legacy attivo se status non è cancelled;
la whitelist active/confirmed/pending_parent_authorization resta per gli
stati espliciti. Submitted, waitlist e valori sconosciuti sono esclusi.
Test permanenti e glossario appartengono a un autore distinto; nessun
cambiamento alla semantica storica RecordNight.

Review del programma: test indipendente RED reale save→delete→retry della
create ricreava il documento. Correzione: receipt server-only momentDeletions
con solo deletedAt, letta in transazione da ogni save e scritta nella stessa
transazione della cancellazione. ID assenti cancellati esplicitamente sono
marcati; repeat delete non riscrive la ricevuta. Limite 50 riferito ai momenti,
nuovo UUID esplicito richiesto per creare dopo una cancellazione. Cleanup
dell'attività esteso a receipt orfane con guardia sulla ricreazione del parent.
Nessun nome, titolo o UID nella ricevuta, deny SDK esplicito e nessun TTL.
UI con errore specifico, salvataggio vecchio bloccato e Ricarica che chiude la
bozza cancellata, senza cambiare automaticamente ID. GREEN ancora da ricevere.

## Integrazione su main, 31 ottobre

Ripreso dal worktree Codex fermo dal 27 ottobre con 11 file non committati
(checkpoint `22be02f`). Il secondo giro indipendente del 27 era già verde
(147/147), ma i test erano cambiati dopo: rilanciati in una copia QA pulita
sul mini.

Review di un altro modello (DeepSeek v4 pro, 0,29 $): nessun P1. Il P2 «limite
di 50 momenti non atomico con due creazioni concorrenti» non è accettato: la
documentazione Firestore garantisce transazioni serializzabili, quindi due
creazioni non possono leggere entrambe 49 momenti (dedotto, non provato;
l'emulatore non lo dimostrerebbe). Il P3 è corretto: un'azione di stato su un
momento eliminato da un altro admin ora mostra il conflitto con «Ricarica
programma», come `moment_deleted`.

Il collaudo browser ha trovato un difetto di accessibilità: la select «Per chi
vuoi iscriverti?» sta dentro la sua label e il nome accessibile comprendeva le
opzioni. Ora usa `aria-labelledby`. Le altre select dell'app seguono lo
stesso schema: task `gugd-select-etichette`.

L'harness browser non dipende più dalla cache di vite né dalla versione di
Chromium: preambolo React Refresh, import CJS pre-bundled, Local Network Access
disattivata per la pagina servita da Playwright, `VITE_EMULATOR_PROJECT_ID`.

Sette test nuovi di DeepSeek (0,14 $) in
`functions/tests/activityMomentsGapsEmulator.test.mjs`: show dopo hide, azione
su momento eliminato, retry da un altro admin, cleanup di attività e account
a lotti, due figli sullo stesso turno. Togliendo la pulizia delle ricevute
falliscono i due test attesi.

## Rilascio del programma a momenti, 31 ottobre

Pubblicato su conferma di Paolo in chat, dal clone pulito `d96a0f4` sul mini
(`~/qa/gugd-rilascio-momenti-20261031/app`), nell'ordine di
`docs/PROGRAMMA_PRIMO_INCREMENTO.md`:

| Passo | Esito |
| --- | --- |
| Firestore rules e indici | ruleset `676afc74…` uguale al file; `entries.ownerUids` READY |
| 5 Functions con `--force` | create, 38 ACTIVE, callable `UNAUTHENTICATED` strutturate |
| Hosting | service worker v34, `index-DkO87-0I.js`, 6 file identici alla build su entrambi i domini |

Con l'hosting è uscito anche il raccordo profilo `8facc3d` (task
`gugd-s2-appartenenza`). Nessun dato scritto in produzione per le verifiche.

## Quarto incremento: comitati e gruppi liberi, 31 ottobre

Scelte di Paolo in chat: questo incremento prima di delega e alloggi; comitati
e gruppi su ogni tipo di attività; fuori dal campeggio gestiscono admin e
dirigenti di unità, con i nomi solo via server; partenza dai cinque storici.
Contratto, stati e ritorni, verifiche e review in docs/ATTIVITA_MODULARI.md.

Server e rules, client, test, collaudo browser e review scritti da autori
diversi; tre giri di review Codex, collaudo con quattro difetti trovati e
corretti. Censimento in sola lettura della produzione: un solo piano salvato
(campeggio, cinque storici), nessuna iscrizione con il vecchio
`status: "cancelled"`.

Rilascio non eseguito: serve conferma fresca. Ordine: rules (lettura del piano
ai dirigenti, scrittura SDK chiusa), poi `campManagementSave` e
`campManagementStaff`, poi hosting. Un hosting pubblicato prima delle Functions
manderebbe `planFormat: 2` al server vecchio, che scarterebbe i comitati nuovi.
