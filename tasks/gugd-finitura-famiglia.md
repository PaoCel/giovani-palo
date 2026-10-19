---
id: gugd-finitura-famiglia
title: Finitura di Famiglia e via i dialoghi del browser dai percorsi utente
status: in-progress
impact: 2
urgency: 2
effort: M
delivery: merge
surface: [web]
source: agente
opened: 2026-10-19
started_at: 2026-10-19
touched: 2026-10-20
due:
blocked_by: []
branch: task/gugd-finitura-famiglia
worktree: /Users/paolocelestini/Developer/giovani-palo/.claude/worktrees/ecstatic-hodgkin-e6b647
session: dd94c8b9-2344-4ff7-a5b3-500246ad7983
stopped_at: "Codice e test sul branch, review finale in corso"
next: Merge in main dopo la review finale; Paolo sceglie l'etichetta della home (A/B/C) e se i dialoghi admin rientrano
verified: "Collaudo Playwright sul mini contro emulatori auth+firestore+functions+storage, copia separata, 183/183 a 320/390/430 (2026-10-20): Famiglia tasti >= 44 px e badge 13 px, nessuno scroll orizzontale; fogli al posto dei dialoghi (scheda, firma, domande, galleria, nascosti) con dati verificati nel database; nessun dialogo del browser; pagina inerte e Tab nel foglio; cambio di scheda col foglio aperto senza annullamenti. Test: 970 (960 verdi, 9 saltati, accentApostrophes verde in locale), scritti da un altro agente con 67+56 mutazioni. Review Codex gpt-6-astra: BLOCKED x3 con correzioni a ogni giro; quarto giro per quota esaurita su Fable."
links: [docs/FLUSSO_GENITORE.md, "side-session-notes local_554ce4c8/qa-finitura"]
done_at:
---

## Contesto

Collaudo della fase 6 del flusso genitore (G2): Famiglia ora la vedono tutti
gli adulti, e i 6 rossi rimasti sono finiture già esistenti (tasti
`button--small` da 42 px, badge da 12,8 px, etichetta delle sezioni di `/me`
a 10,9 px). La spec (`docs/FLUSSO_GENITORE.md`, "Finitura" e "mai un dialogo
del browser") vale anche fuori dal flusso d'accesso: restano
`window.confirm`/`alert` nella scheda attività, nella firma del genitore, nelle
domande, in galleria e nel lightbox. Solo client, nessun cambio ai dati.

## Fatto quando

- Famiglia a 320/390/430 px: target ≥ 44 px, testo secondario ≥ 13 px, nessuno
  scroll orizzontale (collaudo Playwright sul mini contro emulatori).
- Nessun dialogo del browser in `MyActivityDetailPage`, `ParentConfirmPage`,
  `QuestionsSection`, `ActivityGallery`, `MediaLightbox`: foglio in pagina,
  copy in `src/copy/`.
- Etichetta delle sezioni di `/me`: scelta di Paolo con screenshot prima/dopo.
- Dialoghi delle pagine admin elencati per Paolo (non toccati senza ok).
- Test e review di un altro agente o modello; merge in `main`. Nessun deploy.

## Da fare

- finitura Famiglia (CSS mirato alle schede dei figli);
- fogli al posto dei dialoghi nei cinque file;
- collaudo, test, review, merge.

## Verificato

- Collaudo Playwright sul mini (copia separata, emulatori con functions e
  storage, 9891/8891/5891/9893, vite 5591): 183/183 a 320, 390 e 430 px.
  Script, seed e screenshot in `.claude/qa-finitura/` del worktree, copiati
  nelle note della sessione (`side-session-notes/local_554ce4c8…/qa-finitura`).
- Test unitari: 970, 960 verdi, 9 saltati; `accentApostrophes` verde in
  locale (sul mini git non funziona nel worktree).
- Review: Codex gpt-6-astra BLOCKED tre volte, corretto a ogni giro (P1:
  foglio aperto mentre la scheda cambia; pila degli strati; esiti tardivi;
  errori dietro i modali); quarto giro su un altro modello per quota finita.

## Aperto, per Paolo

- Etichette della home `/me` (10,9 e 11,2 px): A com'è, B 13 px mono
  maiuscolo (consigliata), C 13 px testo normale. Confronto in
  `out/etichetta-confronto.png`.
- Dialoghi del browser rimasti nell'admin: 11 in 4 file
  (`AdminEventDetailPage` 7, `SurveyEditor` 1, `AdminFeedPage` 1,
  `GalleryAdminPanel` 2); stesso giro: errori fuori dai modali di
  `AdminEventDetailPage`, `busyId` bloccato in `AdminSettingsPage`.
- Rilievi fuori perimetro: home `/me` (tasti 42-43 px, chip 12,8 px), scheda
  attività (Condividi 42 px, chip 10,6 px), passi della pagina di firma (11 px).
