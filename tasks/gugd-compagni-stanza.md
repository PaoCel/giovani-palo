---
id: gugd-compagni-stanza
title: Compagni di stanza nella scheda del partecipante e in Famiglia
status: needs-paolo
impact: 2
urgency: 1
effort: M
delivery: deploy
surface: [web, functions]
source: paolo
opened: 2026-11-03
started_at: 2026-11-03
touched: 2026-11-03
due:
blocked_by: ["decisione: prova dei nomi con un account genitore vero (figlio in una stanza pubblicata)"]
branch:
worktree:
session: d3cf1644-766e-4550-afa5-7e53587f6915
stopped_at: "In produzione dal 3 novembre 2026 (roomMates e hosting v39 da 94a0300); manca solo la prova dei nomi con un account genitore vero."
next: "Paolo apre Famiglia con un account genitore che ha un figlio in una stanza di un piano pubblicato (o alla prossima pubblicazione) e controlla i nomi; poi tasks done. Restyling, card roomCard di MyActivityDetailPage: roomMatesService.getAssigned({ stakeId, activityId }) -> { room: { name, capacity } | null, mates: [{ fullName, adult }] }, testi con formatRoomMates e formatRoomBeds di @/utils/roomMates, titolo STANZA.titolo."
verified: "Emulatore (functions/tests/roomMatesEmulator.test.mjs, scritto da un altro agente, utenti veri, mini): 19/19 su tutti i casi della spec più titolare unico, attività cancellata, input ostili, tetto 50. Suite stanze esistenti 48/48 in copia QA con porte proprie. Review Codex gpt-6-astra su e932316: PASS WITH CONCERNS, due rilievi bassi corretti in 557d810 e f96150a. Mini: npm test 1586/1587 (unico rosso accentApostrophes, senza git nello specchio del worktree; verde sull'Air), build ok, functions 72/72. Client util 11/11. Famiglia vista nel browser su emulatori a 320/390/430/1440 (testo >= 13 px, nessuno scroll, annullata assente). Produzione: roomMates senza login risponde UNAUTHENTICATED, sorgente live uguale a main (generateDownloadUrl); bundle index-B4muqRFV.js e service worker v39 su gugditalia.it e giovani-palo.web.app; Famiglia caricata senza errori con l'account admin di Paolo (nessun figlio, quindi nessuna chiamata). Nomi in produzione non ancora visti."
links: [docs/ROOM_MANAGEMENT.md]
done_at:
---

## Contesto

Paolo, 3 novembre 2026, guardando il restyling della scheda giovane (fase 1 di
`gugd-restyling`): nella card «La tua stanza» vuole i nomi dei compagni di
stanza, come nel mockup scelto (direzione A). Oggi il partecipante vede solo il
nome della propria stanza: `roomManagementSave` scrive `assignedRoomId` e
`assignedRoomName` sulle iscrizioni quando l'admin pubblica il piano;
`management/rooms` lo legge solo l'admin (`firestore.rules`, match
`/management/{managementId}`). Precedente già in produzione: nella scheda
Gruppo il ragazzo vede nome e cognome dei componenti (`publicMembers` di
`management/camp`).

## Chi vede cosa (deciso da Paolo il 3 novembre)

- **Chi**: il partecipante, nella sua scheda `/me/activities/:id`, e il
  genitore che gestisce l'iscrizione del figlio, da Famiglia. Nessun altro
  ruolo nuovo; account anonimi no.
- **Quando**: solo con il piano stanze pubblicato (`published: true`), con
  l'iscrizione assegnata a una stanza e non annullata. Piano tornato in bozza:
  i nomi spariscono.
- **Cosa**: nome e cognome delle altre persone assegnate alla stessa stanza,
  iscrizioni annullate escluse. Gli adulti della stanza compaiono con
  l'etichetta «dirigente», come nella scheda Gruppo. Mai le altre stanze, mai
  dati sanitari, unità o contatti. Se il piano ha i posti letto della stanza,
  anche quelli.

## Proposta tecnica (da confermare scrivendo i test)

Callable di sola lettura (gen2, `europe-west1`, Admin SDK) che riceve
`stakeId` e `activityId`, trova l'iscrizione di chi chiama (o del figlio per il
genitore) e restituisce solo i nomi della sua stanza. Sempre allineata alle
cancellazioni, nessun campo nuovo sulle iscrizioni, nessuna allowlist da
toccare. L'alternativa (nomi denormalizzati sull'iscrizione da
`roomManagementSave`) invecchia quando un compagno annulla.

## Fatto quando

- test nell'emulatore con utenti veri (non Admin SDK): il partecipante vede
  solo la sua stanza; quello di un'altra stanza no; chi non è iscritto riceve
  un errore; piano in bozza: niente nomi; annullati esclusi; il genitore vede
  la stanza del figlio e non quella di altri; anonimo rifiutato; scritti da un
  agente diverso da chi scrive la callable;
- review del server da un altro modello;
- client: card «La tua stanza» in Famiglia; la card della scheda `/me` è
  già rifatta sul branch `task/gugd-restyling`
  (`src/pages/me/MyActivityDetailPage.tsx`, `roomCard`): lì si aggiungono i
  nomi dopo il merge in `main` del pezzo server, per non litigare sullo
  stesso file;
- deploy della callable prima dell'hosting, con conferma fresca di Paolo,
  e prova con un account vero nel browser.

## Verificato (3 novembre 2026, branch `task/gugd-compagni-stanza`)

- Callable `roomMates` (`functions/lib/roomManagement.js`), contratto in
  `docs/ROOM_MANAGEMENT.md`, «Compagni di stanza». Scelta la callable e non i
  nomi denormalizzati: il motivo è nello stesso documento.
- Titolo in Famiglia «La stanza di {nome}» e non «La tua stanza»: lì legge il
  genitore. «La tua stanza» resta in `STANZA.titolo` per la scheda del giovane.
- Rischio noto, non corretto: nessun rate limit sulla callable (al massimo 54
  letture a chiamata), come `roomMateSuggestions`.

## Rilascio (3 novembre 2026, su conferma di Paolo)

Dal clone pulito di `94a0300` sul mini: `firebase deploy --only functions:roomMates` (creata,
sorgente live uguale a main), poi `--only hosting` con service worker v39. Prima del deploy la build
di `8abd34f` ha dato `index-DQXbfmLZ.js`, lo stesso bundle servito: l'hosting ha portato solo
Famiglia. Prova con account vero: l'account admin nel browser integrato non ha figli; la lettura
diretta in produzione con il suo token è stata bloccata, quindi i nomi live restano da vedere.

