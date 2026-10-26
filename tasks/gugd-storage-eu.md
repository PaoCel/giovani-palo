---
id: gugd-storage-eu
title: "Storage in UE: fasi A-E della migrazione"
status: in-progress
impact: 2
urgency: 2
effort: M
delivery: deploy
surface: [storage, rules, functions, web]
source: paolo
opened: 2026-10-20
started_at: 2026-10-26
touched: 2026-10-26
due:
blocked_by: []
branch: codex/storage-eu
worktree: /Users/paolocelestini/Developer/giovani-palo-storage-eu
session: 01a17799-4984-7af2-857e-2a02f5b4db11
stopped_at: "Fase A autorizzata ed eseguita: bucket UE collegato, rules EU verificate, 1196 copie identiche; integrazione B in corso"
next: "Integrare e collaudare B, chiudere revoca/cancellazione su entrambe le copie e correggere informativa; nuova conferma prima del rilascio"
verified: "Fase A live EXIT0: create/link, rules solo UE con default invariato; 1196/1196 copie, zero differenze CRC/dimensioni/metadata; 3 download token206/senza403. S2 dry-run180 e cleanup31 invariati. App e Functions ancora sul vecchio bucket; B non autorizzata"
links: [docs/STORAGE_FASE_A.md]
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

- fase A con conferma fresca: `tools/storage-eu-bucket.mjs create` e `link`, rules sul
  bucket nuovo con `tools/storage-eu-rules-deploy.mjs`, sync e `inspect`;
- merge di `main` in `codex/storage-eu` (main include il flusso genitore, S2 e home: conflitti attesi su `public/sw.js`, functions, informativa), test
  sul mini, review di un altro modello;
- fase B con conferma fresca, deploy da copia isolata del commit;
- C: `--phase all --apply` ogni sera, metrica del bucket vecchio;
- D, poi E solo su richiesta.

## Verificato

Niente in produzione. Su staging il bucket `giovani-palo-staging-eu` risponde
con token 206, senza token 403 (2026-10-16).


## Ripresa del 26 ottobre: strumenti fase A

Gli script di sessione citati nel piano precedente non sono nel repository.
Si aggiungono strumenti versionati con dry-run di default, allowlist delle
coppie progetto/bucket, ownership verificata tramite projectNumber, regione
e protezioni obbligatorie; autenticazione del login Firebase CLI e nessun
accesso agli oggetti. Config del deploy con bucket UE esplicito e wrapper da
main pulito, con confronto SHA-256 delle rules live prima e verifica dopo.

Il codice del passaggio del client rimane sul branch distinto
`codex/storage-eu`, commit storico b873616: non viene integrato da questo
incremento. Le conferme per operazioni reali, sync e fasi successive restano
necessarie. Nessun cambiamento di produzione eseguito.


### Letture del 26 ottobre

Il nuovo `inspect` eseguito sul mini con il login Firebase CLI esplicito ha
confermato `exists: false`, `linked: false`, EXIT=0, senza accesso agli oggetti.
Anche `create` senza `--apply` ha confermato solo un'azione pianificata, zero
modifiche, EXIT=0. Create/link/deploy reali non provati: le POST e i relativi
errori sono verificati con API simulate, non eseguiti contro produzione.
Il dry-run separato di `migrate-storage-bucket.mjs --phase sync` ha contato
1196 oggetti sorgente, destinazione assente, 1065,8 MB da copiare, zero
cancellazioni e zero conflitti; nessun checkpoint scritto. Sono conteggi
osservati il 26 ottobre, da ricontrollare prima dell'applicazione.

### Preparazione chiusa, 26 ottobre

23/23 test mock API/CLI sul mini, EXIT=0 e zero salti; review indipendente
PASS WITH CONCERNS soltanto per operazioni reali non ancora autorizzate.
Le letture reali confermano bucket EU assente e piano di creazione senza
POST. Dry-run sync: 1196 oggetti, 1065,8 MB, destinazione vuota, zero conflitti
e cancellazioni. Rules default scaricate e diff lette: candidato main
differisce solo per appartenenza/privilegi S2 già testati.

Nessun create/link/deploy/sync reale. Il task completo non è chiuso; la
prossima azione è la fase A, con conferma fresca. Il passaggio effettivo del
client richiede fase B e conferma separata.

Il pacchetto coordinato main 4831334 (S2, home, creazione e camp) ha superato
collaudo finale: build, 1510 client, 1975 contratto S2/home, 115 query SDK,
26 backend/rules camp, 8 browser Home e 39 camp, tutti senza salti o errori.
Nessun hosting, deploy rules/Functions o passaggio di bucket eseguito.

## Fase A eseguita, 26 ottobre

Conferma esplicita di Paolo in questa chat: «Confermo, andiamo avanti», in
risposta al piano create/link, rules solo UE e copia di 1196 file (1065,8 MB).
Esecuzione dal Mac mini, clone isolato pulito di main61bf802. Create e link
EXIT0; regione EUROPE-WEST1, ownership verificata, accesso uniforme e
prevenzione accesso pubblico enforced. Rules candidate pubblicate solo nel
nuovo bucket; sorgente live verificato e release default identica a prima.

Sync solo copia, `--max-deletes 0`: 1196 completati, zero errori, checkpoint
per oggetto; nessuna riscrittura Firestore o cancellazione sorgente. Verifica
indipendente: 1196 sorgente e destinazione, zero mancanti/differenze CRC,
dimensioni e metadati, zero oggetti extra; tre download protetti con token206
e senza token403. Hosting e Functions non modificati.

Review del passaggio B: le operazioni galleria devono revocare token e
cancellare entrambe le copie transitorie; cancellare solo UE permette al
sync successivo di ricopiare il file USA. Correzione e test indipendenti in
corso prima del rilascio. L'informativa deve descrivere le copie USA finché
non vengono eliminate nella fase E, che resta separata e non autorizzata.
