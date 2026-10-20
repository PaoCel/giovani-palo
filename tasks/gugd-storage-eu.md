---
id: gugd-storage-eu
title: "Storage in UE: fasi A-E della migrazione"
status: needs-paolo
impact: 2
urgency: 2
effort: M
delivery: deploy
surface: [storage, rules, functions, web]
source: paolo
opened: 2026-10-20
started_at:
touched: 2026-10-20
due:
blocked_by: ["decisione: conferma fresca per la fase A in produzione"]
branch: codex/storage-eu
worktree: /Users/paolocelestini/Developer/giovani-palo-storage-eu
session:
stopped_at: "Pronta dal 2026-10-16, ferma per il viaggio del 16-18/10; branch pushato su origin, fermo a b873616 con base c010afa"
next: "Paolo conferma la fase A (bucket nuovo, rules solo lì, sync: nessun impatto sugli utenti); poi merge di main nel branch prima della fase B"
verified: ""
links: ["~/dev/agent-handbook/projects/giovani-palo.md#migrazione-storage-in-ue-2026-10-16-pronta-non-eseguita-in-produzione"]
done_at:
---

## Contesto

File di galleria, consensi e copertine sono nel bucket di default in
us-central1. Decisione del 2026-10-16: spostarli in `giovani-palo-eu`
(europe-west1). Ordine del 2026-10-18: parte dopo S1 e prima che S2 cambi le
rules Storage; S2 non aspetta la fase E. Piano, numeri, rollback e comandi
nella sezione linkata delle note di progetto.

## Fatto quando

- fase B in produzione: rules, functions e hosting puntano al bucket UE,
  `migrate-storage-bucket.mjs --phase all --apply` chiude con `VERIFY_OK` e
  `oldRefs 0`, upload in galleria provato con un account QA nel browser;
- fasi C e D chiuse (7 giorni senza `WriteObject` sul bucket vecchio, poi rules
  che negano tutto sul vecchio);
- fase E (cancellazione copie USA) solo con conferma esplicita: irreversibile.

## Da fare

- fase A con conferma fresca: `storage-eu-bucket.cjs create` e `link`, rules sul
  bucket nuovo dopo diff con il live, sync, `check`;
- merge di `main` in `codex/storage-eu` (main è avanti di sei fasi del flusso
  genitore: conflitti attesi su `public/sw.js`, functions, informativa), test
  sul mini, review di un altro modello;
- fase B con conferma fresca, deploy da copia isolata del commit;
- C: `--phase all --apply` ogni sera, metrica del bucket vecchio;
- D, poi E solo su richiesta.

## Verificato

Niente in produzione. Su staging il bucket `giovani-palo-staging-eu` risponde
con token 206, senza token 403 (2026-10-16).
