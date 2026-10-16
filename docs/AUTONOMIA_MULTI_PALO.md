# Autonomia multi-palo

Stato: **approvata da Paolo il 2026-10-16**, già corretta dopo la review
di Codex. Roadmap:
[ROADMAP_PALI.md](ROADMAP_PALI.md) (sessione S4). Base tecnica già fatta:
[MULTI_PALO_DEMO.md](MULTI_PALO_DEMO.md) (ambienti, `create-stake.mjs`, rules
`stakeId` del 2026-10-10).

## Cosa richiede ancora Paolo, la console o uno script

| Operazione | Oggi | Chi dovrebbe farla |
| --- | --- | --- |
| Creare un palo e le prime unità | `tools/create-stake.mjs` (Admin SDK) | super admin, dall'app |
| Primo admin di un palo | stesso script, link per la password stampato a terminale | super admin, con invito via link |
| Dare il ruolo `unit_leader` | console (le rules lo permetterebbero all'admin, `canAdminAssignUserRole` r.1049, ma la UI offre solo "Assegna admin") | admin del palo |
| Togliere il ruolo admin o dirigente | console | admin del palo, mai sé stesso né l'ultimo admin |
| Cambiare unità a un utente | nessuno tranne l'Admin SDK (`canUpdateOwnUser` blocca i ruoli staff, `canAdminAssignUserRole` vieta `unitId`) | admin del palo |
| Iscrizione a mano (`manual_`) | solo Admin SDK: nessuna UI la crea (13 sul viaggio, 8 adulti) | admin, dalla tab Iscritti |
| Idee dello staff della Notte dei Record | `seedRecordNightIdeas.js`, `replaceRecordNightIdeas.js` | admin: "Nuovo record" con la spunta esiste già; manca "Copia da un'altra attività" |
| Utenti con `stakeId` vuoto | invisibili a ogni admin (`isStakeAdmin('')` è falso) | coda di appartenenza (blocco 2): ogni utente nuovo ha un palo scelto |
| Mittente e contatto nelle email | globali (`functions/lib/config.js`: `noreply@`, `supporto@gugditalia.it`, nome mittente fisso) | per palo: nome mittente e contatto presi da `stakes/{id}` |
| Domini autorizzati di Auth | console; c'è ancora un canale di anteprima della Notte dei Record fra i domini autorizzati | Paolo, una tantum: togliere il dominio di anteprima |

Già autonomo oggi: unità (crea, rinomina con propagazione, disattiva), profilo
del palo (testi, contatti, presidenze, immagine d'esempio del consenso), staff
del campeggio e della Notte dei Record, attività, galleria (automatica),
stanze, sondaggi.

Nota sulle unità: la UI crea gli id con `slugify(nome)`, lo script con
`<palo>-<slug>`. Nel percorso Firestore non collidono (stanno sotto
`stakes/{s}/units`), ma `users.unitId` e `registrations.unitId` sono uguali fra
pali: ogni query per `unitId` deve filtrare anche `stakeId` (lezione del
2026-10-06). Allineare la UI a `<palo>-<slug>` costa poco e toglie la trappola;
gli id di Roma Est restano come sono.

## Proposta

### 1. Pagina "Persone" del palo (admin)

`/admin/persone`, sostituisce la modale "Assegna admin".

- Tab: **Richieste** (coda del blocco 2, con badge), **Membri**, **Staff**
  (admin e dirigenti), **Rimossi**.
- Riga: nome, unità, ruolo, età (anno), stato appartenenza, attività recenti.
- Azioni su una persona (callable `stakePeople`, mai scrittura client):
  - ruolo: partecipante / genitore / dirigente di unità / admin;
  - unità (la scrittura passa dal server perché le rules la vietano a tutti i
    client, ed è giusto così);
  - rimuovi dal palo / riattiva;
  - "Mostra codice" se ha un'iscrizione senza account (blocco 1).
- Guardie: un admin non si toglie il ruolo da solo, il palo non resta mai senza
  admin, `super_admin` non si tocca da qui. Ogni cambio scrive
  `stakes/{s}/auditLog` (chi, cosa, prima, dopo) e mostra il toast "Annulla",
  che controlla la versione corrente prima di ripristinare e finisce anche lui
  nel log.
- **Le guardie valgono solo se è l'unica strada**: oggi un admin può riscrivere
  il ruolo di un altro direttamente da client (`canAdminAssignUserRole`,
  `firestore.rules:1049`), senza guardia sull'ultimo admin e senza log. In S4
  quel ramo si chiude (cambio ruolo solo via `stakePeople`), dopo aver
  controllato che nessuna build in uso lo chiami ancora (oggi lo usa solo la
  modale "Assegna admin", che viene sostituita nello stesso deploy).
- Ruolo e appartenenza cambiano insieme: togliere qualcuno dal palo gli toglie
  anche il ruolo staff nella stessa transazione, e `members.staffRole` resta la
  copia che legge Storage.

### 2. Inviti dello staff

"Invita un dirigente" / "Invita un admin": l'admin sceglie ruolo e unità,
scrive nome e cognome di chi invita, e ottiene un link monouso con token lungo
valido 7 giorni da mandare (WhatsApp, mail sua). Chi lo apre entra o crea
l'account con il primo passo normale e alla fine accetta: "Diventi dirigente del
Rione Centro nel Palo di Roma Est". Il link può essere inoltrato, quindi
accettare **non basta**: l'admin riceve "Mario R. (m***@gmail.com) ha accettato
l'invito: confermi?" e solo la sua conferma scrive ruolo, unità e appartenenza.
Prima della conferma l'invitato è un membro in attesa, senza privilegi. La
pagina dell'invito mostra palo e unità solo dopo il login. Stessa tecnica dei codici di
collegamento (hash, TTL, monouso). L'admin vede gli inviti aperti e li annulla.

### 3. Iscrizione a mano dall'app

Tab Iscritti, "Aggiungi a mano": nome, cognome, unità, data di nascita,
categoria, note, email del genitore facoltativa. Crea `manual_<id>` con
`createdBy`, nessun consenso chiesto in automatico; se l'email del genitore c'è,
"Chiedi l'autorizzazione" usa il flusso esistente. Subito dopo il salvataggio:
"Mostra codice" per collegarla all'account del ragazzo (blocco 1). Le rules
permettono già la creazione all'admin (r.1376); manca la UI.

### 4. Console pali (super admin)

`/super/pali`, solo `role == 'super_admin'` (Paolo):

- elenco pali con numeri (membri, attività, ultimo accesso admin);
- "Nuovo palo": nome, slug, unità iniziali (righe), email del primo admin →
  callable `stakeProvision` (stessa logica di `tools/lib/stakes.mjs`, che resta
  per gli emulatori e lo staging) → link d'invito come al punto 2;
- disattiva palo (`isActive: false`: sparisce dal selettore, i dati restano).

Il primo admin, dopo l'invito, trova in dashboard una lista "Primi passi":
unità, dirigenti invitati, profilo del palo (contatti per le email), prima
attività. Ogni voce si spunta da sola quando i dati esistono.

### 5. Email per palo

`stakes/{id}.emailSenderName` (es. "Giovani Palo di Napoli") e
`supportContact` già esistente diventano mittente visualizzato e reply-to delle
mail ai genitori di quel palo. L'indirizzo d'invio resta
`noreply@gugditalia.it` (dominio verificato su Brevo). Il reply-to si valida
come un indirizzo singolo e si conferma con una mail di prova prima di usarlo.

### 6. Recupero amministrativo

Se l'unico admin di un palo perde l'account, il super admin lo rimette dalla
console pali (invito nuovo + conferma). Ogni intervento del super admin su un
palo finisce nel log di quel palo, visibile ai suoi admin.

## Chi vede, chi scrive

| Azione | Membro | Dirigente di unità | Admin del palo | Super admin |
| --- | --- | --- | --- | --- |
| Vedere Persone del proprio palo | no | membri e richieste della propria unità, sola lettura degli altri nomi (come oggi) | sì | sì, ogni palo |
| Approvare richieste | no | della propria unità | sì | sì |
| Cambiare ruolo o unità | no | no | sì, nel proprio palo, con le guardie | sì |
| Invitare staff | no | no (scelta P3) | sì | sì |
| Iscrizione a mano | no | no | sì | sì |
| Creare o disattivare un palo | no | no | no | sì |
| `auditLog` | no | no | legge | legge |

Tutte le scritture passano da callable con Admin SDK: le rules dei profili
restano come sono (nessun ramo nuovo nel budget), `stakes/{s}/auditLog`,
`stakes/{s}/invites` e i documenti di provisioning sono `if false` per i client
tranne la lettura admin del log e degli inviti.

## Stati e ritorni

| Azione | Come si annulla |
| --- | --- |
| Cambio ruolo o unità | toast "Annulla" (ripristina il valore di prima); poi dal log "Ripristina" sulla riga |
| Rimozione dal palo | "Riattiva" dai Rimossi, con ruolo e unità di prima |
| Invito mandato | "Annulla invito" finché non è usato; usato = si cambia il ruolo dalla pagina Persone |
| Iscrizione a mano | si annulla come le altre iscrizioni (stato `cancelled`, riattivabile) |
| Palo disattivato | "Riattiva" in console; nessun dato cancellato |

## Utente che sbaglia

| Caso | Comportamento |
| --- | --- |
| L'admin promuove la persona sbagliata | toast "Annulla", log |
| L'admin manda l'invito alla persona sbagliata | annulla l'invito; se già usato, cambia il ruolo |
| Chi riceve l'invito entra con l'account sbagliato | la schermata finale mostra "Sei entrato come …": "Cambia account" prima di accettare |
| Il link d'invito viene inoltrato in un gruppo | monouso: il primo che lo usa lo consuma, l'admin lo vede nell'elenco ("Usato da Mario R.") e può revocare |
| L'unico admin perde l'accesso | il super admin lo rimette dalla console pali |

## Scelte per Paolo

| Id | Domanda | Opzioni | Consiglio |
| --- | --- | --- | --- |
| P1 | Chi crea un palo | a) super admin dall'app con invito al primo admin; b) resta lo script | **a** |
| P2 | Ruolo "dirigente" chiesto in registrazione | a) non dà permessi: arriva come partecipante adulto, l'admin assegna; b) richiesta di ruolo nella coda | **a** |
| P3 | I dirigenti di unità possono invitare altri dirigenti | a) no; b) sì, per la propria unità | **a** |
| P4 | Mittente email per palo | a) nome e reply-to per palo, indirizzo unico; b) dominio per palo | **a** |
