---
id: gugd-accesso-sondaggio
title: Link breve e accesso al sondaggio senza account
status: needs-paolo
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
blocked_by: ["decisione: conferma deploy rules e hosting, attivazione ospite"]
branch: main
worktree:
session: 01a16532-d1ef-7180-9935-8ed72e8712aa
stopped_at: "Ingresso dedicato, link breve e compatibilità legacy completati, verificati e pronti per il deploy."
next: "Conferma fresca: deploy rules, attiva surveyGuestEnabled sul solo viaggio richiesto, deploy hosting SW v32; verifica accesso reale senza inviare risposte."
verified: "1308 test e build sul mini; 15 test rules SDK indipendenti; 25 controlli browser con ospiti e quattro ruoli, 320/390/430; review PASS. Flag prod ancora spento, dry-run 8 domande, nessuna risposta di prova in prod."
links: []
done_at:
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

- Conferma fresca per rules, flag del singolo evento e hosting (SW v32).
- Deploy da main pulito: rules, script setSurveyGuestAccess.js con backup privato, hosting.
- Verifica read-only con sessione guest reale, asset live e chiusura del task.
- Conservare eccezione e test guest quando il ramo S2 sarà integrato.

## Verificato

1308 test client e build di produzione verdi. Quindici test delle rules con
SDK client e token di ruolo: incluso rifiuto payload identificativi, domande
non attive, eventi disabilitati/non pubblici, letture di altre aree.
25 controlli browser su emulatori: ospite a tre larghezze, nessun users doc,
riuso sessione e bozza, invio senza duplicati, quattro ruoli senza iscrizione,
recupero password, flag spento, slug ignoto e tre tipi di link legacy.

Review indipendente PASS. Handler Google riusato; OAuth Google reale non
rieseguito. Flag produzione ancora spento: dry-run con 8 domande attive;
22 domande complessive censite, tutte con status active. Rules live scaricate
per confronto. Nessuna risposta di prova o modifica dati in produzione.

Artefatti privati in .claude/ops/accesso-sondaggio/ e
.claude/mockups/accesso-sondaggio/. Verifiche sul disco interno del mini via
SSH dopo mini sync: il volume DevServer era collegato ma non montabile, e il
wrapper mini usciva con 72. Nessuna modifica alle cache condivise.
