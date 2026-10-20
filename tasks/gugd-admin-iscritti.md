---
id: gugd-admin-iscritti
title: "Admin: iscrizione a mano e correzione dei dati di un iscritto"
status: in-progress
impact: 2
urgency: 2
effort: M
delivery: deploy
surface: [web, rules, functions]
source: paolo
opened: 2026-10-20
started_at: 2026-10-20
touched: 2026-10-20
due:
blocked_by: []
branch: task/gugd-admin-iscritti
worktree: /Users/paolocelestini/Developer/giovani-palo/.claude/worktrees/goofy-einstein-78f784
session: 3b5e6431-ed1b-420c-83ed-ae790b460974
stopped_at: "Codice, rules e functions pronti e mergiati in main; non deployati"
next: "Conferma di Paolo, poi deploy da main in ordine: firestore:rules, functions per nome (onRegistrationPendingParentAuth, parentAuthorizationConfirm, parentAuthorizationReject, parentAuthorizationResend, parentAuthorizationIssueOwnToken, parentAuthorizationGetContext, sendAdminPushForNewRegistration), hosting con service worker v30; poi verifica del ruleset live e delle functions. Prima del merge di S2: rimisurare il budget"
verified: "Test unitari 1290 sul mini (1280 verdi, 9 skipped, accenti verdi in locale) scritti da altri agenti; emulatore: 4 file adminRegistration* (rules 145+2, budget 48, trigger 16, callable 39), più parentAuthorization Restart/Cancelled, multiStakeIsolation, parentConsent, registrationInitialStatus, parentCancel, campStaff, roomManagement, SelfSign, registrationUpdateRules.py: verdi. Budget massimo reale 914 (pattuglie admin titolare), admin che corregge la propria iscrizione 447. Review: Codex 4 giri (BLOCKED, BLOCKED, BLOCKED, BLOCKED su punti poi corretti; ultimo: P2 lettura scaduta e answers assente, corretti) e 2 giri di un altro modello. Collaudo da admin nel browser contro emulatori con functions: 0 FAIL nel giro finale (154 controlli brevi dopo 180+361 dei giri completi), confronti col mockup in side-session-notes/local_0456cb35…/qa-admin-iscritti/out/. Non provati: dirigente di unità dopo il cambio unità, mail vera, Safari iOS."
links: [docs/ADMIN_ISCRITTI.md, docs/AUTONOMIA_MULTI_PALO.md]
done_at:
---

## Contesto

Scelte I1-I8, R e F di `docs/ADMIN_ISCRITTI.md` approvate da Paolo il
2026-10-20: tutte come consigliato.

Audit del 2026-10-20: le iscrizioni `manual_` si creano solo con l'Admin SDK
(13 sul viaggio al tempio) e l'admin non può correggere nome, unità o data di
nascita di un iscritto, solo stato ed email del genitore. Sono le richieste
più frequenti di un admin che non tocca ruoli né appartenenza, quindi non
aspettano S2 (il collegamento all'account con "Mostra codice" arriva con S3).
Le rules danno già `create` e `update` all'admin del palo senza controllo del
payload (`firestore.rules:1498-1504`).

## Fatto quando

- "Aggiungi a mano" nella tab Iscritti crea `manual_<id>` con `createdBy`;
  "Chiedi l'autorizzazione" usa il flusso esistente se c'è l'email del genitore;
- "Modifica dati" su un'iscrizione: nome, cognome, unità, data di nascita,
  categoria, note; un cambio che sposta minore/adulto o l'unità dice cosa
  succede a consensi e visibilità del dirigente prima di salvare;
- un'iscrizione a mano si annulla e si riattiva come le altre;
- deciso se l'update admin delle iscrizioni va limitato a una allowlist di
  campi (oggi può riscrivere anche i consensi firmati), verificando quali
  scritture usano le build in giro;
- test unitari e rules nell'emulatore da un altro agente, collaudo nel browser.

## Da fare

- `gugd-admin-dialoghi` è chiuso (2026-10-20): si parte da `main`; estrarre
  la tab Iscritti di `AdminEventDetailPage.tsx` (4800 righe) in un file suo.
- spec `docs/ADMIN_ISCRITTI.md`: stati e ritorni, effetti di data di
  nascita, unità e nome su consensi e visibilità, rules, functions, scelte.
- S2 (`task/gugd-s2-appartenenza`) cambia `currentUserExists()` (account non
  anonimo), usata da `isStakeAdmin`: quando i due branch si incontrano in
  `main`, rimisurare il budget dell'update iscrizione
  (`registrationUpdateRules.py`, casi pesanti di `parentCancelRulesEmulator`,
  test di budget di questo task). S2 fase 2 tocca anche `functions/index.js`.
- serve anche un deploy delle functions (trigger che invalida i link quando
  un'iscrizione esce da "in attesa" senza firma): `delivery: deploy` vale per
  rules, functions e hosting, nell'ordine.

## Verificato
