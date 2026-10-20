---
id: gugd-home-social
title: "Home del palo più social: post, foto, commenti"
status: blocked
impact: 2
urgency: 1
effort: L
delivery: deploy
surface: [web, rules, functions]
source: paolo
opened: 2026-10-20
started_at:
touched: 2026-10-20
due:
blocked_by: [gugd-s2-appartenenza]
branch:
worktree:
session:
stopped_at: ""
next: "Dopo S2: spec con chi pubblica, chi commenta e chi vede, stati e ritorni, mockup con i token reali, secondo parere di un altro modello sulle scelte"
verified: ""
links: [src/types/feed.ts, docs/GALLERIA_ATTIVITA.md]
done_at:
---

## Contesto

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

- dettaglio dopo S2.

## Verificato
