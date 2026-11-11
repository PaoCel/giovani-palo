---
id: gugd-rapida-finitura
title: "Rapida e annunciata: finiture rimaste dopo il rilascio"
status: backlog
impact: 2
urgency: 1
effort: M
delivery: deploy
surface: [web]
source: agente
opened: 2026-11-11
started_at:
touched: 2026-11-11
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

Rilievi minori dell'audit spec-codice, del collaudo e della review dell'11 novembre 2026 (task gugd-crea-attivita-rapida, spec docs/ATTIVITA_MODULARI.md «Settimo incremento»), non corretti nel rilascio perché non bloccano. Ognuno va riletto sul codice prima di toccarlo.

Scelte di Paolo:
- «Aggiungi in <mese>» dal calendario precompila il giorno 1 del mese (o oggi): salvando senza toccare il giorno l'attività finisce lì senza avviso (AdminCalendarPage.tsx, getMonthQuickDate). La spec diceva solo «il selettore si apre su quel mese». Alternative: campo vuoto col mese suggerito, oppure avviso.
- Colore di «Annunciata» in admin: pill azzurra su elenco e scheda, ambra nella finestra del mese del calendario.
- Scheda pubblica e /register hanno ancora l'aspetto vecchio, home e catalogo quello del tema 2026: al clic sulla riga cambia tutto (lo copre il task dell'allineamento al tema).

Da correggere:
- Annunciata con la data passata: per lo staff resta «Annunciata» (PlannerCalendar, AdminActivityCard, AdminEventDetailPage col riquadro «Da completare», UnitDashboardPage, UnitActivityPage); la spec la vuole «Conclusa» per tutti.
- Riapri dopo un annullamento onora solo statusBeforeCancel = planned; ogni altra pubblica torna registrations_open (eventsService.setEventCancelled), anche se era chiusa.
- Foglio d'uscita in «Correggi»: titola «Questa attività non è ancora nel calendario», ma l'attività c'è già (QuickActivitySheet).
- «La vedono già ragazzi e famiglie…» nei passi sta in fondo al corpo e scorre via; la spec la voleva sopra i tasti.
- Annullata nata annunciata: la scheda pubblica mostra la card «Iscrizione» con apertura e chiusura vuote (ActivityDetailPage).
- Luogo mancante senza ripiego: registrationPdf.ts, consentPdf.ts («-»), MyActivityDetailPage (riga nascosta), MeDashboardPage (p vuoto se non annunciata); PlannerCalendar e UnitActivityPage non fanno trim.
- Famiglia: FamilyDashboardPage e MyActivityDetailPage mostrano solo lo stato dell'iscrizione, non la pill dell'attività.
- Notte dei Record: senza recordsCloseAt la chiusura ricade su startDate, quindi a mezzanotte con l'ora da definire; «Vai all'iscrizione» non passa da getRegistrationAvailability; MomentsAdminTab precompila un momento alle 00:00.
- Copy: riepilogo del passo 6 («Senza locandina», «manca la descrizione», «Niente in più» contro «Nessuna locandina», «Da scegliere», «Facoltativo»); «Attività non trovata» contro «Attività non disponibile»; bozza col tasto «Apri le iscrizioni» ma titolo «Prima di pubblicare» ed effetto «Pubblicando…»; «La ripubblichi da qui»; «Pubblicata · {titolo}», «Rendi pubblica»; chiavi mai usate in annunciata.ts (oraDaDefinire, dalle duplicate in formatters.ts, rapidaKicker).
- «È nel calendario»: separatori misti («·» e «•»), intervallo «12 mag 2027 - 13 mag 2027»; a 320 il cestino della testata della scheda va da solo su una riga; a 320 il filtro Mese del catalogo è tagliato.
- /admin/events/new rende l'elenco senza aprire il foglio; il ramo «nuova attività» dei 6 passi (createDraft, discardNew) è rimasto senza chiamanti.
- Pagina di firma del genitore (parentPageShared.formatDateRange): usa il fuso del dispositivo, l'email Europe/Rome.

Test che mancano: servizi veri (announceEvent con riconteggio, deleteAnnouncedEvent, restoreAnnouncedEvent, setEventCancelled, publishEvent da planned: il test delle rules riscrive le transazioni a mano); QuickActivitySheet (coda dopo il timeout, Riprova, chiusura durante la scrittura); formatEventCardWhen, getMonthQuickDate.

Non provato nel collaudo: errore di rete e Riprova, conflitto di Elimina, «Annuncia» e «Togli dal catalogo» dal passo 6, cache di 60 s del catalogo, tastiera vera e Safari iOS, famiglia con iscrizione fatta prima di un «Togli dal catalogo».

## Fatto quando

- criteri di accettazione: cosa deve essere vero, osservabile, perché il task
  sia chiuso (e cosa resta fuori, se serve dirlo)

## Da fare

- passi concreti, nell'ordine in cui vanno fatti

## Verificato

Cosa è stato provato davvero e come (configurazione, account, data). Vuoto
finché non c'è niente di provato: "dedotto dal codice" si scrive così.
