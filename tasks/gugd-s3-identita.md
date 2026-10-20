---
id: gugd-s3-identita
title: "S3: codici di collegamento, invito genitore, Non ricordo l'account"
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
next: "Dopo S2: rileggere le scelte I1-I5 della spec e i file che S4 tocca, per lavorare su file disgiunti"
verified: ""
links: [docs/IDENTITA_E_ACCESSO.md, docs/APPARTENENZA_AL_PALO.md]
done_at:
---

## Contesto

Chi è iscritto da un genitore o da un admin non ha un modo per collegarsi al
proprio account, e i ragazzi non sanno con quale account sono entrati. Con
l'appartenenza verificata (S2) il codice dello staff sul posto è anche la
strada per diventare membro attivo. Può girare in parallelo a S4 su file
diversi.

## Fatto quando

- codice personale di 15 minuti dallo staff, link con token lungo dal genitore,
  vista "Iscritti senza account", pagina "Non ricordo l'account" con risposta
  sempre uguale, primo passo di accesso unico (parte C di APPARTENENZA);
- codici e link con TTL e nella pulizia della cancellazione account;
- rules e callable provate nell'emulatore, collaudo nel browser.

## Da fare

- dettaglio nella spec, dopo la chiusura di S2.

## Verificato
