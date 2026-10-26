const GROUP_LABELS = new Set(["pattuglia", "gruppo", "compagnia", "team", "squadra"]);
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

class CampConfigurationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function normalizeCampConfiguration(input, previous = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new CampConfigurationError("invalid-argument", "Il piano non è valido.");
  for (const field of ["committees", "patrols", "manualLeaders"]) {
    if (hasOwn(input, field) && !Array.isArray(input[field])) throw new CampConfigurationError("invalid-argument", "Il piano non è valido.");
  }
  const groupLabel = hasOwn(input, "groupLabel") ? input.groupLabel : previous.groupLabel || "pattuglia";
  if (!GROUP_LABELS.has(groupLabel)) {
    throw new CampConfigurationError("invalid-argument", "Scegli un nome per i gruppi tra quelli disponibili.");
  }
  const previousCommittees = Array.isArray(previous.committees) ? previous.committees : [];
  const previousById = new Map(previousCommittees.filter((committee) => committee && typeof committee === "object").map((committee) => [committee.id, committee]));
  const rawCommittees = Array.isArray(input.committees) ? [...input.committees] : [];
  for (const saved of previousCommittees) {
    if (saved && typeof saved === "object" && !rawCommittees.some((committee) => committee?.id === saved.id)) rawCommittees.push({ ...saved });
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

module.exports = { normalizeCampConfiguration, assertCampRevision, nextCampRevision, CampConfigurationError };
