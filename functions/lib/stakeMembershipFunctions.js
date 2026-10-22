// Appartenenza al palo (S2), parte server: callable `stakeMembership` (coda
// "Richieste di accesso", uscite, rimozioni, "Annulla") e trigger su
// `users/{uid}` che tiene `stakes/{s}/members/{uid}` allineato al ruolo e al
// palo scelto. Interfaccia e contratto: docs/APPARTENENZA_AL_PALO.md,
// «Contratto di autorizzazione» e «Callable e trigger: interfaccia».
//
// Ogni azione è una transazione che rilegge tutto (members, profili, elenchi)
// e ricalcola l'esito da lì: due chiamate insieme, un evento doppio o fuori
// ordine non cambiano il risultato. Le parti pure stanno in stakeMembership.js.

const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const logger = require("firebase-functions/logger");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");

const core = require("./stakeMembership");
const { runTransactionWithRetry } = require("./transactionRetry");

const REGION = "europe-west1";
// Elenchi dello staff scelti da un admin per attività: chi viene rimosso o
// bloccato ne esce (docs/APPARTENENZA_AL_PALO.md, contratto).
const STAFF_LIST_DOCS = Object.freeze(["campStaff", "recordNight"]);
const STAFF_PROFILE_ROLES = Object.freeze(["admin", "unit_leader", "super_admin"]);
// Stesso tetto degli elenchi di campeggio e Notte dei Record (MAX_STAFF).
const MAX_STAFF_LIST = 100;
// Nota "stesso nome e data": profili letti al massimo per una richiesta.
const MAX_NOTE_CANDIDATES = 30;
// Promemoria agli admin: richieste in coda da più di 48 ore.
const QUEUE_REMINDER_AFTER_MS = 48 * 60 * 60 * 1000;

function cleanId(value, field) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > 128 || text.includes("/")) {
    throw new HttpsError("invalid-argument", `${field} non valido.`);
  }
  return text;
}

function precondition(reason, message, extra = {}) {
  return new HttpsError("failed-precondition", message, { reason, ...extra });
}

function invalidState(status) {
  return precondition("invalid_state", "Questa azione non vale per lo stato attuale.", { status: status ?? null });
}

function denied(message = "Non puoi farlo per questa persona.") {
  return new HttpsError("permission-denied", message);
}

function memberRef(db, stakeId, uid) {
  return db.doc(`stakes/${stakeId}/members/${uid}`);
}

async function listStakeIds(db) {
  const snap = await db.collection("stakes").select().get();
  return snap.docs.map((doc) => doc.id);
}

function isAnonymousAuthUser(user) {
  return !user.email && !user.phoneNumber && (!Array.isArray(user.providerData) || user.providerData.length === 0);
}

/**
 * Contesto per chi approva (`registrationHints`): attività del palo con
 * un'iscrizione inviata e non chiusa della persona, propria, di un figlio o
 * da ospite. Solo un aiuto: se una lettura fallisce la richiesta parte senza.
 */
async function computeRegistrationHints(db, stakeId, uid) {
  try {
    const activities = await db.collection(`stakes/${stakeId}/activities`).select("title").get();
    const titles = new Map(activities.docs.map((doc) => [doc.id, doc.get("title")]));
    const ownRefs = activities.docs.map((doc) => doc.ref.collection("registrations").doc(`user_${uid}`));
    const [own, children, guests] = await Promise.all([
      ownRefs.length ? db.getAll(...ownRefs) : [],
      db.collectionGroup("registrations").where("parentUid", "==", uid).get(),
      db.collectionGroup("registrations").where("anonymousUid", "==", uid).get(),
    ]);
    const prefix = `stakes/${stakeId}/activities/`;
    const registrations = [...own.filter((snap) => snap.exists), ...children.docs, ...guests.docs]
      .filter((snap) => snap.ref.path.startsWith(prefix))
      .map((snap) => ({ ...snap.data(), activityId: snap.ref.parent.parent.id }))
      .filter(core.isLiveRegistration);
    return core.buildRegistrationHints(registrations, titles);
  } catch (error) {
    logger.warn("Contesto della richiesta non calcolato.", {
      stakeId,
      detail: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function staffNoteRef(db, stakeId, uid) {
  return memberRef(db, stakeId, uid).collection("staff").doc("note");
}

/**
 * Nota dello staff "stesso nome e data di un membro attivo" (fase 3): membri
 * attivi del palo con lo stesso anno, poi i loro profili. Restituisce la nota,
 * `null` se non c'è corrispondenza, `undefined` se la lettura fallisce (la
 * richiesta parte senza toccare la nota).
 */
async function computeStaffNote(db, stakeId, uid, profile) {
  try {
    const year = core.birthYearOf(profile && profile.birthDate);
    if (!year || !core.personNameOf(profile)) return null;
    const actives = await db
      .collection(`stakes/${stakeId}/members`)
      .where("status", "==", "active")
      .where("birthYear", "==", year)
      .select()
      .limit(MAX_NOTE_CANDIDATES + 1)
      .get();
    const uids = actives.docs.map((doc) => doc.id).filter((id) => id !== uid).slice(0, MAX_NOTE_CANDIDATES);
    if (!uids.length) return null;
    const profiles = await db.getAll(...uids.map((id) => db.doc(`users/${id}`)));
    const matches = profiles.filter((snap) => snap.exists && core.isSameNameAndBirth(profile, snap.data())).length;
    return matches ? { kind: "same_name_birth", matches } : null;
  } catch (error) {
    logger.warn("Nota dello staff non calcolata.", {
      stakeId,
      detail: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

// Dentro la transazione che apre la richiesta. C'è un solo tipo di nota, quindi
// senza corrispondenze, o se il confronto non è riuscito, il documento si
// cancella: una richiesta riaperta non si porta mai dietro una nota vecchia.
function writeStaffNote(tx, db, stakeId, uid, note) {
  const ref = staffNoteRef(db, stakeId, uid);
  if (note) tx.set(ref, { ...note, at: FieldValue.serverTimestamp() });
  else tx.delete(ref);
}

function newMemberDoc({ status, profile, sources, staffRole, hints, decidedBy }) {
  const active = status === "active";
  return {
    status,
    sources,
    previous: null,
    staffRole,
    ...core.requestFieldsFromProfile(profile),
    registrationHints: hints || [],
    reviewNeeded: false,
    requestedAt: FieldValue.serverTimestamp(),
    decidedAt: active ? FieldValue.serverTimestamp() : null,
    decidedBy: active ? decidedBy : null,
    declineCount: 0,
  };
}

function roleSource(nowMs) {
  return { kind: "staff_approval", ref: "role", at: Timestamp.fromMillis(nowMs) };
}

// Un motivo per `kind` e `ref`: rientrare o essere riapprovati dalla stessa
// persona non lo ripete.
function withSource(sources, source) {
  const list = Array.isArray(sources) ? sources : [];
  return list.some((item) => item && item.kind === source.kind && item.ref === source.ref) ? list : [...list, source];
}

// Stato di prima per "Annulla" e "Riattiva": in un documento dello staff, non
// sul documento members che il richiedente legge (ultima azione e uid di chi
// l'ha fatta restano interni; docs/APPARTENENZA_AL_PALO.md, «Cosa legge il
// richiedente»).
function previousRefOf(ref) {
  return ref.collection("staff").doc("previous");
}

// Documento members con il suo stato di prima: dal documento dello staff, o dal
// campo vecchio sul documento members (scritture di prima del 2026-10-22).
function withPrevious(memberSnap, previousSnap) {
  if (!memberSnap || !memberSnap.exists) return null;
  const data = memberSnap.data();
  const previous = previousSnap && previousSnap.exists ? previousSnap.data() : data.previous ?? null;
  return { ...data, previous };
}

/**
 * Scrive il documento members e la riga di storia. Su un documento esistente
 * salva in `staff/previous` lo stato di prima (per "Annulla"), salvo `previous`
 * esplicito nel patch (null lo cancella); sul documento members `previous`
 * resta null. `version` sale di uno. Restituisce la nuova versione.
 */
function writeMember(
  tx,
  ref,
  current,
  patch,
  { action, by, nowMs, role = null, staffLists = null, moved = null, historyAction = action },
) {
  const version = (current ? Number(current.version || 0) : 0) + 1;
  const { previous: explicit, ...fields } = patch;
  const previous = !current
    ? null
    : "previous" in patch
      ? explicit
      : core.previousOf(current, { action, by, at: Timestamp.fromMillis(nowMs), role, staffLists, moved });
  if (!current) tx.set(ref, { ...fields, previous: null, version });
  else tx.update(ref, { ...fields, previous: null, version });
  if (previous) tx.set(previousRefOf(ref), previous);
  else tx.delete(previousRefOf(ref));
  tx.set(ref.collection("history").doc(), {
    action: historyAction,
    by,
    at: FieldValue.serverTimestamp(),
    fromStatus: current ? current.status ?? null : null,
    toStatus: patch.status ?? (current ? current.status ?? null : null),
    version,
  });
  return version;
}

// ---------------------------------------------------------------------------
// Letture dentro la transazione (sempre prima di ogni scrittura)
// ---------------------------------------------------------------------------

async function readDocs(tx, refs) {
  if (!refs.length) return [];
  const unique = [...new Map(refs.map((ref) => [ref.path, ref])).values()];
  const snaps = await tx.getAll(...unique);
  const byPath = new Map(snaps.map((snap) => [snap.ref.path, snap]));
  return refs.map((ref) => byPath.get(ref.path));
}

// L'ultimo admin del palo non esce, non si rimuove, non si blocca: altrimenti
// nessuno potrebbe più gestire il palo.
async function assertNotLastAdmin(tx, db, stakeId, uid) {
  const admins = await tx.get(db.collection("users").where("stakeId", "==", stakeId).where("role", "==", "admin"));
  if (!admins.docs.some((doc) => doc.id !== uid)) {
    throw precondition("last_admin", "È l'ultimo admin del palo: prima nominane un altro.");
  }
}

async function readStaffLists(tx, db, stakeId) {
  const activities = await tx.get(db.collection(`stakes/${stakeId}/activities`).select());
  const refs = [];
  for (const activity of activities.docs) {
    for (const docId of STAFF_LIST_DOCS) refs.push(activity.ref.collection("management").doc(docId));
  }
  return readDocs(tx, refs);
}

function staffUidsOf(data) {
  return data && Array.isArray(data.staffUids) ? data.staffUids.filter((item) => typeof item === "string" && item) : [];
}

function removeFromStaffLists(tx, listSnaps, uid, by, nowMs) {
  const removed = [];
  for (const snap of listSnaps) {
    if (!snap || !snap.exists) continue;
    const current = staffUidsOf(snap.data());
    if (!current.includes(uid)) continue;
    const updatedAt = new Date(nowMs).toISOString();
    tx.update(snap.ref, { staffUids: current.filter((item) => item !== uid), updatedAt, updatedBy: by });
    // `updatedAt` lasciato qui: "Annulla" rimette l'uid solo se nessuno ha
    // toccato l'elenco nel frattempo.
    removed.push({ activityId: snap.ref.parent.parent.id, doc: snap.id, updatedAt });
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Callable
// ---------------------------------------------------------------------------

function parseRequest(data, callerUid) {
  const input = data && typeof data === "object" ? data : {};
  const action = input.action;
  if (!core.ACTIONS.includes(action)) throw new HttpsError("invalid-argument", "Azione non valida.");
  const stakeId = cleanId(input.stakeId, "stakeId");
  let uid;
  if (core.SELF_ACTIONS.includes(action)) {
    if (input.uid !== undefined && input.uid !== null && input.uid !== callerUid) {
      throw denied("Puoi chiedere, ritirare o uscire solo per te.");
    }
    uid = callerUid;
  } else {
    uid = cleanId(input.uid, "uid");
  }
  let version = null;
  if (action === "undo") {
    if (!Number.isInteger(input.version) || input.version < 1) {
      throw new HttpsError("invalid-argument", "version non valida.");
    }
    version = input.version;
  }
  return { action, stakeId, uid, version };
}

// Uscita dello staff dal palo: il ruolo del palo torna `participant` nella
// stessa transazione, così ruolo e appartenenza non divergono. Restituisce il
// cambio di ruolo per `previous` (o null) e lo scrive.
function demoteStaff(tx, db, uid, profile, stakeId, nowMs) {
  if (!core.isDemotableStaffOf(profile, stakeId)) return null;
  tx.update(db.doc(`users/${uid}`), { role: "participant", updatedAt: new Date(nowMs).toISOString() });
  return { before: profile.role, after: "participant", unitId: typeof profile.unitId === "string" ? profile.unitId : "" };
}

async function actionRequest(ctx) {
  const { tx, db, stakeId, uid, member, targetProfile: profile, stakeIds, hints, note, nowMs } = ctx;
  if (!profile) throw precondition("profile_incomplete", "Completa il profilo prima di chiedere di entrare.");
  if (profile.stakeId !== stakeId) {
    throw precondition("stake_not_chosen", "Scegli prima questo palo nel profilo.");
  }
  const staffRole = core.staffRoleForStake(profile, stakeId);
  // Lo staff segue la regola 1 del trigger, che non chiede il profilo
  // completo (gli admin migrati possono non avere un'unità).
  if (!staffRole && core.needsProfileCompletion(profile)) {
    throw precondition("profile_incomplete", "Completa il profilo prima di chiedere di entrare.");
  }
  const otherRefs = stakeIds.filter((id) => id !== stakeId).map((id) => memberRef(db, id, uid));
  const others = await readDocs(tx, otherRefs);
  const ref = memberRef(db, stakeId, uid);

  let status;
  let version;
  if (staffRole && member?.status !== "removed" && member?.status !== "blocked") {
    // Un ruolo staff vuol dire che un admin conosce già la persona: come il
    // trigger, la richiesta diventa subito appartenenza attiva (anche dopo
    // un'uscita: il super admin, che tiene il ruolo, rientra così).
    if (member && member.status === "active" && member.staffRole === staffRole && member.reviewNeeded !== true) {
      return { status: "active", version: member.version, changed: false };
    }
    status = "active";
    const patch = { status, staffRole, reviewNeeded: false };
    if (member && member.status !== "active") {
      patch.sources = withSource(member.sources, roleSource(nowMs));
      patch.decidedAt = FieldValue.serverTimestamp();
      patch.decidedBy = "system";
      if (member.movedToStakeId) patch.movedToStakeId = FieldValue.delete();
    }
    version = member
      ? writeMember(tx, ref, member, patch, { action: "request", by: uid, nowMs })
      : writeMember(tx, ref, null, newMemberDoc({ status, profile, sources: [roleSource(nowMs)], staffRole, hints, decidedBy: "system" }), {
          action: "request",
          by: uid,
          nowMs,
        });
  } else if (member && (member.status === "pending" || member.status === "active")) {
    return { status: member.status, version: member.version, changed: false };
  } else {
    const block = core.requestBlockOf(member, nowMs);
    if (block) {
      if (block.reason === "invalid_state") throw invalidState(member.status);
      if (block.reason === "too_many_declines") {
        throw precondition("too_many_declines", "Per entrare ora serve il codice di un dirigente.");
      }
      throw precondition("cooldown", "Potrai chiedere di nuovo tra qualche giorno.", { retryAt: block.retryAt });
    }
    status = "pending";
    const fields = {
      ...core.requestFieldsFromProfile(profile),
      registrationHints: hints || [],
      reviewNeeded: false,
      requestedAt: FieldValue.serverTimestamp(),
      decidedAt: null,
      decidedBy: null,
    };
    version = member
      ? writeMember(tx, ref, member, {
          status,
          staffRole: null,
          ...fields,
          ...(member.movedToStakeId ? { movedToStakeId: FieldValue.delete() } : {}),
        }, { action: "request", by: uid, nowMs })
      : writeMember(tx, ref, null, newMemberDoc({ status, profile, sources: [], staffRole: null, hints }), {
          action: "request",
          by: uid,
          nowMs,
        });
    writeStaffNote(tx, db, stakeId, uid, note);
  }
  // Una richiesta aperta alla volta: quella del palo scelto.
  others.forEach((snap) => {
    if (!snap.exists || snap.data().status !== "pending") return;
    writeMember(tx, snap.ref, snap.data(), {
      status: "withdrawn",
      decidedAt: FieldValue.serverTimestamp(),
      decidedBy: uid,
    }, { action: "request", by: uid, nowMs });
  });
  return { status, version, changed: true };
}

async function actionWithdraw({ tx, db, stakeId, uid, member, nowMs }) {
  if (member && member.status === "withdrawn") return { status: "withdrawn", version: member.version, changed: false };
  if (!member || member.status !== "pending") throw invalidState(member?.status);
  const version = writeMember(tx, memberRef(db, stakeId, uid), member, {
    status: "withdrawn",
    decidedAt: FieldValue.serverTimestamp(),
    decidedBy: uid,
  }, { action: "withdraw", by: uid, nowMs });
  return { status: "withdrawn", version, changed: true };
}

async function actionLeave({ tx, db, stakeId, uid, member, targetProfile, nowMs }) {
  if (member && member.status === "withdrawn") return { status: "withdrawn", version: member.version, changed: false };
  if (!member || member.status !== "active") throw invalidState(member?.status);
  if (core.isAdminOf(targetProfile, stakeId)) await assertNotLastAdmin(tx, db, stakeId, uid);
  const role = demoteStaff(tx, db, uid, targetProfile, stakeId, nowMs);
  const version = writeMember(tx, memberRef(db, stakeId, uid), member, {
    status: "withdrawn",
    staffRole: null,
    decidedAt: FieldValue.serverTimestamp(),
    decidedBy: uid,
  }, { action: "leave", by: uid, nowMs, role });
  return { status: "withdrawn", version, changed: true };
}

// Azioni dello staff su una persona: chi può, su chi, da quale stato.
function authorizeStaff(ctx) {
  const { action, uid, callerUid, authority, member, targetProfile } = ctx;
  if (!authority) throw denied("Solo lo staff del palo può farlo.");
  if (uid === callerUid) throw denied("Non puoi farlo su te stesso.");
  if (action !== "undo") {
    const allowed = authority.level === "admin" ? core.ADMIN_ACTIONS : core.UNIT_LEADER_ACTIONS;
    if (!allowed.includes(action)) throw denied("Solo un admin del palo può farlo.");
  }
  if (!member) {
    if (authority.level === "unit_leader") throw denied();
    throw new HttpsError("not-found", "Questa persona non ha chiesto di entrare nel palo.");
  }
  if (authority.level === "unit_leader") {
    if (action !== "undo" && (!authority.unitId || member.claimedUnitId !== authority.unitId)) {
      throw denied("Questa persona non ha dichiarato la tua unità.");
    }
    if (targetProfile && STAFF_PROFILE_ROLES.includes(targetProfile.role)) throw denied("Le persone dello staff le gestisce un admin.");
  }
  if (!authority.superAdmin && targetProfile && targetProfile.role === "super_admin") throw denied();
}

function decided(callerUid) {
  return { decidedAt: FieldValue.serverTimestamp(), decidedBy: callerUid };
}

async function actionApprove(ctx) {
  const { tx, db, stakeId, uid, callerUid, member, targetProfile, stakeIds, nowMs } = ctx;
  if (member.status === "active") return { status: "active", version: member.version, changed: false };
  if (member.status !== "pending") throw invalidState(member.status);
  const others = await readDocs(
    tx,
    stakeIds.filter((id) => id !== stakeId).map((id) => memberRef(db, id, uid)),
  );
  // Cambio di palo: la vecchia appartenenza resta finché la nuova non è
  // attiva, poi passa a `withdrawn` nello stesso momento.
  const moved = [];
  others.forEach((snap) => {
    if (!snap.exists || snap.data().status !== "active") return;
    const version = writeMember(tx, snap.ref, snap.data(), {
      status: "withdrawn",
      staffRole: null,
      movedToStakeId: stakeId,
      decidedAt: FieldValue.serverTimestamp(),
      decidedBy: callerUid,
    }, { action: "moved", by: callerUid, nowMs });
    moved.push({ stakeId: snap.ref.parent.parent.id, version });
  });
  const version = writeMember(tx, memberRef(db, stakeId, uid), member, {
    status: "active",
    staffRole: core.staffRoleForStake(targetProfile, stakeId),
    reviewNeeded: false,
    sources: withSource(member.sources, { kind: "staff_approval", ref: callerUid, at: Timestamp.fromMillis(nowMs) }),
    ...decided(callerUid),
  }, { action: "approve", by: callerUid, nowMs, moved });
  return { status: "active", version, changed: true };
}

// Rifiuto, "Non lo conosco", rimozione e blocco: escono dall'appartenenza (o
// la sospendono). Chi ha un ruolo staff del palo torna `participant`.
async function exitTransition(ctx, { action, status, extra = {}, staffLists = false, historyAction = action }) {
  const { tx, db, stakeId, uid, callerUid, member, targetProfile, nowMs } = ctx;
  if (core.isAdminOf(targetProfile, stakeId)) await assertNotLastAdmin(tx, db, stakeId, uid);
  const listSnaps = staffLists ? await readStaffLists(tx, db, stakeId) : [];
  const role = demoteStaff(tx, db, uid, targetProfile, stakeId, nowMs);
  const removedFrom = removeFromStaffLists(tx, listSnaps, uid, callerUid, nowMs);
  const version = writeMember(tx, memberRef(db, stakeId, uid), member, {
    status,
    staffRole: null,
    ...extra,
    ...decided(callerUid),
  }, { action, by: callerUid, nowMs, role, staffLists: removedFrom, historyAction });
  return { status, version, changed: true };
}

async function actionDecline(ctx) {
  const { member } = ctx;
  if (member.status === "declined") return { status: "declined", version: member.version, changed: false };
  if (member.status !== "pending") throw invalidState(member.status);
  return exitTransition(ctx, {
    action: "decline",
    status: "declined",
    extra: { declineCount: Number(member.declineCount || 0) + 1 },
  });
}

// "Ha già un account": per chi l'ha chiesto è un rifiuto e basta. Il
// richiedente legge `previous` del proprio documento, quindi lì l'azione resta
// `decline`; il motivo vive solo nella storia, che nessuna rule apre.
async function actionHasAccount(ctx) {
  const { member } = ctx;
  if (member.status === "declined") return { status: "declined", version: member.version, changed: false };
  if (member.status !== "pending") throw invalidState(member.status);
  return exitTransition(ctx, {
    action: "decline",
    historyAction: "hasAccount",
    status: "declined",
    extra: { declineCount: Number(member.declineCount || 0) + 1 },
  });
}

async function actionNotMyUnit({ tx, db, stakeId, uid, callerUid, member, nowMs }) {
  if (member.status !== "pending") throw invalidState(member.status);
  const version = writeMember(tx, memberRef(db, stakeId, uid), member, { claimedUnitId: "" }, {
    action: "notMyUnit",
    by: callerUid,
    nowMs,
  });
  return { status: "pending", version, changed: true };
}

async function actionConfirmKnown({ tx, db, stakeId, uid, callerUid, member, nowMs }) {
  if (member.status !== "active") throw invalidState(member.status);
  if (member.reviewNeeded !== true) return { status: "active", version: member.version, changed: false };
  const version = writeMember(tx, memberRef(db, stakeId, uid), member, { reviewNeeded: false }, {
    action: "confirmKnown",
    by: callerUid,
    nowMs,
  });
  return { status: "active", version, changed: true };
}

// "Non lo conosco" su un membro migrato da confermare: accesso sospeso. Dal
// dirigente la richiesta passa agli admin (unità svuotata, come "Non è della
// mia unità"), così non se la ritrova come richiesta della sua unità; dall'admin
// resta dov'è (scelta S2-3). "Annulla" rimette l'unità da `previous`.
async function actionMarkUnknown(ctx) {
  const { member, authority } = ctx;
  if (member.status === "pending") return { status: "pending", version: member.version, changed: false };
  if (member.status !== "active" || member.reviewNeeded !== true) throw invalidState(member.status);
  const extra = { reviewNeeded: false };
  if (authority && authority.level === "unit_leader") extra.claimedUnitId = "";
  return exitTransition(ctx, { action: "markUnknown", status: "pending", extra });
}

async function actionRemove(ctx) {
  const { member } = ctx;
  if (member.status === "removed") return { status: "removed", version: member.version, changed: false };
  if (member.status !== "active") throw invalidState(member.status);
  return exitTransition(ctx, { action: "remove", status: "removed", staffLists: true });
}

async function actionBlock(ctx) {
  const { member } = ctx;
  if (member.status === "blocked") return { status: "blocked", version: member.version, changed: false };
  return exitTransition(ctx, { action: "block", status: "blocked", staffLists: true });
}

async function actionUnblock({ tx, db, stakeId, uid, callerUid, member, nowMs }) {
  if (member.status === "pending") return { status: "pending", version: member.version, changed: false };
  if (member.status !== "blocked") throw invalidState(member.status);
  // Sbloccare non è riattivare: la persona va riverificata.
  const version = writeMember(tx, memberRef(db, stakeId, uid), member, {
    status: "pending",
    staffRole: null,
    reviewNeeded: false,
    ...decided(callerUid),
  }, { action: "unblock", by: callerUid, nowMs });
  return { status: "pending", version, changed: true };
}

// Ruolo da rimettere quando un'azione si annulla o si riattiva: solo se il
// profilo ha ancora il ruolo lasciato da quell'azione, e un ruolo staff solo
// se il palo scelto è ancora questo (altrimenti darebbe poteri su un altro).
function restorableRole(previous, profile, stakeId) {
  if (!previous || typeof previous.role !== "string" || !profile || profile.role !== previous.roleAfter) return null;
  const staff = previous.role === "admin" || previous.role === "unit_leader";
  if (staff && profile.stakeId !== stakeId) return null;
  // Senza l'unità registrata non si sa dove valeva il ruolo: non torna.
  if (previous.role === "unit_leader" && (typeof previous.roleUnitId !== "string" || (profile.unitId || "") !== previous.roleUnitId)) {
    return null;
  }
  return previous.role;
}

function staffRoleAfter(status, profile, role, stakeId) {
  if (status !== "active") return null;
  return core.staffRoleForStake(profile ? { ...profile, role } : null, stakeId);
}

async function actionReactivate({ tx, db, stakeId, uid, callerUid, member, targetProfile, nowMs }) {
  if (member.status === "active") return { status: "active", version: member.version, changed: false };
  if (member.status !== "removed") throw invalidState(member.status);
  const prev = member.previous;
  const fromRemove = prev && prev.action === "remove" && prev.status === "active";
  const nextRole = fromRemove ? restorableRole(prev, targetProfile, stakeId) : null;
  if (nextRole && nextRole !== targetProfile.role) {
    tx.update(db.doc(`users/${uid}`), { role: nextRole, updatedAt: new Date(nowMs).toISOString() });
  }
  const role = nextRole && nextRole !== targetProfile.role ? { before: targetProfile.role, after: nextRole } : null;
  const finalRole = nextRole || (targetProfile ? targetProfile.role : null);
  const patch = {
    status: "active",
    staffRole: staffRoleAfter("active", targetProfile, finalRole, stakeId),
    ...decided(callerUid),
  };
  if (fromRemove) {
    patch.sources = prev.sources || member.sources || [];
    patch.reviewNeeded = prev.reviewNeeded === true;
    patch.claimedUnitId = prev.claimedUnitId ?? member.claimedUnitId ?? "";
    patch.claimedUnitName = prev.claimedUnitName ?? member.claimedUnitName ?? "";
  }
  const version = writeMember(tx, memberRef(db, stakeId, uid), member, patch, {
    action: "reactivate",
    by: callerUid,
    nowMs,
    role,
  });
  return { status: "active", version, changed: true };
}

async function actionUndo(ctx) {
  const { tx, db, stakeId, uid, callerUid, member, targetProfile, authority, version: seen, nowMs } = ctx;
  if (Number(member.version || 0) !== seen) {
    throw precondition("version_conflict", "Nel frattempo qualcuno ha cambiato questa persona.");
  }
  const prev = member.previous;
  const verdict = core.canUndo(prev, authority, callerUid);
  if (verdict === "nothing") throw precondition("nothing_to_undo", "Non c'è niente da annullare.");
  if (verdict === "denied") throw denied("Puoi annullare solo le tue azioni.");

  const restoredStatus = prev.status;
  const nextRole = restorableRole(prev, targetProfile, stakeId);
  const demotesAdmin = nextRole && core.isAdminOf(targetProfile, stakeId) && nextRole !== "admin";
  // Letture prima delle scritture: ultimo admin, elenchi, appartenenze spostate.
  if (demotesAdmin) await assertNotLastAdmin(tx, db, stakeId, uid);
  const listRefs = (prev.staffLists || []).map((item) =>
    db.doc(`stakes/${stakeId}/activities/${item.activityId}/management/${item.doc}`),
  );
  const listSnaps = await readDocs(tx, listRefs);
  const movedRefs = (prev.moved || []).map((item) => memberRef(db, item.stakeId, uid));
  const movedSnaps = await readDocs(tx, movedRefs);
  const movedPreviousSnaps = await readDocs(tx, movedRefs.map(previousRefOf));

  if (nextRole && nextRole !== targetProfile.role) {
    tx.update(db.doc(`users/${uid}`), { role: nextRole, updatedAt: new Date(nowMs).toISOString() });
  }
  const finalRole = nextRole || (targetProfile ? targetProfile.role : null);
  listSnaps.forEach((snap, index) => {
    if (!snap.exists) return;
    const data = snap.data();
    if (data.updatedAt !== prev.staffLists[index].updatedAt) return; // cambiato nel frattempo
    const current = staffUidsOf(data);
    if (current.includes(uid) || current.length >= MAX_STAFF_LIST) return;
    tx.update(snap.ref, {
      staffUids: [...current, uid].sort(),
      updatedAt: new Date(nowMs).toISOString(),
      updatedBy: callerUid,
    });
  });
  movedSnaps.forEach((snap, index) => {
    const recorded = prev.moved[index];
    if (!snap.exists || Number(snap.data().version || 0) !== recorded.version) return;
    const other = withPrevious(snap, movedPreviousSnaps[index]);
    const otherPrev = other.previous;
    if (!otherPrev || otherPrev.action !== "moved") return;
    const restore = { previous: null, movedToStakeId: FieldValue.delete() };
    for (const field of core.PREVIOUS_FIELDS) restore[field] = otherPrev[field] ?? null;
    // Il ruolo staff vale solo nel palo scelto: lì non si ricopia da `previous`.
    restore.staffRole = staffRoleAfter(otherPrev.status, targetProfile, finalRole, recorded.stakeId);
    writeMember(tx, snap.ref, other, restore, { action: "undo", by: callerUid, nowMs });
  });

  const restore = { previous: null };
  for (const field of core.PREVIOUS_FIELDS) restore[field] = prev[field] ?? null;
  restore.declineCount = Number(prev.declineCount || 0);
  restore.reviewNeeded = prev.reviewNeeded === true;
  restore.sources = prev.sources || [];
  restore.claimedUnitId = prev.claimedUnitId ?? "";
  restore.claimedUnitName = prev.claimedUnitName ?? "";
  restore.staffRole = staffRoleAfter(restoredStatus, targetProfile, finalRole, stakeId);
  const version = writeMember(tx, memberRef(db, stakeId, uid), member, restore, {
    action: "undo",
    by: callerUid,
    nowMs,
  });
  return { status: restoredStatus, version, changed: true, undone: prev.action };
}

const ACTION_HANDLERS = Object.freeze({
  request: actionRequest,
  withdraw: actionWithdraw,
  leave: actionLeave,
  approve: actionApprove,
  decline: actionDecline,
  hasAccount: actionHasAccount,
  notMyUnit: actionNotMyUnit,
  confirmKnown: actionConfirmKnown,
  markUnknown: actionMarkUnknown,
  remove: actionRemove,
  block: actionBlock,
  unblock: actionUnblock,
  reactivate: actionReactivate,
  undo: actionUndo,
});

async function runAction(tx, db, input) {
  const { action, stakeId, uid, callerUid } = input;
  const ref = memberRef(db, stakeId, uid);
  const [callerSnap, targetSnap, memberSnap, previousSnap] = await readDocs(tx, [
    db.doc(`users/${callerUid}`),
    db.doc(`users/${uid}`),
    ref,
    previousRefOf(ref),
  ]);
  const ctx = {
    ...input,
    tx,
    db,
    callerProfile: callerSnap.exists ? callerSnap.data() : null,
    targetProfile: targetSnap.exists ? targetSnap.data() : null,
    member: withPrevious(memberSnap, previousSnap),
  };
  if (!core.SELF_ACTIONS.includes(action)) {
    ctx.authority = core.staffAuthorityOf(ctx.callerProfile, stakeId);
    authorizeStaff(ctx);
  }
  return ACTION_HANDLERS[action](ctx);
}

const CROSS_STAKE_ACTIONS = Object.freeze(["request", "approve"]);

// Il contesto per chi approva (diverse letture) si calcola solo se `request`
// aprirà davvero una richiesta: una chiamata ripetuta da chi è già in coda o
// già dentro costa poche letture.
// Restituisce il profilo se la richiesta si aprirà, altrimenti null.
async function opensRequest(db, stakeId, uid) {
  const [profileSnap, memberSnap] = await db.getAll(db.doc(`users/${uid}`), memberRef(db, stakeId, uid));
  const profile = profileSnap.exists ? profileSnap.data() : null;
  if (!profile || profile.stakeId !== stakeId || core.needsProfileCompletion(profile)) return null;
  if (core.staffRoleForStake(profile, stakeId)) return null;
  // Una richiesta che i tetti respingono non paga le letture del contesto.
  const opens =
    !memberSnap.exists ||
    (["withdrawn", "declined"].includes(memberSnap.data().status) && !core.requestBlockOf(memberSnap.data(), Date.now()));
  return opens ? profile : null;
}

function createStakeMembershipHandler({ db, clock = () => Date.now() } = {}) {
  return async (request) => {
    const firestore = db || getFirestore();
    if (!request.auth) throw new HttpsError("unauthenticated", "Accedi per continuare.");
    if (request.auth.token?.firebase?.sign_in_provider === "anonymous") {
      throw denied("Serve un account personale.");
    }
    const callerUid = request.auth.uid;
    const input = parseRequest(request.data, callerUid);
    const stakeSnap = await firestore.doc(`stakes/${input.stakeId}`).get();
    if (!stakeSnap.exists) throw new HttpsError("not-found", "Palo non trovato.");
    // Altri pali: servono solo a chi apre una richiesta o approva.
    const stakeIds = CROSS_STAKE_ACTIONS.includes(input.action) ? await listStakeIds(firestore) : [input.stakeId];
    const opening = input.action === "request" ? await opensRequest(firestore, input.stakeId, callerUid) : null;
    const [hints, note] = opening
      ? await Promise.all([
          computeRegistrationHints(firestore, input.stakeId, callerUid),
          computeStaffNote(firestore, input.stakeId, callerUid, opening),
        ])
      : [[], undefined];
    const nowMs = clock();
    const result = await runTransactionWithRetry(firestore, (tx) =>
      runAction(tx, firestore, { ...input, callerUid, stakeIds, hints, note, nowMs }),
    );
    logger.info("Appartenenza al palo.", {
      action: input.action,
      stakeId: input.stakeId,
      by: callerUid,
      uid: input.uid,
      status: result.status,
      changed: result.changed,
    });
    return { ok: true, action: input.action, ...result };
  };
}

const stakeMembership = onCall({ region: REGION, timeoutSeconds: 60 }, createStakeMembershipHandler());

// ---------------------------------------------------------------------------
// Trigger su users/{uid}
// ---------------------------------------------------------------------------

/**
 * Allinea `members/{uid}` di ogni palo al profilo attuale (regole 1-4 della
 * spec). Non usa i dati dell'evento: rilegge profilo, utente Auth e members
 * dentro una transazione, quindi è idempotente. Non tocca mai un documento
 * esistente per crearne uno nuovo: i tetti delle richieste restano della
 * callable.
 */
async function reconcileUserMembership(db, uid, { nowMs = Date.now(), auth = getAuth() } = {}) {
  let authUser;
  try {
    authUser = await auth.getUser(uid);
  } catch (error) {
    if (error?.code === "auth/user-not-found") return { skipped: "no_account" };
    throw error;
  }
  if (isAnonymousAuthUser(authUser)) return { skipped: "anonymous" };
  const stakeIds = await listStakeIds(db);
  if (!stakeIds.length) return { skipped: "no_stakes" };
  const userRef = db.doc(`users/${uid}`);
  const pre = await userRef.get();
  if (!pre.exists) return { skipped: "no_profile" };

  // Contesto della richiesta fuori dalla transazione (solo un aiuto).
  const preProfile = pre.data() || {};
  let hints = [];
  let note;
  let hintsStake = null;
  if (
    stakeIds.includes(preProfile.stakeId) &&
    !core.staffRoleForStake(preProfile, preProfile.stakeId) &&
    !core.needsProfileCompletion(preProfile) &&
    !(await memberRef(db, preProfile.stakeId, uid).get()).exists
  ) {
    [hints, note] = await Promise.all([
      computeRegistrationHints(db, preProfile.stakeId, uid),
      computeStaffNote(db, preProfile.stakeId, uid, preProfile),
    ]);
    hintsStake = preProfile.stakeId;
  }

  return runTransactionWithRetry(db, async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) return { skipped: "no_profile" };
    const profile = userSnap.data() || {};
    const chosen = stakeIds.includes(profile.stakeId) ? profile.stakeId : "";
    const snaps = await readDocs(tx, stakeIds.map((id) => memberRef(db, id, uid)));
    const changes = [];
    snaps.forEach((snap, index) => {
      const stakeId = stakeIds[index];
      const member = snap.exists ? snap.data() : null;
      const write = (patch, action) => {
        writeMember(tx, snap.ref, member, patch, { action, by: "system", nowMs });
        changes.push({ stakeId, action, status: patch.status ?? member?.status ?? null });
      };
      if (stakeId === chosen) {
        const staffRole = core.staffRoleForStake(profile, stakeId);
        if (staffRole) {
          // 1. Ruolo staff assegnato da un admin: appartenenza attiva.
          if (!member) {
            write(newMemberDoc({ status: "active", profile, sources: [roleSource(nowMs)], staffRole, decidedBy: "system" }), "role");
          } else if (member.status === "pending" || member.status === "active") {
            if (member.status === "active" && member.staffRole === staffRole && member.reviewNeeded !== true) return;
            const patch = { status: "active", staffRole, reviewNeeded: false };
            if (member.status === "pending") {
              patch.sources = withSource(member.sources, roleSource(nowMs));
              patch.decidedAt = FieldValue.serverTimestamp();
              patch.decidedBy = "system";
            }
            write(patch, "role");
          } else {
            logger.warn("Ruolo staff su un'appartenenza chiusa: nessuna scrittura.", { stakeId, uid, status: member.status });
          }
          return;
        }
        // 2. Ruolo tolto: resta l'appartenenza, va via la copia del ruolo.
        if (member && member.staffRole) {
          write({ staffRole: null }, "role");
          return;
        }
        // 3. Profilo completo che sceglie un palo dove non ha un documento.
        if (!member && !core.needsProfileCompletion(profile)) {
          write(
            newMemberDoc({
              status: "pending",
              profile,
              sources: [],
              staffRole: null,
              hints: hintsStake === stakeId ? hints : [],
            }),
            "request",
          );
          if (hintsStake === stakeId) writeStaffNote(tx, db, stakeId, uid, note);
        }
        return;
      }
      // 4. Pali diversi da quello scelto.
      if (!member) return;
      const patch = {};
      if (member.staffRole) patch.staffRole = null;
      if (member.status === "pending") {
        patch.status = "withdrawn";
        patch.decidedAt = FieldValue.serverTimestamp();
        patch.decidedBy = "system";
      }
      if (Object.keys(patch).length) write(patch, "stake_changed");
    });
    return { changed: changes.length > 0, changes };
  });
}

const onUserStakeMembership = onDocumentWritten({ document: "users/{uid}", region: REGION }, async (event) => {
  if (!event.data?.after?.exists) return;
  const result = await reconcileUserMembership(getFirestore(), event.params.uid);
  if (result?.changed) {
    logger.info("Appartenenza allineata al profilo.", { uid: event.params.uid, changes: result.changes });
  }
});

// ---------------------------------------------------------------------------
// Promemoria agli admin (fase 3): richieste in coda da più di 48 ore
// ---------------------------------------------------------------------------

function queueReminderPayload(count) {
  return JSON.stringify({
    title: "Richieste di accesso in attesa",
    body: count === 1 ? "1 richiesta aspetta da più di 2 giorni." : `${count} richieste aspettano da più di 2 giorni.`,
    tag: "membership-queue",
    url: "/admin/persone",
    eventId: null,
  });
}

/**
 * Un giro del promemoria: per ogni palo, le richieste `pending` più vecchie di
 * 48 ore. Push solo se fra queste c'è un uid non ancora avvisato; gli avvisati
 * si sostituiscono a ogni giro con l'elenco attuale, così una richiesta si
 * ricorda una volta sola e una che rientra in coda si ricorda di nuovo. Se il
 * push non arriva a nessun dispositivo (`sendPush` restituisce false) gli uid
 * nuovi non contano come avvisati: si riprova al giro dopo.
 * `sendPush({ stakeId, payload })` è iniettato (test).
 */
async function runStakeMembershipQueueReminder({ db, nowMs = Date.now(), sendPush }) {
  const stakes = [];
  for (const stakeId of await listStakeIds(db)) {
    const pending = await db.collection(`stakes/${stakeId}/members`).where("status", "==", "pending").get();
    const stale = pending.docs
      .filter((doc) => {
        const at = core.timestampMs(doc.get("requestedAt"));
        return at !== null && nowMs - at >= QUEUE_REMINDER_AFTER_MS;
      })
      .map((doc) => doc.id)
      .sort();
    const stateRef = db.doc(`stakes/${stakeId}/private/membershipQueue`);
    const state = await stateRef.get();
    const reminded = new Set(state.exists && Array.isArray(state.get("remindedUids")) ? state.get("remindedUids") : []);
    const notified = stale.some((uid) => !reminded.has(uid));
    const delivered = notified ? (await sendPush({ stakeId, payload: queueReminderPayload(stale.length) })) !== false : false;
    // Consegnato: avvisati sono tutti quelli in coda ora. Non consegnato: restano
    // avvisati solo quelli di prima ancora in coda.
    const next = delivered ? stale : stale.filter((uid) => reminded.has(uid));
    const unchanged = reminded.size === next.length && next.every((uid) => reminded.has(uid));
    if (!unchanged) await stateRef.set({ remindedUids: next, updatedAt: FieldValue.serverTimestamp() });
    stakes.push({ stakeId, stale: stale.length, notified: delivered });
  }
  return { stakes };
}

module.exports = {
  runStakeMembershipQueueReminder,
  queueReminderPayload,
  stakeMembership,
  onUserStakeMembership,
  createStakeMembershipHandler,
  reconcileUserMembership,
  computeRegistrationHints,
};
