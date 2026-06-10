# Checklist test manuale (post-overhaul 2026-06)

Eseguire dopo ogni deploy che tocca rules, ruoli o flusso iscrizioni.
Servono 4 account di prova: participant, parent, unit_leader (con unitId
assegnata), admin.

## Prerequisiti deploy

- [ ] `firebase deploy --only firestore:rules,firestore:indexes,storage`
- [ ] Attendere che gli indici (questions CG, registrations.anonymousUid/parentUid CG) risultino `Enabled` in console
- [ ] `firebase deploy --only functions`
- [ ] Backfill: `node scripts/backfillUnitIds.mjs` (dry-run, poi `--apply` se l'output è sensato)

## Dirigente unità (fix sicurezza)

- [ ] Login unit_leader → `/unit`: vede solo iscritti/giovani della PROPRIA unità
- [ ] Dashboard unità carica senza errori permission-denied (query filtrate per unitId)
- [ ] Account unit_leader senza unitId: avviso "Nessuna unità collegata", nessun crash
- [ ] (Console) una query manuale su registrations senza filtro unitId da account unit_leader viene rifiutata

## Genitore

- [ ] Da account participant: Profilo → "Passa ad account genitore" → redirect a `/family`
- [ ] `/family`: aggiungi figlio (nome, nascita, gruppo, unità) → appare nella lista
- [ ] "Iscrivi a un'attività" → lista pubblica → form iscrizione mostra "Chi vuoi iscrivere?"
- [ ] Selezione figlio → form precompilato con i suoi dati → invio ok → redirect `/family` con iscrizione visibile
- [ ] Secondo figlio iscritto alla STESSA attività: nessun conflitto (id child_ diversi)
- [ ] Attività con autorizzazione genitore: email magic-link arriva e la conferma funziona
- [ ] "Gestisci" dall'iscrizione del figlio riapre il form in modifica
- [ ] Profilo genitore → "Passa ad account partecipante" → redirect `/me`, figli conservati
- [ ] Admin: notifica nuova iscrizione mostra "Iscritto dal genitore"

## Regressione iscrizioni esistenti

- [ ] Iscrizione guest (senza account) funziona e genera codice di recupero
- [ ] Iscrizione participant autenticato funziona e sincronizza il profilo
- [ ] Guest → crea account → le iscrizioni anonime vengono collegate (fix collection-group)
- [ ] Annullamento iscrizione dal profilo utente funziona

## Admin

- [ ] Tab Domande di un evento carica (ora query collection-group: serve l'indice)
- [ ] Eliminazione evento di prova: spariscono registrazioni, campi form e domande
- [ ] Export Excel/PDF funzionano (chunk lazy)

## Performance/PWA

- [ ] Prima visita pubblica: home interattiva subito, nessun download admin
- [ ] Navigazione `/admin` da login: chunk admin caricato on demand
- [ ] Dopo un deploy con app aperta: navigare → se chunk mancante appare il pannello "Ricarica la pagina" (no schermo bianco)
