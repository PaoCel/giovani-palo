# Flusso genitore chiaro

Stato: **approvata da Paolo il 2026-10-18** (flusso, mockup e scelte G1-G6
come consigliate), con due richieste integrate sotto: illustrazioni proprie e
neutre rispetto al tipo di attività al posto delle icone nelle scelte
("Illustrazioni"), e finitura curata ("Finitura"). Fase 1 del piano autonomia del 2026-10-18,
prima delle fondamenta visive e di S2. Mockup in `.claude/mockups/flusso-genitore/`
(fuori da git), review Codex in `.claude/mockups/flusso-genitore/review/`.
Nessun codice applicativo finché Paolo non approva i mockup.
Compatibile con [IDENTITA_E_ACCESSO.md](IDENTITA_E_ACCESSO.md) (S3): ne anticipa
il "Chi sei?" e il verbo unico, non i codici di collegamento.

## Il problema (flusso di oggi, letto dal codice il 2026-10-18)

- "Iscriviti" non dice per chi. Ogni account nasce `participant`
  (`usersService.ts:157`) e diventa genitore solo con un `window.confirm("Sei un
  genitore e stai iscrivendo un tuo figlio?")` che scatta se la data di nascita è
  di più di 20 anni fa (`AuthAccessPanel.tsx:470`). Chi preme "Annulla" va avanti
  come partecipante e si iscrive lui stesso, senza altri avvisi.
- Il genitore appena creato arriva su "Chi vuoi iscrivere?" → "Nessun figlio
  collegato" → "Vai alla dashboard famiglia" (`ActivityRegisterPage.tsx:802-816`):
  esce dall'attività, aggiunge il figlio in una modale di `/family`, poi deve
  ritrovare l'attività dal catalogo.
- "Genitore" è un ruolo esclusivo: un dirigente o un accompagnatore che ha figli
  non può iscriverli dal suo account (`ParentRoute`, `ProtectedRoute`,
  `ActivityRegisterPage` guarda solo `session.isParent`). Le rules invece non
  lo vietano.
- Il passo "Genitore e sicurezza" chiede nome, email e telefono del genitore
  anche quando compila il genitore (`RegistrationEditor.tsx:1437-1508`); dopo
  l'invio il genitore è rimandato a `/family` senza una schermata che dica cosa
  succede adesso.
- **Il genitore non può annullare l'iscrizione di un figlio**: `cancelRegistration`
  è chiamato solo da `MyActivityDetailPage` (area `/me`, da cui i genitori sono
  respinti) e dall'admin.
- Nessuna guardia su un adulto che si iscrive come giovane: le attività non hanno
  limiti di età, il controllo sul pubblico guarda solo GU/GD (`events.ts:45-66`).
- 8 modi di dire "accedi" e 5 nomi per il figlio. La pagina di accesso si
  intitola "Login o crea un account" e "Crea un account" è un link piccolo.
- "Accedi" nell'intestazione porta a `/login` senza `redirect`
  (`ShellLayout.tsx:431`): chi lo usa da una pagina attività la perde.

## Cosa cambia, in breve

1. **Scelta esplicita all'inizio dell'iscrizione**: "Partecipo io" oppure
   "Iscrivo mio figlio o mia figlia". Primo passo di `/register`, per chiunque
   non sia un account di un minore.
2. **Famiglia indipendente dal ruolo** (scelta G2): qualunque account adulto può
   avere figli e iscriverli. Il ruolo dice solo se l'account partecipa lui
   stesso (`participant`, `unit_leader`, `admin`) o è solo genitore (`parent`).
   Niente più conversioni di ruolo per iscrivere un figlio.
3. **Account genitore creato in contesto**: il passo account è dentro
   l'iscrizione, con l'attività in alto e il percorso "Il tuo account · Tuo
   figlio · Iscrizione". Un account nuovo con `per=figlio` nasce `parent`.
4. **Figlio aggiunto senza uscire**: "Chi iscrivi?" mostra i figli salvati e
   "Aggiungi un figlio o una figlia"; senza figli il modulo di aggiunta è già
   aperto.
5. **Guardia adulto**: se il primo giorno dell'attività avrai almeno 19 anni
   (G1), una scheda nella pagina (mai un dialogo del browser) chiede chi
   partecipa.
6. **Un solo verbo** (G3): "Accedi", "Crea un account", "Esci". Un solo nome
   per il figlio (glossario).
7. **Ogni schermata dice cosa succede dopo**; l'invio finisce su "Iscrizione
   inviata" con il passo successivo; il genitore può annullare l'iscrizione di
   un figlio da Famiglia.
8. **"Chi sei?" per chi crea un account fuori da un'attività**, al posto del
   `window.confirm`: la schermata 2 di S3, con "Accedi" al posto di "Entra".

## Chi vede, chi scrive (una rule nuova, fase 2)

| Operazione | Chi | Rule di oggi |
| --- | --- | --- |
| Creare il proprio profilo `parent` | il titolare | `canCreateOwnUser`: `role in ['participant','parent']` |
| Passare da `parent` a `participant` (genitore che partecipa anche lui) | il titolare | `canUpdateOwnUser`: solo `participant` ↔ `parent` |
| Creare, modificare, cancellare un figlio | il titolare, qualunque ruolo | `users/{uid}/children`: `isSelf` + `validChildPayload` |
| Iscrivere un figlio | il titolare del figlio, qualunque ruolo | `validRegistrationCreate`: `parentUid == auth.uid` + figlio esistente |
| Annullare l'iscrizione di un figlio | il titolare | `validOwnerCancellation` (fase 2): solo `registrationStatus: cancelled` e `updatedAt`, valutata per prima per stare nel limite di 1000 espressioni |
| Elencare le iscrizioni dei figli | il titolare | collection group su `parentUid`, indice già nel repo |

Un dirigente non cambia mai ruolo da solo (le rules non lo permettono e il
flusso non lo chiede). La scelta "per chi" vive nell'URL (`?per=io|figlio`),
mai nei dati. La guardia è solo lato client: un avviso, non un permesso.

Da provare nell'emulatore prima del rilascio, con le query esatte del client e
tre utenti normali (`parent`, `participant` adulto, `unit_leader`): creazione
figlio, iscrizione `child_`, lista collection group, annullamento dal gestore.
Provato nell'emulatore il 2026-10-19 per l'annullamento (`functions/tests/parentCancelRulesEmulator.test.mjs`); il resto della tabella è letto dal codice.

**PWA vecchie**: schema e rules non cambiano, quindi niente si rompe. Un figlio
aggiunto a un account dirigente con la versione nuova non si vede da una PWA
vecchia finché non si aggiorna (bump del service worker al rilascio).

## Navigazione

- Ogni passo è nell'URL: `/activities/:id/register?per=figlio&passo=figlio`.
  Avanti = nuova voce di cronologia; indietro del browser = passo prima.
- Aprire o ricaricare un passo senza i suoi prerequisiti (per esempio
  `passo=figlio` senza account) porta al primo passo valido, mai a un errore.
- `per` vale per quell'attività: si cancella cambiando attività, uscendo
  dall'account o a iscrizione inviata. `sessionStorage` è solo un aiuto, non
  una promessa: dopo la chiusura della PWA si riparte dal primo passo valido.
- Una volta creato l'account, il passo account non torna più: indietro da D
  riporta a B con "Sei entrato come …" ed "Esci".

## Schermate, uscite e annullamenti

Notazione: → dove porta; ↩ come si annulla o si torna indietro; = cosa resta.

### A. Pagina attività

- Pulsante: "Iscriviti" (non entrato, ospite, ragazzo); "Iscrivi tuo figlio o
  tua figlia" (account `parent`); "La tua scheda" (ragazzo già iscritto).
  Sotto, per chi non è entrato: "Sei un genitore? Iscrivi tuo figlio o tua
  figlia da qui." → `/register?per=figlio`.
- Account con figli già iscritti: sotto il pulsante una riga per figlio,
  "Giulia è iscritta · Apri" (→ la sua iscrizione in Famiglia).
- "Accedi" nell'intestazione porta `redirect` alla pagina corrente.

### B. Chi partecipa?

Quando: sempre, tranne per un account di un minore (data di nascita sotto i 18
anni), che va dritto a F con "Partecipi tu: Marco Rossi · Non sei Marco? Cambia
account". Se sei entrato, in alto "Sei entrato come Paola Rossi · Esci".

- "Partecipo io" → C se non entrato; D se il profilo è incompleto o l'account
  è `parent` (il genitore che partecipa come accompagnatore completa i suoi
  dati); altrimenti F.
- "Iscrivo mio figlio o mia figlia" → C (versione genitore) se non entrato,
  altrimenti E. Per un account di un minore questa scelta non compare.
- ↩ freccia → pagina attività. Niente scritto.
- = la scelta si legge in alto in ogni passo: "Per: te · Cambia" oppure "Per:
  un figlio o una figlia · Cambia". "Cambia" riporta qui, in ogni momento
  prima dell'invio.

### C. Il tuo account (solo se non entrato)

Due schede alla pari, "Crea un account" (preselezionata) e "Accedi"; "Continua
con Google" vale per entrambe. Versione genitore: "Il tuo account da genitore"
e "Per iscriverlo non serve un suo account." Versione io: "Il tuo account" e
"Ti serve per seguire l'iscrizione e ritrovarla la prossima volta."

- → account nuovo: profilo creato `parent` (`per=figlio`) o `participant`
  (`per=io`), poi D.
- → accesso a un account esistente: tabella "Account già esistente".
- Google chiuso o annullato: si resta su C, nessun messaggio d'errore.
- "Continua senza account": solo per `per=io` e solo se l'attività accetta
  ospiti (scelta G6). Crearsi l'account subito dopo collega l'iscrizione appena
  fatta solo con "Crea un account" o Google nuovo (stesso uid, come oggi);
  accedere a un account esistente la lascia sul telefono come ospite.
- ↩ freccia → B, con la scelta di prima evidenziata.

### D. I tuoi dati

Nessuna scrittura sul profilo finché non premi "Continua" in fondo al passo:
le scelte della guardia e i cambi di percorso restano in memoria.

- Io: Nome, Cognome, Data di nascita, poi Organizzazione e Unità (come oggi).
  Al "Continua" della data di nascita, con almeno 19 anni il primo giorno
  dell'attività → G.
- Genitore: Nome, Cognome, Comune, Unità. Riga "Hai meno di 18 anni? Sei tu a
  partecipare" → D-io con nome e cognome già scritti.
- → "Continua" salva il profilo e va a E (genitore) o F (io).
- ↩ freccia → B (account già creato: "Sei entrato come …" ed "Esci"). "Esci"
  non cancella l'account appena creato: lo dice la riga sotto ("Il tuo account
  resta: lo ritrovi quando accedi di nuovo").

### E. Chi iscrivi?

In alto: "Sei entrato come Paola Rossi · Cambia account". Serve sul telefono di
famiglia: chi sta usando l'account si legge prima di scegliere.

- Una scheda per figlio con età e unità. Stati: selezionabile; "Già iscritto ·
  Apri" (stesso figlio, iscrizione non annullata: → la sua iscrizione, mai un
  doppione); "Attività solo per Giovani Donne" (non selezionabile, con il
  motivo). Doppioni che il sistema non riconosce (iscrizione fatta dall'altro
  genitore, da un admin, o dal figlio col suo account) li vede lo staff, come
  oggi.
- Avvisi morbidi: meno di 11 anni il primo giorno ("Le attività GU e GD sono
  dagli 11 anni: controlla la data"); 19 anni o più ("Marco è maggiorenne: può
  iscriversi da solo con il suo account").
- "Aggiungi un figlio o una figlia" apre un foglio: Nome, Cognome, Data di
  nascita, Gruppo, Unità. "Salva" lo scrive nel tuo account e lo seleziona;
  "Annulla" e la X chiudono senza salvare ("Chiudi senza salvare"). Il pulsante
  si blocca durante il salvataggio (niente doppioni col doppio tocco).
- Senza figli: il modulo di aggiunta è già aperto nella pagina. "Salva e
  continua" → F; indietro → B.
- Matita sulla scheda → stesso foglio in modifica; "Annulla" rimette i dati di
  prima. Le iscrizioni già inviate restano con i dati di quando sono partite.
  Un figlio si cancella da Famiglia, solo se non ha iscrizioni attive (oggi).
- → "Continua con Marco" → F.

### F. Modulo d'iscrizione

- In alto: "Stai iscrivendo Marco Rossi · Cambia" (→ E) oppure "Partecipi tu:
  Paola Rossi".
- Bozza in memoria per account, attività e figlio: tornare da Marco a Giulia e
  di nuovo a Marco ritrova le risposte di Marco. I dati sanitari di un figlio
  non passano mai a un altro. Cambio account o uscita: bozze cancellate.
- Passo "Genitore e sicurezza" quando compila un account con figli: nome,
  email e telefono presi dal tuo account, modificabili, con "Abbiamo inserito i
  dati del tuo account: controllali."
- Uscire con risposte non inviate (freccia dal primo passo, "Cambia", link
  fuori): foglio "Esci dall'iscrizione? Le risposte non inviate si perdono."
  con "Continua a compilare" (primo) ed "Esci".
- Invio senza rete o con errore: il pulsante torna attivo, le risposte restano,
  messaggio in italiano. Invio riuscito ma risposta persa: alla riapertura E
  mostra "Già iscritto", non un secondo modulo.

### G. Guardia adulto (dentro D, o in cima a F per un partecipante già entrato)

"Attività per i giovani. Il 24 aprile 2027 avrai 47 anni. Chi partecipa?"

| Opzione | Dove porta | Come si annulla |
| --- | --- | --- |
| Iscrivo mio figlio o mia figlia | account nuovo: D-genitore con nome e cognome già scritti, niente salvato; account esistente: E, l'account resta com'è | "Cambia" in alto riporta a B, e "Partecipo io" ritrova data e scelte di prima |
| Partecipo come dirigente o accompagnatore | al passo Organizzazione è già scelto Dirigente | si tocca un'altra pill; scegliendo Giovane uomo o Giovane donna resta sotto la riga "Il 24 aprile 2027 avrai 47 anni" |
| Ho sbagliato la data | chiude la scheda, cursore sulla data | niente salvato |
| Confermo, partecipo io come giovane (link) | prosegue | niente è inviato: "Cambia" riporta a B |

### H. Iscrizione inviata

- Account con figli, autorizzazione richiesta dall'attività: "Iscrizione
  inviata · Marco Rossi", stato "In attesa della tua autorizzazione", pulsante
  "Autorizza ora" (→ `/parent-confirm/:token` di oggi, G5).
  "Cosa succede dopo": i dirigenti vedono già l'iscrizione; autorizzi tu, ora
  o dal link che ti abbiamo mandato (vale 14 giorni); gli aggiornamenti sono in
  Famiglia. Poi "Iscrivi un altro figlio" (→ E) e "Vai alla famiglia".
- **Token**: "Autorizza ora" emette un link di 60 minuti e invalida quello della
  mail (`parentAuthorizationIssueOwnToken`). Se la firma resta a metà, la pagina
  di firma e Famiglia dicono "Riprendi da «Autorizza ora»": è l'unico link
  valido. La mail non è più una strada dopo il primo "Autorizza ora".
- Autorizzazione non richiesta: senza il blocco "Autorizza ora".
- Io: con autorizzazione, "Abbiamo scritto al tuo genitore a …" solo dopo che
  l'invio della mail è confermato; se è fallito, "La mail non è partita:
  controlla l'indirizzo" con "Modifica".
- ↩ "Hai sbagliato qualcosa? Modifica o annulla dalla tua scheda" (io) o "da
  Famiglia" (genitore). **Nuovo**: "Annulla l'iscrizione" sulla riga del figlio
  in Famiglia, stessa scrittura di `/me` (`registrationStatus: cancelled`), con un foglio di conferma. Annullare
  conserva storico e consensi firmati (come oggi), non cancella; per iscriverlo
  di nuovo si torna in E, se le iscrizioni sono ancora aperte.

### I. Accedi (`/login`, fuori da un'attività)

Due schede alla pari "Accedi" (preselezionata) e "Crea un account". Già entrato:
"Sei entrato come Paola Rossi" con "Vai alla tua pagina" ed "Esci e cambia
account", mai un redirect muto. Dopo un account nuovo → "Chi sei?" (S3): "Sono
un ragazzo o una ragazza", "Sono un genitore", "Sono un dirigente o un
accompagnatore" (nessun permesso: il ruolo lo dà un admin). "Chi sei?" non ha
freccia indietro (l'account esiste già): in alto "Esci". La scelta si cambia
dopo dal profilo.

## Account già esistente o sbagliato

| Chi è entrato | Ha scelto | Cosa vede | Uscite |
| --- | --- | --- | --- |
| Adulto con qualunque ruolo | Iscrivo mio figlio | E con "Sei entrato come …" | "Cambia account" |
| Genitore (`parent`) | Partecipo io | D-io: completa i tuoi dati | al salvataggio diventa `participant`, i figli restano; "Cambia" → B |
| Dirigente | Partecipo io e poi un figlio | F per sé, poi H → "Iscrivi un figlio" → E | ruolo, unità e accesso staff non cambiano |
| Ragazzo (meno di 18 anni) | arriva dalla riga "Sei un genitore?" | "Sei entrato come Marco Rossi. Per iscrivere un figlio serve l'account di un genitore." | "Esci e accedi come genitore" (dopo il logout C con `per=figlio`, bozze di Marco cancellate) · "Iscrivi Marco con il suo account" (→ F) |
| Ospite (sessione anonima) | Partecipo io | C | come "Continua senza account" sopra |

Non si trasforma mai l'account di un minore in account genitore, né un
dirigente in qualcos'altro.

## Matrice stati × superfici

| Stato | Pagina attività | Iscrizione | Famiglia / profilo | Come si annulla |
| --- | --- | --- | --- | --- |
| Scelta "per chi" fatta, nessun account | "Iscriviti" | "Per: … · Cambia" | — | "Cambia" o indietro → B, niente scritto |
| Account nuovo, profilo non ancora salvato | "Iscriviti" | D | — | tutto in memoria; "Esci" lascia l'account vuoto (lo dice) |
| Profilo salvato `parent` | "Iscrivi tuo figlio…" | E | "Passa ad account partecipante" (oggi) | "Partecipo io" da B completa i dati e passa a `participant`, figli intatti |
| Figlio aggiunto | "Iscrivi tuo figlio…" | scheda selezionata in E | scheda in Famiglia | matita in E; cancellazione in Famiglia se senza iscrizioni attive |
| Iscrizione inviata, autorizzazione da dare | riga "Marco è iscritto · Apri" | H | riga con "Autorizza ora" e "Annulla l'iscrizione" (nuovo) | "Annulla l'iscrizione" in Famiglia |
| Firma aperta e lasciata a metà | come sopra | — | "Riprendi da «Autorizza ora»" | nuovo "Autorizza ora": link nuovo, il vecchio non vale |
| Iscrizione annullata | "Iscrivi tuo figlio…" | E: scheda di nuovo selezionabile | come oggi (resta solo se ha consensi firmati) | nuova iscrizione da E, se aperte |

## Utente che sbaglia (giocato sul flusso)

| Caso | Cosa succede |
| --- | --- |
| Il genitore tocca "Partecipo io" e scrive la sua data | G: "Iscrivo mio figlio" → D-genitore, niente salvato |
| Il genitore tocca "Partecipo io" e scrive i dati del figlio nel proprio account | non rilevabile. Mitigazione: titolo di D "Sei tu a partecipare". S3 non lo ripara da solo (account, iscrizione `user_` e consensi restano intrecciati): è un caso per lo staff, fuori da questa fase |
| Un ragazzo tocca "Iscrivo mio figlio" su un account nuovo | D-genitore: "Hai meno di 18 anni? Sei tu a partecipare". Senza data del genitore, nessun altro controllo: rischio accettato |
| Ragazzo sul telefono del genitore | B ed E mostrano "Sei entrato come Paola Rossi"; per iscriversi lui "Cambia account" |
| Genitore sul telefono del ragazzo | tabella sopra: account del ragazzo mai convertito |
| Chiude l'app dopo aver creato l'account | riaprendo l'attività: primo passo valido (B con "Sei entrato come …") |
| Google con l'account sbagliato | B o E mostrano chi sei: "Esci" o "Cambia account" |
| Due figli | dopo H, "Iscrivi un altro figlio" → E con il primo "Già iscritto"; bozze separate |
| Doppio tocco su "Salva" o "Invia" | pulsante bloccato durante la scrittura |
| 18 anni compiuti, ancora nei giovani | la guardia non scatta (soglia 19) |
| Data di nascita mancante o assurda | il campo non accetta date future né prima del 1920; vuoto = "Continua" disattivo |
| Genitore adulto che vuole partecipare lui | "Partecipo io" da B |

## Parole (glossario per tutte le schermate toccate)

| Concetto | Si scrive | Non più |
| --- | --- | --- |
| entrare con un account | **Accedi** | Login, Fai login, Vai al login, Login / Account, Entra, Entra nell'app, autenticazione |
| registrarsi | **Crea un account** | Crea account, Registrati con Google |
| Google | **Continua con Google** (in tutte e due le schede) | Accedi con Google, Registrati con Google |
| uscire | **Esci**; "Cambia account" quando serve rientrare con un altro | — |
| il figlio, nome non noto | **figlio o figlia** ("Iscrivo mio figlio o mia figlia", "Per: un figlio o una figlia") | figlio/a, ragazzo/a, minore |
| il figlio, nome noto | **il nome** ("Stai iscrivendo Marco Rossi") | — |
| più figli | **i tuoi figli** | — |
| chi partecipa, lato staff | partecipante (invariato) | — |
| "minore" | solo nei testi legali e nell'autorizzazione | nelle schermate del genitore |

Il progetto non ha un catalogo i18n: ogni sostituzione si fa in tutti i file
che usano la parola vecchia, non solo nelle schermate nuove.

## Illustrazioni

Le scelte "Chi partecipa?" e "Chi sei?", la guardia e "Iscrizione inviata"
usano un set di illustrazioni
nostre, non icone di libreria. Le attività sono di ogni tipo (campeggio,
viaggio al tempio, serata da ballo, servizio): le illustrazioni mostrano
**persone, non un'attività**, su uno sfondo astratto.

| File | Soggetto | Dove |
| --- | --- | --- |
| `io` | una ragazza di circa 15 anni che cammina in avanti | B "Partecipo io" |
| `giovani` | un ragazzo e una ragazza adolescenti | "Chi sei?" |
| `genitore` | mamma con la mano sulla spalla del figlio | B, "Chi sei?", guardia; H se il figlio è Giovane uomo |
| `genitore-figlia` | papà con la mano sulla spalla della figlia | H (e ogni punto col figlio noto) se è Giovane donna |
| `dirigente` | un dirigente con badge e cartellina | "Chi sei?", guardia, B per un dirigente |
| `inviata` | una porta aperta da cui esce luce | H per "Partecipo io" |

Mamma o papà non lo sappiamo e non lo chiediamo (Paolo, 2026-10-18: troppo
per un'illustrazione). Il gruppo del figlio sì: dove il figlio è noto,
l'illustrazione lo segue; le due varianti mostrano una mamma e un papà. I
ragazzi devono sembrare ragazzi (felpa, coda, proporzioni da adolescente):
nella prima stesura la ragazza di "Partecipo io" era identica alla mamma e le
due scelte si confondevano.

Stile: carta ritagliata a strati, palette del progetto (blu `#1b3f67`,
`#235d90`, sabbia `#b58a50`, crema), finestra ad arco, niente volti. Generate
con Codex come set (la prima fa da riferimento di stile alle altre), bordo
dell'arco rifinito con una maschera uguale per tutte. Originali e prompt fuori
da git (`.claude/mockups/flusso-genitore/assets/`); nel repo solo WebP a 2× la
misura mostrata. Le icone restano solo per i controlli (indietro, chiudi,
frecce, campi). Sotto i 38 px non si usano: a 26 px non si leggono più (provato
nella riga per il genitore della pagina attività, tolta).

## Finitura

Requisiti misurabili, collaudati sul dispositivo prima di dire fatto:

- Testo di lettura e campi a **16 px** (sotto, Safari iOS ingrandisce la
  pagina al focus); testo secondario mai sotto 13 px, contrasto AA; titoli
  Fraunces 27-32 px; target tattili ≥ 44 px.
- **Un solo contenitore di scorrimento** per pagina. Il piede con la CTA è
  fisso, rispetta `env(safe-area-inset-bottom)`, e il contenuto ha sotto lo
  spazio del piede: l'ultimo campo non finisce mai dietro il pulsante.
- **Tastiera aperta**: il campo attivo resta visibile sopra la CTA
  (`visualViewport`), la CTA non salta a metà schermo.
- **Fogli dal basso**: altezza massima 90 `dvh`, scroll interno con
  `overscroll-behavior: contain`, pagina sotto bloccata, chiusura col
  trascinamento uguale a "Annulla".
- **Cambio di passo**: il passo nuovo parte dall'alto con il focus sul titolo;
  indietro ritrova la posizione di prima. Transizione breve (≤ 200 ms), niente
  con `prefers-reduced-motion`.
- `dvh` al posto di `vh`; nessuno scroll orizzontale da 320 px in su; immagini
  con dimensioni dichiarate (niente salti mentre caricano).
- Collaudo a 320, 390 e 430 px, con la tastiera aperta, in Safari nel
  simulatore iOS sul Mac mini e in Chrome con emulazione Android; confronto
  affiancato mockup/schermo alla stessa scala per ogni schermata.

## Scelte (approvate il 2026-10-18 come consigliate)

| Id | Domanda | Opzioni | Consiglio |
| --- | --- | --- | --- |
| G1 | Soglia della guardia adulto | a) 19 anni compiuti il primo giorno dell'attività; b) 18; c) 20 come oggi | **a**: a 18 anni si può essere ancora nei giovani (Codex d'accordo) |
| G2 | Famiglia e ruolo | a) i figli si aggiungono a qualunque account adulto, il ruolo resta quello che è; b) solo l'account `parent` iscrive figli, come oggi | **a**: è il modello delle rules, evita ogni conversione di ruolo e permette al dirigente-genitore di iscrivere sé e i figli (Codex d'accordo). Costa rotte, home e ricerche in `/me` e `/unit`, non le rules |
| G3 | Verbo unico | a) Accedi; b) Entra (i mockup S3 usano "Entra") | **a**: è già il più usato; S3 si aggiorna |
| G5 | Autorizzazione quando iscrive il genitore | a) "Autorizza ora" in H, stessa pagina di firma di oggi; b) firma dentro il modulo | **a**: non tocca il flusso consensi di S1 |
| G6 | Iscrivere un figlio senza account | a) non offerto: per un figlio serve l'account del genitore, "Continua senza account" solo per "Partecipo io"; b) offerto come oggi | **a**: un'iscrizione ospite di un figlio non arriva mai in Famiglia ed è la radice delle iscrizioni orfane di S3 |

## Fasi (ognuna rilasciabile da sola)

1. Parole: glossario su tutte le schermate, pagina Accedi con le due schede,
   `redirect` sull'"Accedi" dell'intestazione, I con "Sei entrato come".
   **In produzione dal 2026-10-19**: testi in `src/copy/`, "Sei già dentro"
   come nel mockup, "Accedi" anche nell'intestazione pubblica (prima mancava),
   nascosto su `/login`.
2. "Annulla l'iscrizione" per il genitore in Famiglia (manca oggi) e messaggio
   "Riprendi da «Autorizza ora»".
   **In produzione dal 2026-10-19**. Tre cose
   trovate costruendola:
   - l'annullamento di un'iscrizione figlio superava il limite di 1000
     espressioni delle rules (permission-denied nell'emulatore): nuovo ramo
     `validOwnerCancellation`, valutato per primo, che concede solo lo stato
     `cancelled` e `updatedAt` al titolare;
   - un link ancora valido rimetteva in `confirmed` (o `rejected_by_parent`)
     un'iscrizione annullata, anche da `/me` o dall'admin: conferma, rifiuto e
     contesto della pagina di firma ora la rifiutano;
   - nulla distingueva il link di "Autorizza ora" da quello della mail:
     `parentAuthorization.selfTokenIssuedAt` (lo scrive "Autorizza ora", lo
     azzera ogni nuova mail) fa comparire "Riprendi da «Autorizza ora»".
3. B e C dentro l'iscrizione, account nuovo `parent` con `per=figlio`, via il
   `window.confirm`, "Chi sei?" fuori dall'attività.
   **In produzione dal 2026-10-19** (solo hosting, service worker v23). Passi nell'URL
   (`src/utils/registerFlow.ts`), D come "I tuoi dati" condiviso con Accedi,
   A con "Iscriviti" anche dove serve l'account e la riga "Sei un genitore?".
   Fino alle fasi 5 e 6 due schede dicono quale account serve, senza
   convertire nessun ruolo: "Serve l'account di un genitore" (figlio scelto da
   un ragazzo, da un adulto partecipante o da un dirigente: "Cambia account" o
   "Partecipo io"; per il ragazzo con "Esci e accedi come genitore" e
   "Iscrivi Marco con il suo account") e "Questo account iscrive i tuoi figli"
   ("Partecipo io" da un genitore già completo). Trovato costruendola:
   - entrare con Google da "Iscrivo mio figlio" trasformava in genitore
     qualunque account esistente, anche quello di un ragazzo: il tipo
     scelto vale solo per un account appena creato; e all'accesso la
     seconda lettura del profilo poteva rimettere il ruolo di prima
     (`ensureProfileForUser` non riscrive più `role`);
   - il profilo proponeva come nome la parte dell'email prima della @;
   - gli errori di accesso arrivavano in inglese ("Firebase: Error
     (auth/…)") e la finestra di Google chiusa mostrava un errore: ora un
     testo per codice (`src/utils/authErrors.ts`) e nessun messaggio;
   - altri tre dialoghi del browser nello stesso flusso (cambio di tipo di
     account in `/me/profile` e `/family/profile`, "Iscrivi un'altra persona"
     da ospite) sono fogli nella pagina; `/me/profile` non offre più
     "Passa ad account genitore" all'account di un minore;
   - il grigio dei testi secondari (`--muted`) era 4,2:1 sullo sfondo della
     pagina: scurito a 4,7:1 (AA);
   - le uscite nuove dal modulo ("Cambia", freccia, "Esci") buttavano le
     risposte non inviate: il foglio "Esci dall'iscrizione?" di F c'è già,
     anche per l'indietro del browser dentro l'app (non per chi chiude la
     scheda);
   - "Gestisci" in Famiglia (link con il solo `child`) porta al modulo del
     figlio anche senza `per`: con "Chi partecipa?" come primo passo il
     figlio si perdeva.
   Nessuna rule nuova: le scritture del profilo provate nell'emulatore con
   le chiamate del client (`functions/tests/accountTypeRulesEmulator.test.mjs`).
4. E con foglio "Aggiungi", modulo aperto senza figli, prefill del passo
   genitore, bozze per figlio, H.
5. Guardia G e tabella "Account già esistente".
6. G2 = a: famiglia su ogni account adulto (rotte, home `/me` e `/unit`,
   ricerche), collaudo con un dirigente.

Test (da un agente diverso da chi scrive il codice): unitari su `per`, primo
passo valido per ogni tipo di account, guardia (soglia, data dell'attività,
pill), chiave delle bozze; rules nell'emulatore per le operazioni di "Chi vede,
chi scrive" con i tre ruoli; collaudo nel browser con un account nuovo per
percorso, giocando "Utente che sbaglia".
