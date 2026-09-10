const ROOM_CATEGORIES = new Set([
  "unassigned",
  "boys",
  "girls",
  "staff_male",
  "staff_female",
  "couple",
]);
const YOUTH_CATEGORIES = new Set(["giovane_uomo", "giovane_donna"]);
const ADULT_CATEGORIES = new Set(["dirigente", "accompagnatore"]);
const INELIGIBLE_STATUSES = new Set([
  "draft",
  "waitlist",
  "cancelled",
  "rejected",
  "rejected_by_parent",
]);
const ELIGIBLE_STATUSES = new Set([
  "submitted",
  "confirmed",
  "active",
  "pending_parent_authorization",
]);
const PREFERENCE_KEYS = ["roomPreference1Name", "roomPreference2Name"];

export const categoryLabels = Object.freeze({
  unassigned: "Da decidere",
  boys: "Ragazzi",
  girls: "Ragazze",
  staff_male: "Accompagnatori uomini",
  staff_female: "Accompagnatrici",
  couple: "Matrimoniale",
});

export function emptyRoomPlan() {
  return {
    rooms: [],
    assignments: {},
    lockedIds: [],
    adultGenders: {},
    couples: [],
    revision: 0,
    updatedAt: "",
  };
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function registrationStatus(registration) {
  return text(registration?.registrationStatus) || text(registration?.status);
}

function isAdult(registration) {
  return ADULT_CATEGORIES.has(registration?.genderRoleCategory);
}

function isYouth(registration) {
  return YOUTH_CATEGORIES.has(registration?.genderRoleCategory);
}

function registrationName(registration) {
  return (
    text(registration?.fullName) ||
    [text(registration?.firstName), text(registration?.lastName)].filter(Boolean).join(" ")
  );
}

function normalizeName(value) {
  return text(value)
    .toLocaleLowerCase("it-IT")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9'\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function registrationById(registrations) {
  return new Map(
    eligibleRegistrations(registrations)
      .filter((registration) => text(registration?.id))
      .map((registration) => [registration.id, registration]),
  );
}

function identityTokens(registration) {
  const tokens = [];
  const parentUid = text(registration?.parentUid);
  const childId = text(registration?.childId);
  const linkedUserId = text(registration?.linkedLaterToUserId);
  const userId = text(registration?.userId);
  const anonymousUid = text(registration?.anonymousUid);

  if (parentUid && childId) tokens.push(`child:${parentUid}:${childId}`);
  if (linkedUserId) tokens.push(`user:${linkedUserId}`);
  if (userId) tokens.push(`user:${userId}`);
  if (anonymousUid) tokens.push(`anonymous:${anonymousUid}`);
  return tokens;
}

function roomOccupants(plan, roomId) {
  return Object.entries(objectOrEmpty(plan?.assignments))
    .filter(([, assignedRoomId]) => assignedRoomId === roomId)
    .map(([registrationId]) => registrationId);
}

function confirmedCoupleFor(plan, registrationId, registrationsById) {
  for (const couple of Array.isArray(plan?.couples) ? plan.couples : []) {
    if (!couple || couple.confirmed !== true) continue;
    if (couple.firstId !== registrationId && couple.secondId !== registrationId) continue;
    const first = registrationsById.get(couple.firstId);
    const second = registrationsById.get(couple.secondId);
    if (!first || !second || !isAdult(first) || !isAdult(second)) continue;
    const firstGender = plan?.adultGenders?.[couple.firstId];
    const secondGender = plan?.adultGenders?.[couple.secondId];
    if (firstGender === secondGender || ![firstGender, secondGender].every((value) => value === "male" || value === "female")) continue;
    return couple;
  }
  return null;
}

export function eligibleRegistrations(registrations) {
  if (!Array.isArray(registrations)) return [];
  return registrations.filter((registration) => {
    if (!registration || typeof registration !== "object" || Array.isArray(registration)) return false;
    if (!text(registration.id)) return false;
    const primaryStatus = text(registration.registrationStatus).toLowerCase();
    const legacyStatus = text(registration.status).toLowerCase();
    if (INELIGIBLE_STATUSES.has(primaryStatus) || INELIGIBLE_STATUSES.has(legacyStatus)) return false;
    return primaryStatus ? ELIGIBLE_STATUSES.has(primaryStatus) : ELIGIBLE_STATUSES.has(legacyStatus);
  });
}

export function ageAt(birthDate, referenceDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(birthDate));
  const referenceText = typeof referenceDate === "string" ? referenceDate : "";
  const referenceMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(referenceText);
  const reference = referenceMatch
    ? new Date(Date.UTC(Number(referenceMatch[1]), Number(referenceMatch[2]) - 1, Number(referenceMatch[3])))
    : referenceDate instanceof Date
      ? referenceDate
      : new Date(referenceDate);
  if (!match || Number.isNaN(reference.getTime())) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) return null;
  let age = reference.getUTCFullYear() - year;
  if (
    reference.getUTCMonth() + 1 < month ||
    (reference.getUTCMonth() + 1 === month && reference.getUTCDate() < day)
  ) age -= 1;
  return age >= 0 ? age : null;
}

export function assignmentProblem(person, room, plan, registrations, referenceDate) {
  if (!person || !text(person.id)) return "Iscrizione non valida.";
  if (!room || !text(room.id)) return "Stanza non valida.";
  const eligible = registrationById(registrations);
  if (!eligible.has(person.id)) return "L'iscrizione non è idonea al piano stanze.";
  if (!ROOM_CATEGORIES.has(room.category) || room.category === "unassigned") {
    return "La stanza non ha ancora una categoria.";
  }

  const assignedRoomId = plan?.assignments?.[person.id];
  const occupants = roomOccupants(plan, room.id).filter((id) => id !== person.id);
  if (assignedRoomId !== room.id && occupants.length >= room.capacity) {
    return "La stanza ha raggiunto la capienza massima.";
  }

  const personTokens = new Set(identityTokens(person));
  for (const [otherId, otherRoomId] of Object.entries(objectOrEmpty(plan?.assignments))) {
    if (otherId === person.id || !otherRoomId) continue;
    const other = eligible.get(otherId);
    if (other && identityTokens(other).some((token) => personTokens.has(token))) {
      return "La stessa persona risulta già assegnata con un'altra iscrizione.";
    }
  }

  const age = ageAt(person.birthDate, referenceDate);
  if (room.minAge !== null && room.minAge !== undefined && (age === null || age < room.minAge)) {
    return "L'età non rispetta il minimo della stanza.";
  }
  if (room.maxAge !== null && room.maxAge !== undefined && (age === null || age > room.maxAge)) {
    return "L'età supera il massimo della stanza.";
  }

  if (person.genderRoleCategory === "giovane_uomo") {
    return room.category === "boys" ? null : "I giovani uomini possono essere assegnati solo alle stanze ragazzi.";
  }
  if (person.genderRoleCategory === "giovane_donna") {
    return room.category === "girls" ? null : "Le giovani donne possono essere assegnate solo alle stanze ragazze.";
  }
  if (!isAdult(person)) return "La categoria dell'iscrizione non è gestibile nel piano stanze.";

  const adultGender = plan?.adultGenders?.[person.id];
  if (adultGender !== "male" && adultGender !== "female") {
    return "Indica il sesso dello staff prima dell'assegnazione.";
  }
  if (room.category === "staff_male") {
    return adultGender === "male" ? null : "La stanza è riservata allo staff maschile.";
  }
  if (room.category === "staff_female") {
    return adultGender === "female" ? null : "La stanza è riservata allo staff femminile.";
  }
  if (room.category !== "couple") return "Lo staff può essere assegnato solo a stanze staff o coppia.";
  if (room.capacity !== 2) return "Una stanza coppia deve avere esattamente due posti.";

  const couple = confirmedCoupleFor(plan, person.id, eligible);
  if (!couple) return "Serve una coppia adulta confermata di sesso diverso.";
  const allowed = new Set([couple.firstId, couple.secondId]);
  if (occupants.some((id) => !allowed.has(id))) return "La stanza coppia contiene una persona estranea alla coppia.";
  const partnerId = couple.firstId === person.id ? couple.secondId : couple.firstId;
  const partnerRoom = plan?.assignments?.[partnerId];
  if (partnerRoom && partnerRoom !== room.id) return "I due coniugi devono essere assegnati alla stessa stanza.";
  return null;
}

export function validateRoomPlan(plan, registrations, referenceDate) {
  const errors = [];
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return ["Il piano stanze non è valido."];
  const rooms = Array.isArray(plan.rooms) ? plan.rooms : [];
  const assignments = objectOrEmpty(plan.assignments);
  const eligible = registrationById(registrations);
  const roomIds = new Set();
  const roomNames = new Set();

  if (rooms.length > 0 && !rooms.some((room) => room?.category === "staff_male" || room?.category === "staff_female")) {
    errors.push("Riserva almeno una stanza non coppia allo staff.");
  }
  for (const room of rooms) {
    if (!room || typeof room !== "object" || !text(room.id)) {
      errors.push("Ogni stanza deve avere un identificativo.");
      continue;
    }
    if (roomIds.has(room.id)) errors.push(`Identificativo stanza duplicato: ${room.id}.`);
    roomIds.add(room.id);
    if (!text(room.name)) errors.push(`La stanza ${room.id} deve avere un nome.`);
    const normalizedRoomName = normalizeName(room.name);
    if (normalizedRoomName && roomNames.has(normalizedRoomName)) errors.push(`Nome stanza duplicato: ${room.name}.`);
    if (normalizedRoomName) roomNames.add(normalizedRoomName);
    if (!Number.isInteger(room.capacity) || room.capacity < 1 || room.capacity > 50) errors.push(`Capienza non valida per ${room.name || room.id}.`);
    if (!ROOM_CATEGORIES.has(room.category)) errors.push(`Categoria non valida per ${room.name || room.id}.`);
    if (room.category === "couple" && room.capacity !== 2) errors.push(`La stanza coppia ${room.name || room.id} deve avere due posti.`);
    if (room.minAge !== null && (!Number.isInteger(room.minAge) || room.minAge < 0 || room.minAge > 120)) errors.push(`Età minima non valida per ${room.name || room.id}.`);
    if (room.maxAge !== null && (!Number.isInteger(room.maxAge) || room.maxAge < 0 || room.maxAge > 120)) errors.push(`Età massima non valida per ${room.name || room.id}.`);
    if (Number.isInteger(room.minAge) && Number.isInteger(room.maxAge) && room.minAge > room.maxAge) errors.push(`Intervallo di età non valido per ${room.name || room.id}.`);
  }

  const identityOwner = new Map();
  for (const [registrationId, roomId] of Object.entries(assignments)) {
    const person = eligible.get(registrationId);
    const room = rooms.find((candidate) => candidate?.id === roomId);
    if (!person) {
      errors.push(`Assegnazione riferita a un'iscrizione assente o non idonea: ${registrationId}.`);
      continue;
    }
    if (!room) {
      errors.push(`Assegnazione di ${registrationName(person) || registrationId} a una stanza inesistente.`);
      continue;
    }
    for (const token of identityTokens(person)) {
      const owner = identityOwner.get(token);
      if (owner && owner !== registrationId) errors.push(`La stessa persona compare in più iscrizioni assegnate: ${owner} e ${registrationId}.`);
      identityOwner.set(token, registrationId);
    }
    const problem = assignmentProblem(person, room, plan, registrations, referenceDate);
    if (problem) errors.push(`${registrationName(person) || registrationId}: ${problem}`);
  }

  for (const room of rooms) {
    const occupants = roomOccupants(plan, room.id);
    if (occupants.length > room.capacity) errors.push(`${room.name || room.id} supera la capienza di ${room.capacity}.`);
    if (room.category === "couple" && occupants.length > 0) {
      const firstCouple = confirmedCoupleFor(plan, occupants[0], eligible);
      if (!firstCouple || occupants.some((id) => id !== firstCouple.firstId && id !== firstCouple.secondId)) {
        errors.push(`${room.name || room.id} può contenere solo una coppia confermata.`);
      }
    }
  }

  const locked = Array.isArray(plan.lockedIds) ? plan.lockedIds : [];
  for (const id of locked) if (!assignments[id]) errors.push(`Blocco senza assegnazione: ${id}.`);
  for (const [id, gender] of Object.entries(objectOrEmpty(plan.adultGenders))) {
    const registration = eligible.get(id);
    if (!registration || !isAdult(registration)) errors.push(`Sesso staff riferito a un'iscrizione adulta assente o non idonea: ${id}.`);
    if (gender !== "male" && gender !== "female") errors.push(`Sesso staff non valido per ${id}.`);
  }
  const seenCoupleIds = new Set();
  for (const couple of Array.isArray(plan.couples) ? plan.couples : []) {
    if (!couple || !text(couple.firstId) || !text(couple.secondId) || couple.firstId === couple.secondId) {
      errors.push("Coppia non valida.");
      continue;
    }
    if (seenCoupleIds.has(couple.firstId) || seenCoupleIds.has(couple.secondId)) errors.push("Una persona compare in più coppie.");
    seenCoupleIds.add(couple.firstId);
    seenCoupleIds.add(couple.secondId);
    if (!eligible.has(couple.firstId) || !eligible.has(couple.secondId) || !isAdult(eligible.get(couple.firstId)) || !isAdult(eligible.get(couple.secondId))) {
      errors.push("Le coppie possono includere solo iscrizioni adulte idonee.");
    } else if (
      couple.confirmed === true &&
      (plan.adultGenders?.[couple.firstId] !== "male" || plan.adultGenders?.[couple.secondId] !== "female") &&
      (plan.adultGenders?.[couple.firstId] !== "female" || plan.adultGenders?.[couple.secondId] !== "male")
    ) {
      errors.push("Una coppia confermata richiede un uomo e una donna indicati esplicitamente.");
    }
  }
  return [...new Set(errors)];
}

export function buildPreferenceLinks(registrations) {
  const eligible = eligibleRegistrations(registrations);
  const byId = new Map(eligible.map((registration) => [registration.id, registration]));
  const idsByName = new Map();
  for (const registration of eligible) {
    const normalized = normalizeName(registrationName(registration));
    if (!normalized) continue;
    idsByName.set(normalized, [...(idsByName.get(normalized) || []), registration.id]);
  }

  const links = [];
  for (const registration of eligible) {
    const answers = objectOrEmpty(registration.answers);
    const matches = objectOrEmpty(registration.roomPreferenceMatches);
    for (const key of PREFERENCE_KEYS) {
      const rawValue = text(answers[key]);
      if (!rawValue) continue;
      const exactIds = idsByName.get(normalizeName(rawValue)) || [];
      let toId = exactIds.length === 1 && exactIds[0] !== registration.id ? exactIds[0] : null;
      if (exactIds.length === 0 || (exactIds.length === 1 && exactIds[0] === registration.id)) {
        const saved = objectOrEmpty(matches[key]);
        const savedId = text(saved.matchedRegistrationId);
        if (
          saved.status === "matched" &&
          normalizeName(saved.rawValue) === normalizeName(rawValue) &&
          savedId !== registration.id &&
          byId.has(savedId)
        ) toId = savedId;
      }
      links.push({
        fromId: registration.id,
        toId,
        label: key === PREFERENCE_KEYS[0] ? "Prima preferenza" : "Seconda preferenza",
        key,
      });
    }
  }
  return links;
}

function hasRoomNotes(registration) {
  return Boolean(text(objectOrEmpty(registration?.answers).roomNotes));
}

function roomPlanClone(plan) {
  return {
    rooms: (Array.isArray(plan?.rooms) ? plan.rooms : []).map((room) => ({ ...room })),
    assignments: { ...objectOrEmpty(plan?.assignments) },
    lockedIds: [...new Set(Array.isArray(plan?.lockedIds) ? plan.lockedIds : [])],
    adultGenders: { ...objectOrEmpty(plan?.adultGenders) },
    couples: (Array.isArray(plan?.couples) ? plan.couples : []).map((couple) => ({ ...couple })),
    revision: Number.isInteger(plan?.revision) ? plan.revision : 0,
    updatedAt: text(plan?.updatedAt),
  };
}

function ensureReservedStaffRoom(candidate) {
  if (candidate.rooms.length === 0) return;
  if (candidate.rooms.some((room) => room.category === "staff_male" || room.category === "staff_female")) return;
  const occupied = candidate.rooms
    .filter((room) => room.category === "unassigned")
    .map((room) => ({
      room,
      genders: [...new Set(roomOccupants(candidate, room.id).map((id) => candidate.adultGenders[id]))],
    }))
    .filter(({ genders }) => genders.length === 1 && (genders[0] === "male" || genders[0] === "female"))
    .sort((left, right) => left.room.id.localeCompare(right.room.id));
  if (occupied[0]) {
    occupied[0].room.category = occupied[0].genders[0] === "male" ? "staff_male" : "staff_female";
    return;
  }
  const available = candidate.rooms
    .filter((room) => room.category === "unassigned" && roomOccupants(candidate, room.id).length === 0)
    .sort((a, b) => (a.capacity === 2 ? -1 : b.capacity === 2 ? 1 : a.capacity - b.capacity) || a.id.localeCompare(b.id));
  if (available[0]) available[0].category = "staff_male";
}

function candidateOrders(people, linkCount, links) {
  const byId = (left, right) => left.id.localeCompare(right.id);
  const byLinks = (left, right) => (linkCount.get(right.id) || 0) - (linkCount.get(left.id) || 0) || byId(left, right);
  const byAge = (left, right) => text(left.birthDate).localeCompare(text(right.birthDate)) || byLinks(left, right);
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const neighbors = new Map();
  for (const link of links) {
    if (!link.toId || !peopleById.has(link.fromId) || !peopleById.has(link.toId)) continue;
    neighbors.set(link.fromId, [...new Set([...(neighbors.get(link.fromId) || []), link.toId])]);
    neighbors.set(link.toId, [...new Set([...(neighbors.get(link.toId) || []), link.fromId])]);
  }
  const linkedOrder = [];
  const seen = new Set();
  function visit(id) {
    if (seen.has(id)) return;
    seen.add(id);
    linkedOrder.push(peopleById.get(id));
    for (const neighbor of [...(neighbors.get(id) || [])].sort()) visit(neighbor);
  }
  for (const person of [...people].sort(byLinks)) visit(person.id);
  return [
    linkedOrder,
    [...people].sort(byLinks),
    [...people].sort(byAge),
    [...people].sort(byLinks).reverse(),
    [...people].sort(byId),
  ];
}

function planScore(candidate, links, initialAssignedCount) {
  let met = 0;
  let mutual = 0;
  const pairKeys = new Set();
  for (const link of links) {
    if (!link.toId) continue;
    if (candidate.assignments[link.fromId] && candidate.assignments[link.fromId] === candidate.assignments[link.toId]) met += 1;
    const inverse = links.some((other) => other.fromId === link.toId && other.toId === link.fromId);
    if (inverse) pairKeys.add([link.fromId, link.toId].sort().join("|"));
  }
  for (const key of pairKeys) {
    const [first, second] = key.split("|");
    if (candidate.assignments[first] && candidate.assignments[first] === candidate.assignments[second]) mutual += 1;
  }
  return (Object.keys(candidate.assignments).length - initialAssignedCount) * 10000 + mutual * 100 + met;
}

function simulateAutomatic(base, order, registrations, links, referenceDate, reverseRooms) {
  const candidate = roomPlanClone(base);
  const linksByPerson = new Map();
  for (const link of links) {
    if (!link.toId) continue;
    linksByPerson.set(link.fromId, [...(linksByPerson.get(link.fromId) || []), link.toId]);
    linksByPerson.set(link.toId, [...(linksByPerson.get(link.toId) || []), link.fromId]);
  }
  for (const person of order) {
    if (candidate.assignments[person.id] || hasRoomNotes(person)) continue;
    const desiredCategory = person.genderRoleCategory === "giovane_uomo" ? "boys" : "girls";
    const rooms = candidate.rooms
      .filter((room) => room.category === desiredCategory || room.category === "unassigned")
      .map((room) => {
        const occupants = roomOccupants(candidate, room.id);
        const friendHits = (linksByPerson.get(person.id) || []).filter((id) => occupants.includes(id)).length;
        return { room, friendHits, free: room.capacity - occupants.length };
      })
      .filter(({ room, free }) => free > 0 && assignmentProblem(person, { ...room, category: desiredCategory }, { ...candidate, rooms: candidate.rooms.map((item) => item.id === room.id ? { ...item, category: desiredCategory } : item) }, registrations, referenceDate) === null)
      .sort((left, right) => right.friendHits - left.friendHits || (reverseRooms ? right.free - left.free : left.free - right.free) || left.room.id.localeCompare(right.room.id));
    if (!rooms[0]) continue;
    const selected = candidate.rooms.find((room) => room.id === rooms[0].room.id);
    if (selected.category === "unassigned") selected.category = desiredCategory;
    candidate.assignments[person.id] = selected.id;
  }
  return candidate;
}

export function proposeRoomPlan(plan, registrations, referenceDate, options = {}) {
  const original = roomPlanClone(plan || emptyRoomPlan());
  const eligible = eligibleRegistrations(registrations);
  const byId = new Map(eligible.map((registration) => [registration.id, registration]));
  const recalculate = options?.recalculate === true;
  const preserved = new Set();
  for (const [id] of Object.entries(original.assignments)) {
    const registration = byId.get(id);
    if (!recalculate || original.lockedIds.includes(id) || isAdult(registration)) preserved.add(id);
  }
  const base = roomPlanClone(original);
  base.assignments = Object.fromEntries(Object.entries(base.assignments).filter(([id]) => preserved.has(id)));
  ensureReservedStaffRoom(base);

  const links = buildPreferenceLinks(eligible);
  const linkCount = new Map();
  for (const link of links) if (link.toId) {
    linkCount.set(link.fromId, (linkCount.get(link.fromId) || 0) + 1);
    linkCount.set(link.toId, (linkCount.get(link.toId) || 0) + 1);
  }
  const people = eligible.filter((registration) => isYouth(registration));
  const initialAssignedCount = Object.keys(base.assignments).length;
  const attempts = candidateOrders(people, linkCount, links).flatMap((order) => [
    simulateAutomatic(base, order, eligible, links, referenceDate, false),
    simulateAutomatic(base, order, eligible, links, referenceDate, true),
  ]);
  attempts.sort((left, right) => planScore(right, links, initialAssignedCount) - planScore(left, links, initialAssignedCount) || JSON.stringify(left.assignments).localeCompare(JSON.stringify(right.assignments)));
  const best = attempts[0] || base;
  best.updatedAt = referenceDate instanceof Date && !Number.isNaN(referenceDate.getTime())
    ? referenceDate.toISOString()
    : text(original.updatedAt);
  return best;
}

export function roomSummary(plan, registrations) {
  const eligibleIds = new Set(eligibleRegistrations(registrations).map((registration) => registration.id));
  const assigned = Object.keys(objectOrEmpty(plan?.assignments)).filter((id) => eligibleIds.has(id)).length;
  const totalBeds = (Array.isArray(plan?.rooms) ? plan.rooms : []).reduce((sum, room) => sum + (Number.isInteger(room?.capacity) && room.capacity > 0 ? room.capacity : 0), 0);
  const links = buildPreferenceLinks(registrations);
  const resolved = links.filter((link) => link.toId);
  const preferencesMet = resolved.filter((link) => plan?.assignments?.[link.fromId] && plan.assignments[link.fromId] === plan.assignments[link.toId]).length;
  return {
    assigned,
    totalBeds,
    freeBeds: Math.max(0, totalBeds - assigned),
    preferencesMet,
    preferencesTotal: links.length,
    unresolvedPreferences: links.length - resolved.length,
  };
}
