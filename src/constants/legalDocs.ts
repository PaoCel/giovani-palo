/**
 * Versioni e testi dei documenti legali per autorizzazione genitoriale.
 *
 * IMPORTANTE: i testi qui contenuti sono PLACEHOLDER e devono essere
 * REVISIONATI da consulente legale / responsabili dell'organizzazione
 * prima di considerarli validi.
 *
 * Quando aggiorni un testo, INCREMENTA la relativa versione (es. v1 -> v2).
 * La versione viene salvata insieme al consenso del genitore per tracciabilita'.
 * Non rimuovere mai versioni vecchie: aggiungi sempre nuove costanti.
 */

export const LEGAL_DOC_VERSIONS = {
  participation: "v1-2026-05",
  privacy: "v1-2026-05",
  photo: "v1-2026-05",
} as const;

export type LegalDocKey = keyof typeof LEGAL_DOC_VERSIONS;

export interface LegalDocText {
  version: string;
  title: string;
  body: string;
  reviewedByLegal: boolean;
  reviewNotes: string;
}

export const LEGAL_DOCS: Record<LegalDocKey, LegalDocText> = {
  participation: {
    version: LEGAL_DOC_VERSIONS.participation,
    title: "Autorizzazione alla partecipazione",
    reviewedByLegal: false,
    reviewNotes:
      "[DA REVISIONARE LEGALMENTE] Testo placeholder. Far validare da consulente.",
    body: `Il sottoscritto, in qualita' di genitore o tutore legale del minore indicato, autorizza la partecipazione del minore all'attivita' organizzata dall'Organizzazione.

Il sottoscritto dichiara:
- di avere titolo per esercitare la responsabilita' genitoriale sul minore;
- di essere a conoscenza del programma, delle date, del luogo e delle caratteristiche dell'attivita' (incluso eventuale pernottamento o trasferta);
- di aver fornito tutte le informazioni sanitarie, alimentari e logistiche rilevanti per la sicurezza del minore;
- di autorizzare i responsabili dell'attivita' a contattare i numeri di emergenza indicati in caso di necessita' e ad attivare le cure mediche urgenti necessarie;
- di sollevare l'Organizzazione e i responsabili da ogni responsabilita' per fatti non imputabili a colpa o negligenza degli stessi.

Il presente consenso e' raccolto tramite procedura elettronica con link inviato all'indirizzo email del genitore dichiarato in fase di iscrizione.`,
  },
  privacy: {
    version: LEGAL_DOC_VERSIONS.privacy,
    title: "Informativa privacy (Reg. UE 2016/679 - GDPR)",
    reviewedByLegal: false,
    reviewNotes:
      "[DA REVISIONARE LEGALMENTE] Testo predisposto da titolare individuale, far validare a consulente.",
    body: `Ai sensi degli artt. 13 e 14 del Reg. UE 2016/679 (GDPR), il titolare del trattamento informa che i dati personali del minore e del genitore o tutore raccolti tramite questo modulo saranno trattati per le seguenti finalita':

1. Gestione amministrativa dell'iscrizione e della partecipazione all'attivita';
2. Tutela della sicurezza e della salute del partecipante (anche tramite condivisione di informazioni mediche dichiarate con personale sanitario in caso di emergenza);
3. Comunicazioni operative ai genitori o tutori e ai partecipanti relative all'attivita';
4. Adempimenti di obblighi di legge.

Base giuridica: consenso, esecuzione di obblighi precontrattuali e contrattuali, interesse vitale del minore, obbligo legale.

Conservazione: i dati saranno conservati per il tempo strettamente necessario alle finalita' sopra indicate e in conformita' agli obblighi di legge.

Diritti dell'interessato: accesso, rettifica, cancellazione, limitazione, portabilita', opposizione, reclamo al Garante Privacy.

Titolare del trattamento: Paolo Celestini, persona fisica proprietaria della piattaforma. Contatto: supporto@gugditalia.it. Non e' una societa' ne' un ente: il trattamento e' gestito direttamente dal titolare individuale che ha sviluppato e mantiene questa piattaforma a supporto delle attivita'.

DISCLAIMER: questa NON e' una piattaforma ufficiale della Chiesa di Gesu' Cristo dei Santi degli Ultimi Giorni ne' di altra organizzazione religiosa. E' uno strumento sviluppato e gestito a titolo personale dal titolare per supportare l'organizzazione delle attivita'.

L'invio dell'email di autorizzazione tramite il provider Brevo (Sendinblue SAS, Francia) comporta il trasferimento dei dati strettamente necessari (indirizzo email genitore, nome attivita', nome partecipante, link di conferma) al fornitore del servizio email transazionale.`,
  },
  photo: {
    version: LEGAL_DOC_VERSIONS.photo,
    title: "Liberatoria foto e video",
    reviewedByLegal: false,
    reviewNotes:
      "[DA REVISIONARE LEGALMENTE] Verificare con consulente la separazione tra uso interno e uso pubblicabile/social.",
    body: `Il sottoscritto, in qualita' di genitore o tutore legale del minore indicato, esprime separatamente i seguenti consensi (FACOLTATIVI - il rifiuto NON impedisce la partecipazione all'attivita'):

A) Consenso alla realizzazione di foto e video da parte dei responsabili durante l'attivita' per uso interno e documentazione (album dell'attivita', materiale per le famiglie partecipanti).

B) Consenso alla pubblicazione delle immagini su canali pubblici dell'Organizzazione (sito web, social media, materiale promozionale).

I consensi possono essere revocati in qualsiasi momento contattando i responsabili. La revoca non pregiudica la liceita' dei trattamenti effettuati prima della revoca.

L'Organizzazione si impegna a:
- non pubblicare immagini lesive della dignita' o del decoro del minore;
- rimuovere tempestivamente, su richiesta, le immagini gia' pubblicate quando tecnicamente possibile.`,
  },
};

export interface ConsentCheckboxLabel {
  key: keyof import("../types/models").ParentAuthorizationConsents;
  label: string;
  required: true;
}

export const PARENT_CONSENT_CHECKBOXES: ConsentCheckboxLabel[] = [
  {
    key: "isParentOrGuardian",
    label:
      "Confermo di essere il genitore o il tutore legale del minore, o di avere comunque titolo per autorizzarlo.",
    required: true,
  },
  {
    key: "authorizesParticipation",
    label:
      "Autorizzo la partecipazione del minore all'attivita' indicata, alle date, nel luogo e con le modalita' descritte (incluso eventuale pernottamento o trasferta).",
    required: true,
  },
  {
    key: "confirmsDataAccuracy",
    label:
      "Confermo che i dati inseriti sono corretti e veritieri, incluse le informazioni sanitarie e i contatti di emergenza.",
    required: true,
  },
  {
    key: "authorizesEmergencyContact",
    label:
      "Autorizzo i responsabili a contattare i numeri di emergenza indicati e ad attivare le cure mediche necessarie in caso di urgenza.",
    required: true,
  },
  {
    key: "readPrivacyNotice",
    label:
      "Dichiaro di aver letto e compreso l'informativa privacy.",
    required: true,
  },
];

export interface PhotoConsentLabel {
  key: "photoConsent" | "socialPublicationConsent";
  label: string;
  helpText: string;
}

export const PHOTO_CONSENT_OPTIONS: PhotoConsentLabel[] = [
  {
    key: "photoConsent",
    label:
      "Acconsento alla realizzazione di foto e video del minore durante l'attivita' per uso interno e documentazione.",
    helpText:
      "FACOLTATIVO. Il rifiuto non impedisce la partecipazione all'attivita'.",
  },
  {
    key: "socialPublicationConsent",
    label:
      "Acconsento alla pubblicazione delle immagini sui canali pubblici dell'Organizzazione (sito, social, materiale promozionale).",
    helpText:
      "FACOLTATIVO e separato dal precedente. Il rifiuto non impedisce la partecipazione.",
  },
];

export const SUPPORT_CONTACT_TEXT =
  "Per assistenza contatta il dirigente della tua unita'.";

export const PARENT_AUTHORIZATION_TOKEN_TTL_DAYS = 14;
