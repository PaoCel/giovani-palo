---
id: gugd-home-social
title: "Home del palo più social: post, foto, commenti"
status: needs-paolo
impact: 2
urgency: 1
effort: L
delivery: deploy
surface: [web, rules, functions]
source: paolo
opened: 2026-10-20
started_at: 2026-10-26
touched: 2026-10-26
due:
blocked_by: ["decisione: conferma fresca per il rilascio coordinato B"]
branch:
worktree:
session: 01a17799-4984-7af2-857e-2a02f5b4db11
stopped_at: "Home e guardie upload finali integrate su main 41a215c, browser reale8/8 e quattro viewport verificati; nessun deploy B"
next: "Conferma e rilascio coordinato B; poi gestione post admin, contesto Famiglia e moduli successivi"
verified: "Finale 41a215c, tree 74c544a: build, 1524 client, 1975 rules, 115 query; Home 8/8 con Auth/Firestore e screenshot a 320/390/430/1440 px; 6 guardie upload e 5 cambi contesto. Review PASS. Query prod: 8 post pubblicati tutti con visibilità esplicita, nessun post perso. Solo fase A Storage eseguita in produzione"
links: [docs/HOME_SOCIAL.md, docs/HOME_SOCIAL_REVIEW.md, docs/prototypes/home-social/index.html, docs/GALLERIA_ATTIVITA.md]
done_at:
---

## Contesto

Il 26 ottobre Paolo conferma che la home dei giovani deve essere un feed
attrattivo come un social. La progettazione può partire in parallelo alla
verifica S2; il rilascio continua a dipendere dall'appartenenza verificata.
Non è ancora una decisione di abilitare post liberi dei ragazzi. Raccordo
con l'organizzazione delle attività: docs/ATTIVITA_MODULARI.md.

Paolo (2026-10-20): dopo la gestione admin, una home "tipo Facebook". La base
c'è già: `stakes/{s}/feedPosts` (annuncio, promemoria, galleria), like sui post
e sulle foto, commenti nelle rules per post e foto ma nella UI solo sulle foto
(`MediaLightbox`). Il feed è in `/me` e `/unit`, non in `/family`. Va costruita
sopra l'appartenenza verificata di S2: oggi basta scegliere il palo per
entrare, e un feed con foto e commenti di minori non può dipendere da questo.

## Fatto quando

- deciso con Paolo: chi pubblica (staff, ragazzi), chi commenta, chi vede,
  moderazione e segnalazioni, notifiche; feed anche in `/family`;
- rules del feed rifatte, con test nell'emulatore. Oggi (letto il 2026-10-20,
  dati di produzione non controllati):
  - `feedPosts` pubblicati leggibili da chiunque, anche senza login, e il
    campo `visibility` (`admins_only`, `gallery_members`) non è applicato;
  - `likeCount` scrivibile da ogni utente loggato (contatore lato client);
  - commenti dei post leggibili e scrivibili da ogni utente loggato,
    ospiti anonimi compresi, di qualunque palo e anche su post non pubblicati;
- admin: modifica di un post, promemoria con scelta dell'attività invece
  dell'id scritto a mano (`AdminFeedPage.tsx:136`);
- cleanup di post, commenti e like nella cancellazione account.

## Da fare

- Primo blocco autorizzato il 26 ottobre: spec, stati e ritorni, prototipo
  isolato, review indipendente, render mobile 320/390/430 e desktop.
- Primo incremento conservativo P1/P2/P3 eseguito nell’autonomia confermata:
  admin autori, filtro su iscrizioni personali, Me e riuso Unità; nessun
  ampliamento di pubblicazione libera o identità Famiglia.
- Dopo S2: riconciliare il contratto effettivo di visibilità e le query,
  implementare per piccoli blocchi con test indipendenti e collaudo reale.
- Il primo blocco non chiude il task completo e non autorizza il rilascio.

## Verificato

Primo blocco del 26 ottobre: `docs/HOME_SOCIAL_REVIEW.md`. Review indipendente
della spec, test del prototipo scritti da un altro agente, esecuzione sul mini
68/68 e verifica visiva dei PNG. Tutti i dati e la fotografia sono sintetici.
Gemini tentato ma accesso rifiutato con `UNSUPPORTED_CLIENT`; secondo parere
ottenuto da gpt-6-astra. Task complessivo ancora aperto, rilascio dopo S2.

### Primo incremento del client, 26 ottobre

Home con una prossima attività e stato reale dell’iscrizione, feed verticale
con filtri, foto/commenti e contributo alla galleria. Navigazione partecipante
con etichette visibili; desktop con sidebar senza barra duplicata. Dirigenti
riusano il feed mantenendo i propri strumenti.

Visibilità del feed applicata sul server anche a like/commenti e query
aggiornata con indice esplicito. Revoca, cambio account/palo/galleria e
risposte tardive non ripristinano contenuti del contesto precedente. Viewer
con bozze distinte per foto, protezione Chiudi/Esc/Back, richieste condivise
e ID stabile al retry, errore lettura distinto da elenco vuoto, offline
prima delle scritture. La revoca ripulisce anche un invio dopo la normale
chiusura del viewer. Test dei servizi scritti da autore diverso.

Spec e verbale completo in HOME_SOCIAL.md. Questo incremento non chiude
la consegna completa: Famiglia, editor post admin e ciclo di vita globale
dei contenuti del feed restano nei criteri del task. Nessun nuovo ingresso
alla pubblicazione libera, nessun deploy.

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
