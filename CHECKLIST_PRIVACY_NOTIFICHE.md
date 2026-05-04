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

## 10. Flusso autorizzazione genitoriale via email Brevo (attivita' rafforzate)

Per le attivita' con `activityType` diverso da "standard" (overnight, trip, camp, multi_day) e flag `requiresParentAuthorization` attivo, il sistema invia automaticamente un'email magic-link al genitore tramite Brevo.

### 10.1 Setup Brevo (una tantum)

- [x] Account Brevo creato (free)
- [x] Dominio `gugditalia.it` autenticato in Brevo (DKIM CNAME + brevo-code TXT + DMARC TXT)
- [x] Sender `noreply@gugditalia.it` configurato
- [x] API key Brevo salvata in Firebase Secret Manager:
  ```bash
  firebase functions:secrets:set BREVO_API_KEY
  ```
  Verifica con `firebase functions:secrets:get BREVO_API_KEY` (mostra solo metadata, non il valore).

### 10.2 Configurazione lato codice (gia' fatto)

I valori non-segreti sono in [functions/lib/config.js](functions/lib/config.js):
- `APP_PUBLIC_URL = "https://gugditalia.it"`
- `BREVO_SENDER_EMAIL = "noreply@gugditalia.it"`
- `BREVO_SENDER_NAME = "gugditalia"`
- `BREVO_REPLY_TO_EMAIL = "supporto@gugditalia.it"`
- `BREVO_REPLY_TO_NAME = "Supporto gugditalia"`
- `SUPPORT_CONTACT_TEXT = "Per assistenza contatta il dirigente della tua unita'."`
- `PARENT_AUTHORIZATION_TOKEN_TTL_DAYS = 14`

Per modificare, edita il file e ridepoia le functions.

### 10.3 Deploy

Ordine consigliato per primo deploy del flusso (lancia i comandi **uno alla volta** e attendi che ciascuno termini, non incollare tutto insieme):

```bash
# 1. Rules (token nuove + audit log + status nuovi)
firebase deploy --only firestore:rules,storage

# 2. Cloud Functions (5 nuove + 2 esistenti)
firebase deploy --only functions

# 3. App frontend (pagina /parent-confirm/:token + form admin/pubblico aggiornati)
npm install
npm run build
firebase deploy --only hosting
```

**Sintassi attenzioni**:
- `--only storage` (NON `storage:rules` — quella sintassi richiederebbe un target nominato in `.firebaserc`)
- `--only firestore:rules` invece e' valido (e' una sotto-categoria standard)
- `npm install` necessario nella root prima del build se hai appena fatto checkout della branch (`tsc` viene da `node_modules/.bin/`)

### 10.4 Cloud Functions deployate

- `onRegistrationPendingParentAuth` (Firestore trigger) — auto invio email su nuova iscrizione
- `parentAuthorizationGetContext` (callable pubblica) — pagina genitore legge dati attivita'
- `parentAuthorizationConfirm` (callable pubblica) — genitore conferma + PDF + audit log
- `parentAuthorizationReject` (callable pubblica) — genitore rifiuta
- `parentAuthorizationResend` (callable admin) — admin reinvia email

### 10.5 Test E2E del flusso magic link

Procedura raccomandata:

1. **Crea attivita' di test**: admin → nuova attivita' → tipo "Con pernottamento" → date multi-giorno → spunta "Visibile pubblicamente" + stato "Iscrizioni aperte". Lascia attivi i flag rafforzati di default.
2. **Iscrivi minorenne**: usa account utente con birthDate < 18 anni. Compila il form; al passo "Genitore e sicurezza" inserisci una **tua email reale** come email genitore.
3. **Verifica trigger**:
   - Firestore Console: la registration ha `registrationStatus: "pending_parent_authorization"` e `parentAuthorization.status: "email_sent"` con `brevoMessageId` valorizzato
   - Brevo dashboard: `Statistiche > Email transazionali` mostra l'email inviata
4. **Apri email**: arriva su `parentEmail` con sender `noreply@gugditalia.it`. Cliccare il bottone azzurro
5. **Verifica pagina genitore**:
   - URL `https://gugditalia.it/parent-confirm/<token64>`
   - Mostra dati attivita' + 5 checkbox + 2 consensi foto + signature pad
   - Pagina meta `noindex,nofollow,noarchive` (controlla `<meta name="robots">` in DOM)
6. **Conferma autorizzazione**: spunta tutte e 5 + firma + clicca conferma
7. **Verifica conferma server-side**:
   - Registration `registrationStatus: "confirmed"`, `parentAuthorization.status: "authorized"`
   - Storage: PDF presente in `protected/stakes/{stakeId}/activities/{activityId}/parent-authorization-pdfs/{registrationId}/{tokenHash}.pdf`
   - Firma in `parent-authorization-signatures/`
   - `consentAuditLogs` ha doc `parent_authorized` con tutti i campi
8. **Test rifiuto** (su seconda iscrizione): clicca "Non autorizzo" → modal motivo → conferma → registration `rejected_by_parent`
9. **Test scadenza**: in Firestore Console modifica manualmente `parentAuthorizationTokens/{hash}.expiresAt` a una data passata → riapri il link → "Link scaduto"
10. **Test riuso**: dopo conferma, riapri lo stesso link → "Autorizzazione gia' confermata"
11. **Test reinvio admin**: dalla console Firebase chiama callable `parentAuthorizationResend` con `{stakeId, activityId, registrationId}` (oppure quando tappa 6 sara' fatta, dal pulsante in dashboard admin) → verifica:
    - vecchio token `status: "invalidated"`
    - nuovo token creato + nuova email inviata
    - `consentAuditLogs` ha `token_invalidated` + `email_resent`

### 10.6 Verifica deliverability

Prima volta che parte un'email reale:
- Controlla che NON finisca in spam Gmail/Outlook
- Se finisce in spam: aggiungere SPF su DNS (record TXT `v=spf1 include:spf.brevo.com ~all`) e attendere 24h
- Verifica DMARC reports settimanali a `dmarc@gugditalia.it`

### 10.7 Testi legali da revisionare

I testi placeholder in [src/constants/legalDocs.ts](src/constants/legalDocs.ts) e [functions/lib/legalDocs.js](functions/lib/legalDocs.js) sono marcati `[DA REVISIONARE LEGALMENTE]`. Far validare a consulente prima del go-live:

- `LEGAL_DOCS.participation.body` — Autorizzazione partecipazione
- `LEGAL_DOCS.privacy.body` — Informativa privacy GDPR (titolare, finalita', tempi conservazione, contatti DPO)
- `LEGAL_DOCS.photo.body` — Liberatoria foto (separazione uso interno vs pubblico)
- Etichette in `PARENT_CONSENT_CHECKBOXES`

Quando aggiorni un testo, **incrementa la versione** in `LEGAL_DOC_VERSIONS` (sia client che server). Le versioni vengono salvate insieme al consenso del genitore per tracciabilita'.

### 10.8 Limiti e rischi noti

- **Free tier Brevo**: 300 email/giorno. Se l'organizzazione cresce molto, valutare upgrade
- **Tempo arrivo email**: tipicamente entro 30 secondi, ma puo' arrivare fino a 2 minuti in caso di rate limit Brevo
- **Email genitore digitata male**: il sistema non puo' verificare che l'email sia davvero del genitore. Solo il fatto che il genitore abbia accesso alla casella autorizza
- **Firma elettronica semplice**: non e' una firma digitale qualificata eIDAS. Vale come dichiarazione elettronica con audit trail (IP, user agent, timestamp). Per usi che richiedono firma qualificata serve flusso diverso
- **PDF audit non automaticamente inviato al genitore**: per privacy, il PDF resta solo lato admin. Se il genitore lo vuole, deve chiederlo al dirigente
- **Token in URL**: chi intercetta il link puo' confermare al posto del genitore. Mitigazione: TTL 14 giorni, uso singolo, link non condividibile (tag email)
