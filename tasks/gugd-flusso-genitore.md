---
id: gugd-flusso-genitore
title: "Flusso genitore chiaro: chi iscrivi, figlio in contesto, un verbo per accedere"
status: ready
impact: 2
urgency: 2
effort: L
delivery: deploy
surface: [web, rules]
source: paolo
opened: 2026-10-18
started_at:
touched: 2026-10-18
due:
blocked_by: []
branch:
worktree:
session:
stopped_at: "spec e mockup approvati, illustrazioni pronte"
next: fase 1 (parole) con stringhe in un file per schermata
verified: spec dal codice + review Codex; mockup approvati; rules non provate
links: []
done_at:
---

## Contesto

Fase 1 del piano autonomia (2026-10-18). Spec stati/uscite/annullamenti + mockup 390px prima del codice. Niente codice applicativo finché Paolo non approva i mockup.

## Fatto quando

- In produzione le sei fasi di `docs/FLUSSO_GENITORE.md` (o quelle approvate):
  scelta "per chi" come primo passo, account e figlio creati dentro
  l'iscrizione, guardia adulto, glossario applicato, "Annulla l'iscrizione"
  per il genitore, schermata "Iscrizione inviata".
- Nessun `window.confirm` nel flusso di accesso.
- Rules provate nell'emulatore con `parent`, `participant` adulto e
  `unit_leader`; collaudo nel browser di ogni riga di "Utente che sbaglia".
- Fuori: codici di collegamento e "Non ricordo l'account" (S3).

## Da fare

1. ~~Paolo approva mockup e scelte G1-G6~~ (2026-10-18, come consigliate; in più
   illustrazioni proprie e finitura, sezioni "Illustrazioni" e "Finitura").
2. Fasi 1-6 della spec, una alla volta, ognuna rilasciabile. Nella fase 1
   (parole) le stringhe toccate nascono già in un file per schermata, così il
   task `gugd-i18n` parte da lì.
3. Illustrazioni: WebP 2× da `.claude/mockups/flusso-genitore/img/` nel repo
   quando si costruisce la prima schermata che le usa.

## Verificato

2026-10-18: spec scritta leggendo il codice (mappa del flusso di oggi),
rivista da Codex (`gpt-6-astra`, PASS WITH CONCERNS, correzioni recepite;
verificati nel codice: token "Autorizza ora" 60 minuti che invalida il link
della mail, nessun annullamento per il genitore). Mockup renderizzati a 390 px
con i token di `base.css`, approvati da Paolo; set di 6 illustrazioni generato
con Codex (versione campeggio scartata: le attività sono di ogni tipo). "Nessuna rule nuova" dedotto dal codice, non
provato nell'emulatore.
