---
id: gugd-attivita-modulari
title: "Attività guidate: programma, gruppi, comitati e alloggi"
status: in-progress
impact: 2
urgency: 2
effort: L
delivery: deploy
surface: [web, functions, rules]
source: paolo
opened: 2026-10-26
started_at: 2026-10-26
touched: 2026-10-27
due:
blocked_by: []
branch: codex/gugd-momenti
worktree: ../../.codex/worktrees/gugd-momenti/giovani-palo
session: 01a17799-4984-7af2-857e-2a02f5b4db11
stopped_at: "Programma essenziale implementato nel worktree; compatibilità legacy allineata al coordinamento. S2 possiede test indipendenti e glossario, reviewer separato assegnato"
next: "Test indipendenti su factory/rules/cleanup/concorrenza e review server; correggere eventuali rilievi. Nessun merge/push/deploy da questo worktree"
verified: "Build TypeScript/Vite mini EXIT0; quattro mockup390 e confronto mockup/reale renderizzati e aperti. Browser demo: authoring/pubblicazione, giovane/genitore, scelta esplicita tra figli, rinuncia/posto pieno/ripresa, annullamento bozza e conflitto tra schede PASS; zero errori pagina e overflow320/390/430. Textarea e footer visibili con altezza500 dopo correzione scroll. Suite client1523/1524: resta registrazione catalogo MOMENTI nel test glossario. Test indipendenti e review del nuovo modulo da assegnare; nessun suo deploy"
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
