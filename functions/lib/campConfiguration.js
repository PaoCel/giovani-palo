const GROUP_LABELS = new Set(["pattuglia", "gruppo", "compagnia", "team", "squadra"]);
const HISTORIC_COMMITTEE_IDS = ["logistics", "wellbeing", "kitchen", "games", "spiritual"];
const COMMITTEE_ID_PATTERN = /^(?:logistics|wellbeing|kitchen|games|spiritual|c_[a-z0-9]{8,32})$/;
const MAX_COMMITTEES = 20;
const LEGACY_PLAN_MESSAGE = "Questa versione dell'app non può modificare il piano. Ricarica la pagina per aggiornarla.";
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const ownObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

class CampConfigurationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function isHistoricCommitteeId(id) {
  return HISTORIC_COMMITTEE_IDS.includes(id);
}

function isValidCommitteeId(id) {
  return typeof id === "string" && COMMITTEE_ID_PATTERN.test(id);
}

// `planFormat` sta accanto a `plan` nella richiesta, mai dentro il piano salvato.
// Assente: client precedenti (unione). 2: elenco comitati completo, revisione obbligatoria.
function readPlanFormat(data) {
  const source = ownObject(data) ? data : {};
  if (source.planFormat === undefined) return 1;
  if (source.planFormat !== 2) throw new CampConfigurationError("invalid-argument", "Il formato del piano non è valido.");
  if (!hasOwn(source, "expectedUpdatedAt") || (source.expectedUpdatedAt !== null && typeof source.expectedUpdatedAt !== "string")) {
    throw new CampConfigurationError("invalid-argument", "La revisione del piano non è valida.");
  }
  return 2;
}

// Un client precedente conosce solo i cinque comitati storici: salva con l'unione
// di sempre solo se il piano salvato non ne ha altri (o non esiste ancora), così
// non resuscita un comitato eliminato e non sposta persone che non vede.
function assertLegacyPlanEditable(activityType, previous) {
  const ids = ownObject(previous) && Array.isArray(previous.committees)
    ? previous.committees.map((committee) => (ownObject(committee) ? committee.id : undefined))
    : [];
  const historic = ids.length === HISTORIC_COMMITTEE_IDS.length
    && new Set(ids).size === ids.length
    && ids.every(isHistoricCommitteeId);
  if (activityType !== "camp" || (previous && !historic)) {
    throw new CampConfigurationError("failed-precondition", LEGACY_PLAN_MESSAGE);
  }
}

function validateCommitteeList(committees) {
  if (!Array.isArray(committees)) throw new CampConfigurationError("invalid-argument", "Il piano non è valido.");
  if (committees.length > MAX_COMMITTEES) {
    throw new CampConfigurationError("invalid-argument", `Il piano può contenere al massimo ${MAX_COMMITTEES} comitati.`);
  }
  const ids = new Set();
  for (const committee of committees) {
    if (!ownObject(committee)) throw new CampConfigurationError("invalid-argument", "Il piano non è valido.");
    if (!isValidCommitteeId(committee.id)) throw new CampConfigurationError("invalid-argument", "Il codice di un comitato non è valido.");
    if (ids.has(committee.id)) throw new CampConfigurationError("invalid-argument", "Due comitati hanno lo stesso codice.");
    ids.add(committee.id);
    if (!hasOwn(committee, "title")) {
      throw new CampConfigurationError("invalid-argument", "Il nome del comitato deve contenere da 1 a 80 caratteri.");
    }
  }
}

function normalizeCampConfiguration(input, previous = {}, { planFormat = 1, defaultGroupLabel = "pattuglia" } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new CampConfigurationError("invalid-argument", "Il piano non è valido.");
  for (const field of ["committees", "patrols", "manualLeaders"]) {
    if (hasOwn(input, field) && !Array.isArray(input[field])) throw new CampConfigurationError("invalid-argument", "Il piano non è valido.");
  }
  const groupLabel = hasOwn(input, "groupLabel") ? input.groupLabel : previous.groupLabel || defaultGroupLabel;
  if (!GROUP_LABELS.has(groupLabel)) {
    throw new CampConfigurationError("invalid-argument", "Scegli un nome per i gruppi tra quelli disponibili.");
  }
  const previousCommittees = Array.isArray(previous.committees) ? previous.committees : [];
  const previousById = new Map(previousCommittees.filter((committee) => committee && typeof committee === "object").map((committee) => [committee.id, committee]));
  if (planFormat === 2) validateCommitteeList(input.committees);
  const rawCommittees = Array.isArray(input.committees) ? [...input.committees] : [];
  // Formato 2: l'elenco è completo, un comitato assente è eliminato.
  if (planFormat !== 2) {
    for (const saved of previousCommittees) {
      if (saved && typeof saved === "object" && !rawCommittees.some((committee) => committee?.id === saved.id)) rawCommittees.push({ ...saved });
    }
  }
  const committees = rawCommittees.map((committee) => {
    if (!committee || typeof committee !== "object" || Array.isArray(committee)) return committee;
    const saved = previousById.get(committee.id);
    const responsibilities = hasOwn(committee, "responsibilities") ? committee.responsibilities : saved?.responsibilities || "";
    if (typeof responsibilities !== "string" || responsibilities.trim().length > 600) {
      throw new CampConfigurationError("invalid-argument", "L'incarico del comitato può contenere fino a 600 caratteri.");
    }
    if (hasOwn(committee, "title") && (typeof committee.title !== "string" || !committee.title.trim() || committee.title.trim().length > 80)) {
      throw new CampConfigurationError("invalid-argument", "Il nome del comitato deve contenere da 1 a 80 caratteri.");
    }
    return { ...saved, ...committee, ...(hasOwn(committee, "title") ? { title: committee.title.trim() } : {}), responsibilities: responsibilities.trim() };
  });
  return { ...previous, ...input, groupLabel, committees };
}

function assertCampRevision(expected, current) {
  if (expected !== undefined && expected !== null && typeof expected !== "string") throw new CampConfigurationError("invalid-argument", "La revisione del piano non è valida.");
  if (expected !== undefined && expected !== (current?.updatedAt || null)) {
    throw new CampConfigurationError("aborted", "Il piano è stato modificato da un'altra persona. Ricarica il piano salvato prima di riprovare.");
  }
}

function nextCampRevision(previous, now = Date.now()) {
  const old = Date.parse(previous || "");
  return new Date(Math.max(now, Number.isFinite(old) ? old + 1 : now)).toISOString();
}

module.exports = {
  normalizeCampConfiguration,
  assertCampRevision,
  nextCampRevision,
  readPlanFormat,
  assertLegacyPlanEditable,
  isHistoricCommitteeId,
  isValidCommitteeId,
  HISTORIC_COMMITTEE_IDS,
  MAX_COMMITTEES,
  LEGACY_PLAN_MESSAGE,
  CampConfigurationError,
};
