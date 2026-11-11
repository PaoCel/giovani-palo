---
id: gugd-rules-apertura-futura
title: "Rules: iscrizioni accettate prima dell'apertura"
status: backlog
impact: 3
urgency: 2
effort: S
delivery: deploy
surface: [rules]
source: agente
opened: 2026-11-06
started_at:
touched: 2026-11-06
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

Trovato il 6 novembre 2026 nella verifica delle rules del settimo incremento (docs/ATTIVITA_MODULARI.md, «Le rules bastano: verifica»). activityAcceptsRegistrations guarda solo isPublic, isVisible e status == 'registrations_open': un'attività aperta con registrationOpen nel futuro (o registrationClose nel passato) accetta iscrizioni chiamando le API a mano. Le ferma solo il client (getRegistrationAvailability). Da valutare: confronto con request.time nella rule, attenzione al limite di 1000 espressioni di validRegistrationCreate e ai client già rilasciati (le date sono stringhe ISO: serve un campo timestamp o il confronto su stringa).

## Fatto quando

- criteri di accettazione: cosa deve essere vero, osservabile, perché il task
  sia chiuso (e cosa resta fuori, se serve dirlo)

## Da fare

- passi concreti, nell'ordine in cui vanno fatti

## Verificato

Cosa è stato provato davvero e come (configurazione, account, data). Vuoto
finché non c'è niente di provato: "dedotto dal codice" si scrive così.
