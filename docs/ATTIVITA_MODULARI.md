# Attività configurabili senza assistenza tecnica

Requisiti di Paolo del 26 ottobre 2026. Task: `gugd-attivita-modulari`.
Integra [PROGRAMMA_A_MOMENTI.md](PROGRAMMA_A_MOMENTI.md) e
[AUTONOMIA_MULTI_PALO.md](AUTONOMIA_MULTI_PALO.md).

## Decisioni

Un admin di un altro palo deve organizzare un'attività dall'app senza
interventi di Paolo sui dati. La home dei giovani deve diventare un feed:
il lavoro resta in `gugd-home-social`. FSY è una prospettiva futura, non
autorizza a cambiare adesso il modello GU/GD o a copiare dati reali in demo.

- Poche informazioni essenziali per iniziare, salvando una bozza privata.
- Opzioni aggiuntive su richiesta dell'organizzatore, anche subito.
- Sottoattività con propria partecipazione: la serata dei record dentro un
  viaggio è il caso concreto, da integrare senza rompere i link esistenti.
- Comitati con nome, persone e cosa devono fare.
- Gruppi con nome configurabile (gruppi, compagnie, team, squadre) e iscritti.
- Alloggi con condizioni, stanze e posti configurabili dall'app; importare un
  file deve restare facoltativo.
- Gestione anche da un responsabile esplicitamente delegato all'attività.
  La categoria autodichiarata dirigente/accompagnatore non dà permessi.

La richiesta aggiorna M5 della spec Programma: il responsabile può configurare
ciò che gli viene delegato. Il contratto della delega va scritto prima del
codice server. L'accesso ai dati sanitari resta un permesso separato.

## Percorso e ritorni, prima dei mockup

1. Inizia da nome, tipo, date e luogo, verificando cosa richiedono davvero
   validatori e rules per una bozza. Nessuna data o scelta inventata per
   superare la validazione; modulo d'iscrizione e stanze non obbligatori.
2. Dalla gestione della bozza aggiungi solo quello che serve: programma,
   iscrizioni, comitati, gruppi, alloggi.
3. Controlla l'anteprima e cosa manca per pubblicare.
4. Pubblica con un'azione esplicita e un effetto spiegato. Salvare un modulo
   non deve pubblicare implicitamente l'attività.
5. Gestisci dati e assegnazioni dall'app, con salvataggi e conflitti chiari.

| Stato / superficie | Destinazione | Ripensamento ed errore |
| --- | --- | --- |
| Creazione non salvata | Crea bozza e apre la gestione | Uscita con conferma di scarto, campi conservati su errore, retry senza doppioni |
| Bozza salvata | Riapri, completa, anteprima | Esci e ritrova la stessa bozza; nessuna pubblicazione automatica |
| Modulo non attivo | Configura su richiesta | Torna indietro senza dati parziali né pubblicazione |
| Modulo con partecipazioni | Modifica o sospendi | Nessuna cancellazione implicita; riattivazione conserva dati e ricontrolla compatibilità |
| Attività pronta | Anteprima e Pubblica | Torna a modificare; doppio tocco non duplica gli effetti |
| Attività pubblicata | Modifica la configurazione scelta | Un altro salvataggio non ripristina valori vecchi; annullare non cancella firme/iscrizioni |
| Partecipazione interna | Iscrivi, sposta, ritira | Ripristino se posti/scadenze lo permettono, altrimenti motivo comprensibile |
| Comitato / gruppo | Crea, rinomina, assegna | Scarta modifiche non salvate; eliminare un gruppo non elimina gli iscritti |
| Piano stanze | Bozza, assegna, comunica | Salva o scarta all'uscita, ritira comunicazione, ricarica dopo conflitto |
| Delega | Admin sceglie persona e ambito | Revoca applicata dal server; cambio account/attività chiude il contesto precedente |

## Ownership, visibilità e query

Questi sono requisiti; lo schema e le query esatte di ogni modulo devono
essere specificati e provati prima dell'implementazione.

| Dati | Gestisce | Legge |
| --- | --- | --- |
| Attività / bozza | Admin del palo, poi responsabile delegato | Bozza solo organizzatori; pubblicata secondo il pubblico scelto |
| Momenti / partecipazioni | Organizzatori e titolare della partecipazione | Secondo pubblico e stato della spec Programma; nomi solo staff autorizzato |
| Comitati / gruppi | Organizzatori con permesso pertinente | Iscritto vede ciò che lo riguarda; elenchi completi con permesso esplicito |
| Stanze / condizioni / assegnazioni | Oggi solo admin, come ROOM_MANAGEMENT | Piano completo solo autorizzati; partecipante solo la propria stanza |
| Dati sanitari / firme | Permessi esistenti separati | Nessun accesso automatico da delega al programma o ai gruppi |

Query ristrette al palo e all'attività. Nuovi path/campi richiedono rules,
allowlist, indici e cleanup nello stesso blocco. Posti e contatori sono
mantenuti dal server. Nessuna scrittura di collaudo in produzione.

## Blocchi di consegna

1. Completare le verifiche S2 di Persone e appartenenza e preparare il rilascio.
2. Creazione essenziale, bozza ritrovabile, opzioni su richiesta, anteprima e
   pubblicazione esplicita. Primo incremento senza introdurre nuovi dati.
3. Programma con momenti informativi e iscrizioni; adattatore per i record.
4. Comitati con incarichi, gruppi dal nome configurabile, alloggi configurabili;
   estendere i percorsi attuali preservando gli eventi esistenti.
5. Delega al responsabile, recuperi amministrativi S4 e collaudo a due pali.

Home social progettata in parallelo, rilascio subordinato a S2 e al contratto
di visibilità. Pubblicazione libera dei giovani richiede moderazione,
segnalazioni e ritorni specificati; non è implicita nella richiesta di feed.
Ogni deploy o migrazione in produzione richiede conferma fresca di Paolo.

## Criteri di accettazione

Un admin sintetico di un secondo palo, da telefono e senza console/script:

- crea una bozza, la ritrova, configura solo ciò che serve, pubblica dopo
  l'anteprima e corregge una scelta sbagliata;
- aggiunge una serata con posti e partecipazioni e gestisce un ritiro;
- crea un comitato con incarico e una squadra, sposta un iscritto e corregge
  l'assegnazione senza cambiare iscrizione e consensi;
- inserisce stanze e disponibilità, corregge capienza, prepara un piano e
  comunica a ogni partecipante soltanto la sua stanza;
- delega un responsabile: permessi, revoca, account diverso e palo diverso
  verificati anche con chiamate dirette;
- supera vuoto, caricamento, rete assente, doppio tocco, ritorno e conflitto;
  collaudo a 320/390/430 e confronto con mockup dai token reali.

## Verifiche attuali

26 ottobre: recuperati task, spec, editor e documentazione comitati/stanze.
Nel codice l'editor pubblica una nuova attività al salvataggio del modulo
(`AdminEventEditorModal.handleSaveForm`): da sostituire nel blocco 2 con
pubblicazione esplicita. Nessun flusso nuovo di questa spec è già collaudato.
