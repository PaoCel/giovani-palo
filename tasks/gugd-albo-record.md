---
id: gugd-albo-record
title: Albo dei risultati della Notte dei Record
status: needs-paolo
impact: 2
urgency: 3
effort: S
delivery: deploy
surface: [web, rules]
source: paolo
opened: 2026-10-22
started_at: 2026-10-22
touched: 2026-10-22
due:
blocked_by: ["decisione: conferma deploy hosting"]
branch: main
worktree:
session: 01a16532-d1ef-7180-9935-8ed72e8712aa
stopped_at: "Sondaggio pubblicato, quattro risultati salvati, albo implementato e verificato; manca il deploy hosting autorizzato."
next: "Conferma fresca di Paolo, deploy solo hosting da main pulito e verifica asset live."
verified: "1305 test e build sul mini; 31 controlli di rules e browser a 320/390/430 con partecipante, genitore e dirigente; invio sondaggio sugli emulatori. Guest live senza nomi, query non autenticata 403. Quattro risultati riletti, secondo dry-run zero modifiche."
links: []
done_at:
---

## Contesto

Mostrare agli account autenticati dello stesso palo i risultati confermati
dallo staff. Dati reali e nomi restano fuori dal repository pubblico.
Sondaggio del viaggio di ottobre pubblicato con le otto domande esistenti.

## Fatto quando

- Sondaggio del viaggio pronto sul link condiviso con accesso per tutti i ruoli.
- Albo live con i soli quattro risultati indicati da Paolo, senza nomi agli ospiti.
- Nessun risultato dedotto per altre prove; record nascosti esclusi.
- Verifica browser e build eseguite; deploy hosting confermato da Paolo.

## Da fare

- Conferma e deploy solo hosting, service worker v31.
- Verifica degli asset live e chiusura del task.

## Verificato

22 ottobre 2026: 1305 test verdi e build di produzione sul Mac mini;
review indipendente senza blocchi. Emulatori demo-albo-record: query esatta
dei record per quattro ruoli del palo, rifiuto delle scritture anche per
admin e lettura negata ad altro palo. Browser loggato a 320/390/430:
partecipante, genitore e dirigente leggono quattro risultati e otto domande;
invio del sondaggio verificato per ogni ruolo su dati sintetici.

Produzione: otto domande create in transazione copiando il viaggio precedente;
quattro risultati registrati con backup locale privato e rilettura. Secondo
dry-run senza modifiche. Callable ospite live: 11 record, nessun winnerName;
query record senza autenticazione: HTTP 403. Nessuna risposta di prova scritta
in produzione. Dettagli e screenshot privati in .claude/ops/albo-record/ e
.claude/mockups/albo-record/.
