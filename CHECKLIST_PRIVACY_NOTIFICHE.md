# Checklist privacy, notifiche e consensi

Queste sono le attivita da fare manualmente fuori dal codice o dentro la console Firebase/admin.

## 1. Pubblicare le regole Firebase aggiornate

- Deploy `firestore.rules`.
- Deploy `storage.rules`.
- Verifica subito dopo il deploy:
  - un admin puo vedere gli alert admin;
  - un utente autenticato puo caricare il consenso genitore solo sulla propria iscrizione;
  - il file esempio del consenso e visibile pubblicamente;
  - il documento consenso genitore non e pubblico.

## 2. Configurare l'esempio del consenso genitori

- Entra in `Admin > Altro > Organizzazione > Moduli`.
- Carica una foto chiara di esempio del foglio firmato.
- Usa un foglio reale o un fac-simile coerente con il vostro modo di raccogliere l'autorizzazione.
- Controlla poi da una pagina pubblica di iscrizione che l'esempio si veda davvero.

## 3. Completare il contatto privacy/supporto

- Entra in `Admin > Altro > Organizzazione > Profilo del palo`.
- Inserisci un contatto reale in `Contatto di supporto`.
- Questo contatto viene mostrato nelle pagine privacy e nella comunicazione sui consensi foto.

## 4. Verificare e approvare i testi privacy

- Fate rileggere i contenuti delle nuove pagine `/privacy` e `/privacy/photos` a chi nel vostro ente segue privacy o responsabilita organizzative.
- Controllate in particolare:
  - finalita del trattamento;
  - tempi di conservazione reali;
  - contatto corretto per esercizio dei diritti;
  - modalita effettive di uso pubblico delle immagini;
  - gestione dei minori e di chi puo firmare l'autorizzazione.
- Se serve, aggiornate i testi nel codice o chiedetemi di renderli configurabili anche da admin.

## 5. Attivare le notifiche push sui dispositivi admin

- Ogni admin deve aprire la dashboard admin dal proprio dispositivo.
- Deve cliccare su `Attiva notifiche push`.
- Deve accettare il permesso del browser.
- Su iPhone/iPad:
  - deve prima aggiungere l'app alla schermata Home;
  - poi deve aprire la web app installata e attivare da li le notifiche.
- Fate una prova reale con una nuova iscrizione:
  - compare la campanella con conteggio;
  - compare l'alert persistente nella dashboard;
  - arriva la notifica push anche con la pagina chiusa o in background.

## 6. Verificare i prerequisiti PWA sui device Apple

- Le notifiche web su iPhone/iPad funzionano solo dalla web app installata, non dal tab Safari normale.
- Controllate che gli admin Apple facciano questi passaggi:
  - `Condividi > Aggiungi alla schermata Home`;
  - apertura dell'app dalla Home;
  - login admin;
  - attivazione notifiche push dalla dashboard.
- Dopo il primo test, chiedete a ogni admin Apple di chiudere l'app e fare un'altra prova con una nuova iscrizione.

## 7. Valutare se serve un banner cookie in futuro

- Oggi nel codice non risultano analytics o tracker di profilazione attivi.
- Se aggiungete in futuro:
  - Google Analytics non anonimizzato;
  - Meta Pixel;
  - remarketing;
  - strumenti di tracciamento marketing o terze parti simili;
- allora dovrete aggiungere un banner/CMP prima di attivarli.

## 8. Fare un test funzionale completo

- Caso A: utente con account, minorenne:
  - iscrizione;
  - caricamento consenso;
  - visibilita in tab `Consensi` lato admin.
- Caso B: ospite minorenne:
  - iscrizione senza account;
  - messaggio che invita a creare account per caricare dopo;
  - collegamento della registrazione dopo creazione account;
  - caricamento consenso dalla propria area.
- Caso C: utente maggiorenne:
  - nessun blocco inutile;
  - nessuna richiesta di consenso genitore.
- Caso D: notifiche admin:
  - un admin desktop con browser chiuso riceve la push;
  - un admin iPhone/iPad con web app installata riceve la push;
  - cliccando la notifica si apre l'area admin dell'attivita.

## 9. Controllare i dati gia esistenti

- Le iscrizioni gia presenti non hanno automaticamente un documento consenso.
- Se avete attivita gia in corso con minorenni iscritti, aprite il nuovo tab `Consensi` e usatelo per capire chi deve ancora consegnarlo.
