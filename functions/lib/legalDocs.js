/**
 * Mirror lato server delle costanti dei testi legali.
 * Quando aggiorni src/constants/legalDocs.ts INCREMENTA anche le versioni qui
 * altrimenti i PDF generati mostrano una versione e l'audit log un'altra.
 */

const LEGAL_DOC_VERSIONS = {
  participation: "v1-2026-05",
  privacy: "v1-2026-05",
  photo: "v1-2026-05",
};

// Testi compatti usati nel PDF audit. I testi completi (HTML/Markdown) restano
// nel frontend per la pagina del genitore. Qui mettiamo il riassunto stampabile.
const LEGAL_DOCS = {
  participation: {
    version: LEGAL_DOC_VERSIONS.participation,
    title: "Autorizzazione alla partecipazione",
    summary:
      "Il genitore o tutore autorizza la partecipazione del minore all'attivita' indicata, " +
      "dichiara di aver fornito tutte le informazioni sanitarie rilevanti e di autorizzare " +
      "i responsabili a contattare i numeri di emergenza e attivare le cure mediche urgenti " +
      "in caso di necessita'.",
  },
  privacy: {
    version: LEGAL_DOC_VERSIONS.privacy,
    title: "Informativa privacy (GDPR)",
    summary:
      "Titolare del trattamento: Paolo Celestini, persona fisica (NON una societa' " +
      "ne' un ente religioso ufficiale). Contatto: supporto@gugditalia.it. " +
      "I dati sono trattati per gestione iscrizione, sicurezza del partecipante e " +
      "comunicazioni operative ai genitori. Base giuridica: consenso, esecuzione " +
      "contrattuale, interesse vitale del minore. Email via Brevo (Sendinblue SAS, Francia). " +
      "Questa NON e' una piattaforma ufficiale della Chiesa: e' uno strumento sviluppato " +
      "a titolo personale dal titolare per supportare l'organizzazione delle attivita'.",
  },
  photo: {
    version: LEGAL_DOC_VERSIONS.photo,
    title: "Liberatoria foto e video",
    summary:
      "Consenso facoltativo, separato per: (A) realizzazione foto/video per uso interno; " +
      "(B) pubblicazione su canali pubblici dell'organizzazione. Il rifiuto non impedisce " +
      "la partecipazione.",
  },
};

const PARENT_CONSENT_CHECKBOXES = [
  {
    key: "isParentOrGuardian",
    label:
      "Confermo di essere il genitore o il tutore legale del minore, o di avere comunque titolo per autorizzarlo.",
  },
  {
    key: "authorizesParticipation",
    label:
      "Autorizzo la partecipazione del minore all'attivita' indicata, alle date, nel luogo e con le modalita' descritte.",
  },
  {
    key: "confirmsDataAccuracy",
    label:
      "Confermo che i dati inseriti sono corretti e veritieri, incluse le informazioni sanitarie e i contatti di emergenza.",
  },
  {
    key: "authorizesEmergencyContact",
    label:
      "Autorizzo i responsabili a contattare i numeri di emergenza indicati e ad attivare le cure mediche necessarie in caso di urgenza.",
  },
  {
    key: "readPrivacyNotice",
    label: "Dichiaro di aver letto e compreso l'informativa privacy.",
  },
];

module.exports = {
  LEGAL_DOC_VERSIONS,
  LEGAL_DOCS,
  PARENT_CONSENT_CHECKBOXES,
};
