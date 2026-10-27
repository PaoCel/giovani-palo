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
worktree: /Users/paolocelestini/.codex/worktrees/gugd-momenti/giovani-palo
session: 01a17799-4984-7af2-857e-2a02f5b4db11
stopped_at: "Creazione guidata e camp pubblicati in B; programma info/turni nel worktree b37a2be, con test e review indipendenti in corso"
next: "Concludere test indipendenti, review e collaudo programma, poi integrare su main; prossimo deploy con conferma fresca"
verified: "B pubblicato. Programma isolato b37a2be: build e browser demo autore passano, suite esistente 1523/1524 (catalogo da registrare); test indipendenti e review in corso"
links: [docs/ATTIVITA_MODULARI.md, docs/PROGRAMMA_A_MOMENTI.md, docs/AUTONOMIA_MULTI_PALO.md]
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
