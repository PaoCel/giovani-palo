---
id: gugd-compagni-stanza
title: Compagni di stanza nella scheda del partecipante e in Famiglia
status: backlog
impact: 2
urgency: 1
effort: M
delivery: deploy
surface: [web, functions]
source: paolo
opened: 2026-11-03
started_at:
touched: 2026-11-03
due:
blocked_by: []
branch:
worktree:
session:
stopped_at: ""
next: ""
verified: ""
links: []
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
