---
id: gugd-accesso-sondaggio
title: Link breve e accesso al sondaggio senza account
status: done
impact: 2
urgency: 3
effort: S
delivery: deploy
surface: [web, rules]
source: paolo
opened: 2026-10-23
started_at: 2026-10-23
touched: 2026-10-23
due:
blocked_by: []
branch: main
worktree:
session: 01a16532-d1ef-7180-9935-8ed72e8712aa
stopped_at: "Rules e hosting in produzione, ospite attivo sul viaggio richiesto; otto domande aperte con sessione anonima reale."
next: Nessuna attività residua.
verified: "1308 test e build sul mini; 15 test rules SDK indipendenti; 25 controlli browser con ospiti e quattro ruoli, 320/390/430; review PASS. Rules live e 4 asset identici alla build su entrambi i domini; SW v32; flag attivo e 8 domande aperte da ospite reale, nessuna risposta di prova in prod."
links: []
done_at: 2026-10-23
---

## Contesto

Il sondaggio già pubblicato deve raccogliere più risposte: link leggibile,
accesso semplice e alternativa senza registrazione, approvata da Paolo.
Dettaglio in docs/SONDAGGIO_ACCESSO.md. Nessun nome reale negli artefatti pubblici.

## Fatto quando

- Link /sondaggio/tempio-ottobre-2026 attivo, ingresso compatto con Google/email.
- Continua senza account apre direttamente le domande e non crea un profilo.
- Tre link legacy portano al nuovo percorso prima della richiesta di accesso.
- Ospiti limitati al sondaggio pubblico esplicitamente abilitato; nessuna nuova apertura di galleria o record.
- Deploy rules e hosting autorizzato, flag attivato e verifica live completata.

## Da fare

Nessuna attività residua. Il ramo S2 deve conservare il contratto guest
approvato, documentato nella spec e nelle note di progetto.

## Verificato

1308 test client e build di produzione verdi. Quindici test delle rules con
SDK client e token di ruolo: incluso rifiuto payload identificativi, domande
non attive, eventi disabilitati/non pubblici, letture di altre aree.
25 controlli browser su emulatori: ospite a tre larghezze, nessun users doc,
riuso sessione e bozza, invio senza duplicati, quattro ruoli senza iscrizione,
recupero password, flag spento, slug ignoto e tre tipi di link legacy.

Review indipendente PASS. Handler Google riusato; OAuth Google reale non
rieseguito. Prima del deploy: dry-run con 8 domande attive;
22 domande complessive censite, tutte con status active. Rules live scaricate
per confronto. Nessuna risposta di prova in produzione.

Artefatti privati in .claude/ops/accesso-sondaggio/ e
.claude/mockups/accesso-sondaggio/. Verifiche sul disco interno del mini via
SSH dopo mini sync: il volume DevServer era collegato ma non montabile, e il
wrapper mini usciva con 72. Nessuna modifica alle cache condivise.

Deploy del 23 ottobre 2026 autorizzato esplicitamente: rules, attivazione del
flag con backup privato e hosting dal commit 6258352. Rules live identiche
al sorgente; index, SW e chunk SurveyPage identici alla build su gugditalia.it
e giovani-palo.web.app. Service worker v32. Nel browser live, una sessione
Firebase anonima reale ha aperto tutte le otto domande senza profilo. Nessun
campo compilato e nessun invio di prova.
