const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentDeleted } = require("firebase-functions/v2/firestore");

const { REGION } = require("./config");

const MAX_PAYLOAD_BYTES = 900 * 1024;
const MAX_ROOMS = 200;
const MAX_REGISTRATIONS = 2000;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const RESERVED_MAP_IDS = new Set(["__proto__", "prototype", "constructor"]);
let corePromise;

function getCore() {
  corePromise ||= import("./roomPlannerCore.mjs");
  return corePromise;
}

function ownObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value, allowed, context) {
  if (!ownObject(value)) throw new HttpsError("invalid-argument", `${context} non valido.`);
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) {
    throw new HttpsError("invalid-argument", `${context}: campi non ammessi (${unexpected.join(", ")}).`);
  }
}

function requiredString(value, label, maxLength = 200) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new HttpsError("invalid-argument", `${label} non valido.`);
  }
  return value.trim();
}

function optionalString(value, label, maxLength) {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new HttpsError("invalid-argument", `${label} non valido.`);
  }
  return value.trim();
}

function pathId(value, label) {
  const id = requiredString(value, label, 128);
  if (!ID_PATTERN.test(id) || RESERVED_MAP_IDS.has(id)) {
    throw new HttpsError("invalid-argument", `${label} non valido.`);
  }
  return id;
}

function parseNullableAge(value, label) {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 0 || value > 120) {
    throw new HttpsError("invalid-argument", `${label} non valida.`);
  }
  return value;
}

function parseRoom(source, index) {
  assertExactKeys(
    source,
    ["id", "name", "capacity", "floor", "category", "accessible", "notes", "minAge", "maxAge"],
    `Stanza ${index + 1}`,
  );
  const category = requiredString(source.category, `Categoria stanza ${index + 1}`, 30);
  if (!["unassigned", "boys", "girls", "staff_male", "staff_female", "couple"].includes(category)) {
    throw new HttpsError("invalid-argument", `Categoria stanza ${index + 1} non valida.`);
  }
  if (!Number.isInteger(source.capacity) || source.capacity < 1 || source.capacity > 50) {
    throw new HttpsError("invalid-argument", `Capienza stanza ${index + 1} non valida.`);
  }
  if (typeof source.accessible !== "boolean") {
    throw new HttpsError("invalid-argument", `Accessibilità stanza ${index + 1} non valida.`);
  }
  return {
    id: pathId(source.id, `ID stanza ${index + 1}`),
    name: requiredString(source.name, `Nome stanza ${index + 1}`, 120),
    capacity: source.capacity,
    floor: optionalString(source.floor, `Piano stanza ${index + 1}`, 80),
    category,
    accessible: source.accessible,
    notes: optionalString(source.notes, `Note stanza ${index + 1}`, 1000),
    minAge: parseNullableAge(source.minAge, `Età minima stanza ${index + 1}`),
    maxAge: parseNullableAge(source.maxAge, `Età massima stanza ${index + 1}`),
  };
}

function parseIdMap(value, label, valueParser) {
  if (!ownObject(value)) throw new HttpsError("invalid-argument", `${label} non valido.`);
  const result = Object.create(null);
  for (const [rawId, rawValue] of Object.entries(value)) {
    const id = pathId(rawId, `${label}: ID`);
    result[id] = valueParser(rawValue, id);
  }
  return result;
}

function parsePlan(source) {
  // `published` è opzionale: i piani salvati prima della pubblicazione non
  // ce l'hanno e il client può rimandarli così come li ha letti.
  assertExactKeys(
    source,
    ["rooms", "assignments", "lockedIds", "adultGenders", "couples", "published", "revision", "updatedAt"],
    "Piano stanze",
  );
  if (source.published !== undefined && typeof source.published !== "boolean") {
    throw new HttpsError("invalid-argument", "Il flag di pubblicazione deve essere true o false.");
  }
  if (!Array.isArray(source.rooms) || source.rooms.length > MAX_ROOMS) {
    throw new HttpsError("invalid-argument", `Il piano può contenere al massimo ${MAX_ROOMS} stanze.`);
  }
  if (!Array.isArray(source.lockedIds) || source.lockedIds.length > MAX_REGISTRATIONS) {
    throw new HttpsError("invalid-argument", "Elenco blocchi non valido.");
  }
  if (!Array.isArray(source.couples) || source.couples.length > MAX_REGISTRATIONS / 2) {
    throw new HttpsError("invalid-argument", "Elenco coppie non valido.");
  }
  if (!Number.isInteger(source.revision) || source.revision < 0) {
    throw new HttpsError("invalid-argument", "Revisione del piano non valida.");
  }
  if (typeof source.updatedAt !== "string" || source.updatedAt.length > 50) {
    throw new HttpsError("invalid-argument", "Data di aggiornamento non valida.");
  }

  const rooms = source.rooms.map(parseRoom);
  const assignments = parseIdMap(source.assignments, "Assegnazioni", (roomId) =>
    pathId(roomId, "ID stanza assegnata"),
  );
  const adultGenders = parseIdMap(source.adultGenders, "Sesso staff", (gender) => {
    if (gender !== "male" && gender !== "female") {
      throw new HttpsError("invalid-argument", "Il sesso dello staff deve essere male o female.");
    }
    return gender;
  });
  if (Object.keys(assignments).length > MAX_REGISTRATIONS || Object.keys(adultGenders).length > MAX_REGISTRATIONS) {
    throw new HttpsError("invalid-argument", "Il piano contiene troppi riferimenti a iscrizioni.");
  }

  const lockedIds = source.lockedIds.map((id) => pathId(id, "ID bloccato"));
  if (new Set(lockedIds).size !== lockedIds.length) {
    throw new HttpsError("invalid-argument", "L'elenco dei blocchi contiene duplicati.");
  }
  const couples = source.couples.map((couple, index) => {
    assertExactKeys(couple, ["firstId", "secondId", "confirmed"], `Coppia ${index + 1}`);
    if (typeof couple.confirmed !== "boolean") {
      throw new HttpsError("invalid-argument", `Conferma coppia ${index + 1} non valida.`);
    }
    return {
      firstId: pathId(couple.firstId, `Prima persona coppia ${index + 1}`),
      secondId: pathId(couple.secondId, `Seconda persona coppia ${index + 1}`),
      confirmed: couple.confirmed,
    };
  });
  return {
    rooms,
    assignments: { ...assignments },
    lockedIds,
    adultGenders: { ...adultGenders },
    couples,
    published: source.published === true,
    revision: source.revision,
    updatedAt: source.updatedAt,
  };
}

// Campi stanza da scrivere sull'iscrizione per allinearla al piano, o null se
// è già allineata. Con il piano pubblicato ogni iscrizione assegnata riceve id
// e nome della stanza; con il piano in bozza vengono azzerati solo dove una
// pubblicazione precedente li aveva scritti (un assignedRoomId legacy senza
// nome non viene toccato).
function registrationRoomPatch(registration, plan) {
  const currentId = typeof registration.assignedRoomId === "string" ? registration.assignedRoomId : null;
  const currentName = typeof registration.assignedRoomName === "string" ? registration.assignedRoomName : null;
  if (!plan.published && currentName === null) return null;
  const roomId = plan.published && Object.hasOwn(plan.assignments, registration.id)
    ? plan.assignments[registration.id]
    : undefined;
  const room = roomId ? plan.rooms.find((item) => item.id === roomId) : undefined;
  const assignedRoomId = room ? room.id : null;
  const assignedRoomName = room ? room.name : null;
  if (currentId === assignedRoomId && currentName === assignedRoomName) return null;
  return { assignedRoomId, assignedRoomName };
}

function payloadSize(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch (error) {
    throw new HttpsError("invalid-argument", "Payload non serializzabile.");
  }
}

function referenceDate(activity) {
  const candidate = activity.startDate || activity.startAt || activity.date;
  if (candidate && typeof candidate.toDate === "function") return candidate.toDate();
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) throw new HttpsError("failed-precondition", "L'attività deve avere una data di inizio valida.");
  return typeof candidate === "string" ? candidate : parsed;
}

function assertAuthenticatedAdmin(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Login richiesto.");
  if (request.auth.token?.firebase?.sign_in_provider === "anonymous") {
    throw new HttpsError("permission-denied", "Serve un account amministratore.");
  }
}

function registrationData(snapshot) {
  return snapshot.docs.map((document) => ({ ...document.data(), id: document.id }));
}

function createRoomManagementSaveHandler({ db, clock = () => new Date() } = {}) {
  return async (request) => {
    const firestore = db || getFirestore();
    assertAuthenticatedAdmin(request);
    if (payloadSize(request.data) > MAX_PAYLOAD_BYTES) {
      throw new HttpsError("invalid-argument", "Il piano supera il limite di 900 KiB.");
    }
    assertExactKeys(request.data, ["stakeId", "activityId", "plan", "expectedRevision"], "Richiesta");
    const stakeId = pathId(request.data.stakeId, "stakeId");
    const activityId = pathId(request.data.activityId, "activityId");
    if (!Number.isInteger(request.data.expectedRevision) || request.data.expectedRevision < 0) {
      throw new HttpsError("invalid-argument", "expectedRevision non valida.");
    }
    const incoming = parsePlan(request.data.plan);
    if (incoming.revision !== request.data.expectedRevision) {
      throw new HttpsError("invalid-argument", "La revisione del piano non corrisponde a expectedRevision.");
    }

    const profileRef = firestore.doc(`users/${request.auth.uid}`);
    const activityRef = firestore.doc(`stakes/${stakeId}/activities/${activityId}`);
    const planRef = activityRef.collection("management").doc("rooms");
    const registrationsQuery = activityRef.collection("registrations").limit(MAX_REGISTRATIONS + 1);
    const core = await getCore();

    const savedPlan = await firestore.runTransaction(async (transaction) => {
      const profileSnapshot = await transaction.get(profileRef);
      if (!profileSnapshot.exists) {
        throw new HttpsError("permission-denied", "Profilo utente non trovato.");
      }
      const profile = profileSnapshot.data() || {};
      if (
        (profile.role !== "admin" && profile.role !== "super_admin") ||
        (profile.role !== "super_admin" && profile.stakeId !== stakeId)
      ) throw new HttpsError("permission-denied", "Servono privilegi amministratore per questo palo.");
      const activitySnapshot = await transaction.get(activityRef);
      if (!activitySnapshot.exists) throw new HttpsError("not-found", "Attività non trovata.");
      const activity = activitySnapshot.data() || {};
      if (activity.overnight !== true) {
        throw new HttpsError("failed-precondition", "Il piano stanze è disponibile solo per attività con pernottamento.");
      }
      const currentSnapshot = await transaction.get(planRef);
      const registrationsSnapshot = await transaction.get(registrationsQuery);
      if (registrationsSnapshot.size > MAX_REGISTRATIONS) {
        throw new HttpsError("resource-exhausted", `Sono supportate al massimo ${MAX_REGISTRATIONS} iscrizioni.`);
      }
      const currentRevision = currentSnapshot.exists && Number.isInteger(currentSnapshot.data()?.revision)
        ? currentSnapshot.data().revision
        : 0;
      if (currentRevision !== request.data.expectedRevision) {
        throw new HttpsError("aborted", "Il piano è stato modificato da un altro amministratore. Ricaricalo e riprova.");
      }

      const registrations = registrationData(registrationsSnapshot);
      const errors = core.validateRoomPlan(incoming, registrations, referenceDate(activity));
      if (errors.length) {
        throw new HttpsError("invalid-argument", errors.slice(0, 20).join(" "), {
          errors: errors.slice(0, 50),
        });
      }
      const updatedAt = clock().toISOString();
      const next = { ...incoming, revision: currentRevision + 1, updatedAt };
      transaction.set(planRef, { ...next, savedAt: FieldValue.serverTimestamp() });
      // Stanze comunicate ai partecipanti nella stessa transazione del piano:
      // piano e iscrizioni non possono divergere. Le rules bloccano queste
      // chiavi al client, quindi l'unico scrittore è questa callable.
      let synced = 0;
      for (const document of registrationsSnapshot.docs) {
        const patch = registrationRoomPatch({ ...document.data(), id: document.id }, next);
        if (!patch) continue;
        transaction.update(document.ref, patch);
        synced += 1;
      }
      return { plan: next, synced };
    });

    logger.info("Room management saved.", {
      stakeId,
      activityId,
      uid: request.auth.uid,
      rooms: savedPlan.plan.rooms.length,
      assignments: Object.keys(savedPlan.plan.assignments).length,
      published: savedPlan.plan.published,
      registrationsSynced: savedPlan.synced,
      revision: savedPlan.plan.revision,
    });
    return { plan: savedPlan.plan };
  };
}

function cleanupRegistrationReferences(plan, registrationId, updatedAt) {
  if (!ownObject(plan)) return null;
  const assignments = { ...(ownObject(plan.assignments) ? plan.assignments : {}) };
  const adultGenders = { ...(ownObject(plan.adultGenders) ? plan.adultGenders : {}) };
  const hadAssignment = Object.hasOwn(assignments, registrationId);
  const hadGender = Object.hasOwn(adultGenders, registrationId);
  let lockedIds = (Array.isArray(plan.lockedIds) ? plan.lockedIds : []).filter((id) => id !== registrationId);
  for (const pair of Array.isArray(plan.couples) ? plan.couples : []) {
    if (pair?.firstId !== registrationId && pair?.secondId !== registrationId) continue;
    const partnerId = pair.firstId === registrationId ? pair.secondId : pair.firstId;
    if (plan.rooms?.some((room) => room.id === assignments[partnerId] && room.category === "couple")) {
      delete assignments[partnerId];
      lockedIds = lockedIds.filter((id) => id !== partnerId);
    }
  }
  const couples = (Array.isArray(plan.couples) ? plan.couples : []).filter(
    (couple) => couple?.firstId !== registrationId && couple?.secondId !== registrationId,
  );
  delete assignments[registrationId];
  delete adultGenders[registrationId];
  const changed = hadAssignment || hadGender || lockedIds.length !== (plan.lockedIds || []).length || couples.length !== (plan.couples || []).length;
  if (!changed) return null;
  return {
    assignments,
    adultGenders,
    lockedIds,
    couples,
    revision: (Number.isInteger(plan.revision) ? plan.revision : 0) + 1,
    updatedAt,
  };
}

async function cleanupDeletedRegistration(db, { stakeId, activityId, registrationId }, clock = () => new Date()) {
  const planRef = db.doc(`stakes/${stakeId}/activities/${activityId}/management/rooms`);
  return db.runTransaction(async (transaction) => {
    const registrationRef = db.doc(`stakes/${stakeId}/activities/${activityId}/registrations/${registrationId}`);
    if ((await transaction.get(registrationRef)).exists) return false;
    const snapshot = await transaction.get(planRef);
    if (!snapshot.exists) return false;
    const patch = cleanupRegistrationReferences(snapshot.data(), registrationId, clock().toISOString());
    if (!patch) return false;
    transaction.update(planRef, { ...patch, savedAt: FieldValue.serverTimestamp() });
    return true;
  });
}

const roomManagementSave = onCall(
  { region: REGION, timeoutSeconds: 60, memory: "512MiB" },
  createRoomManagementSaveHandler(),
);

const onRoomRegistrationDeleted = onDocumentDeleted(
  {
    document: "stakes/{stakeId}/activities/{activityId}/registrations/{registrationId}",
    region: REGION,
  },
  async (event) => {
    const changed = await cleanupDeletedRegistration(getFirestore(), event.params);
    if (changed) logger.info("Deleted registration removed from room plan.", event.params);
  },
);

const onRoomActivityDeleted = onDocumentDeleted(
  {
    document: "stakes/{stakeId}/activities/{activityId}",
    region: REGION,
  },
  async (event) => {
    const db = getFirestore();
    const activityRef = db.doc(`stakes/${event.params.stakeId}/activities/${event.params.activityId}`);
    await db.runTransaction(async (transaction) => {
      if (!(await transaction.get(activityRef)).exists) transaction.delete(activityRef.collection("management").doc("rooms"));
    });
  },
);

module.exports = {
  roomManagementSave,
  onRoomRegistrationDeleted,
  onRoomActivityDeleted,
  createRoomManagementSaveHandler,
  cleanupRegistrationReferences,
  cleanupDeletedRegistration,
  parsePlan,
  registrationRoomPatch,
};
