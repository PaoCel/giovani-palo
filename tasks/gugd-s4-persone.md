---
id: gugd-s4-persone
title: "S4: Persone del palo, inviti staff, iscrizione a mano, console pali"
status: blocked
impact: 2
urgency: 2
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
next: "Dopo S2: mockup di Persone, inviti e console pali con i token reali, poi callable stakePeople"
verified: ""
links: [docs/AUTONOMIA_MULTI_PALO.md, docs/ROADMAP_PALI.md]
done_at:
---

## Contesto

Obiettivo di Paolo (2026-10-20): un palo che non conosce usa l'app senza
chiedergli niente. Oggi ruoli, cambio di unità, iscrizioni a mano, creazione
di un palo e primo admin passano da console o script. Scelte P1-P4 approvate il
2026-10-16. Ruoli da UI non prima di S2 (decisione del 2026-10-18).

## Fatto quando

- pagina Persone (Richieste, Membri, Staff, Rimossi) con ruolo, unità,
  rimozione e riattivazione via callable `stakePeople`, guardie su sé stesso e
  ultimo admin, `auditLog` e toast Annulla;
- ramo client `canAdminAssignUserRole` chiuso nello stesso deploy che toglie
  la modale "Assegna admin";
- inviti staff monouso con conferma dell'admin; console pali del super admin con "Primi passi" per il primo admin;
  mittente e reply-to per palo; recupero dell'ultimo admin;
- collaudo di autonomia: un admin di un secondo palo (staging) configura palo,
  unità, staff, attività e iscrizioni senza console né aiuto.

## Da fare

- dettaglio nella spec. L'audit del 2026-10-20 la conferma attuale, ma i
  numeri di riga delle rules sono cambiati: `canAdminAssignUserRole` è a
  `firestore.rules:1171-1193` (applicata a r.1228), la modale "Assegna admin"
  a `AdminSettingsPage.tsx:708-763` con `usersService.ts:323`;
- buchi dell'audit fuori dalla spec, da aggiungere qui: idee della Notte dei
  Record solo da script ("Copia da un'altra attività"); id delle unità creati
  dalla UI con `slugify(nome)` invece di `<palo>-<slug>`; super admin senza
  selettore di palo (l'app usa sempre `profile.stakeId`);
- mittente e reply-to per palo (P4) non dipendono da S2: possono uscire prima;
- iscrizione a mano e correzione dei dati di un'iscrizione stanno in
  `gugd-admin-iscritti`, che non aspetta S2.

## Verificato
