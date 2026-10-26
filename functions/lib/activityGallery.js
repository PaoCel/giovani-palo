// Galleria foto/video dell'attività: apertura della galleria, segnalazioni e
// moderazione. Il caricamento vero passa dal client (Storage + doc media) e lo
// vincolano le rules; qui vive solo ciò che le rules non possono fare da sole:
// creare la galleria con la finestra di caricamento calcolata dalle date
// dell'attività (stringhe ISO, non confrontabili in una rule), nascondere un
// contenuto segnalato a tutti tranne allo staff, ripristinarlo o eliminarlo.
// Spec: docs/GALLERIA_ATTIVITA.md.

const { randomUUID } = require("node:crypto");

const { getFirestore, Timestamp, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const logger = require("firebase-functions/logger");
const { onDocumentWritten, onDocumentDeleted } = require("firebase-functions/v2/firestore");
const { resolveProjectId, isEmulatorRuntime } = require("./config");
const { createGalleryMediaStorage, resolveMediaBucketNames, rewriteMediaDownloadUrl } = require("./galleryMediaStorage");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

const { runTransactionWithRetry } = require("./transactionRetry");

const REGION = "europe-west1";

// La card compare un po' prima dell'inizio (ritrovo) e resta aperta una
// settimana dopo la fine, per chi carica a casa le foto del telefono.
const OPEN_BEFORE_START_MS = 2 * 60 * 60 * 1000;
const OPEN_AFTER_END_MS = 7 * 24 * 60 * 60 * 1000;
// Una persona può nascondere al massimo questi contenuti per galleria: un
// ragazzo non svuota la galleria degli altri a forza di segnalazioni.
const MAX_REPORTS_PER_USER = 10;

const REPORT_REASONS = ["mine", "inappropriate", "off_topic"];
// Campi aggiunti al doc quando viene nascosto: non tornano nella galleria,
// dove l'allowlist delle rules li rifiuterebbe.
const HIDDEN_ONLY_FIELDS = ["hiddenAt", "hiddenBy", "hiddenReason"];
const URL_FIELDS = ["storageUrl", "originalUrl", "optimizedUrl", "thumbnailUrl", "posterUrl"];

function mediaFolder(stakeId, galleryId, mediaId) {
  return `protected/stakes/${stakeId}/galleries/${galleryId}/media/${mediaId}/`;
}

/** Sostituisce il token degli URL di download con quello nuovo del file. */
function rewriteDownloadUrl(url, tokensByPath) {
  if (typeof url !== "string" || !url) return url;
  try {
    const parsed = new URL(url);
    const marker = "/o/";
    const index = parsed.pathname.indexOf(marker);
    if (index < 0) return url;
    const path = decodeURIComponent(parsed.pathname.slice(index + marker.length));
    const token = tokensByPath[path];
    if (!token) return url;
    parsed.searchParams.set("token", token);
    return parsed.toString();
  } catch {
    return url;
  }
}

function galleryIdForActivity(activityId) {
  return `act_${activityId}`;
}

function parseIsoMs(value) {
  if (typeof value !== "string" || !value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Finestra di caricamento dalle date dell'attività. Senza data di inizio
 * valida non c'è finestra: la galleria non si apre da sola.
 */
function computeUploadWindow(activity) {
  const startMs = parseIsoMs(activity?.startDate);
  if (startMs === null) return null;
  const endMs = parseIsoMs(activity?.endDate);
  const lastMs = endMs !== null && endMs > startMs ? endMs : startMs;
  return {
    fromMs: startMs - OPEN_BEFORE_START_MS,
    untilMs: lastMs + OPEN_AFTER_END_MS,
  };
}

function isWindowOpen(window, nowMs) {
  return Boolean(window) && nowMs >= window.fromMs && nowMs < window.untilMs;
}

/**
 * Ruolo nella galleria del palo, con la stessa regola delle rules
 * (isStakeMember, docs/APPARTENENZA_AL_PALO.md «Contratto di
 * autorizzazione»). "staff" = admin del palo o dirigente di unità del palo,
 * ruoli assegnati da un admin e letti dal profilo; "member" = documento
 * `stakes/{stakeId}/members/{uid}` attivo, scritto solo dal server.
 * `users.stakeId` da solo non basta più: è il palo scelto, non l'appartenenza.
 */
function resolveGalleryRole({ profile, member, stakeId, isAnonymous }) {
  if (isAnonymous) return null;
  if (profile) {
    const role = profile.role;
    if (role === "super_admin") return "staff";
    if (profile.stakeId === stakeId && (role === "admin" || role === "unit_leader")) return "staff";
  }
  return member && member.status === "active" ? "member" : null;
}

function cleanId(value, field) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > 128 || text.includes("/")) {
    throw new HttpsError("invalid-argument", `${field} non valido.`);
  }
  return text;
}

async function loadRole(db, request, stakeId) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Accedi per vedere foto e video.");
  }
  const uid = request.auth.uid;
  const isAnonymous = request.auth.token?.firebase?.sign_in_provider === "anonymous";
  const [userSnap, memberSnap] = await db.getAll(
    db.doc(`users/${uid}`),
    db.doc(`stakes/${stakeId}/members/${uid}`),
  );
  const role = resolveGalleryRole({
    profile: userSnap.exists ? userSnap.data() : null,
    member: memberSnap.exists ? memberSnap.data() : null,
    stakeId,
    isAnonymous,
  });
  if (!role) {
    throw new HttpsError("permission-denied", "Foto e video sono visibili solo ai membri del palo.");
  }
  return role;
}

async function findActivityGallery(db, stakeId, activityId) {
  const fixed = await db.doc(`stakes/${stakeId}/galleries/${galleryIdForActivity(activityId)}`).get();
  if (fixed.exists) return fixed;
  // Gallerie create prima di questa funzione dal pannello admin: id casuale.
  const legacy = await db
    .collection(`stakes/${stakeId}/galleries`)
    .where("activityId", "==", activityId)
    .limit(1)
    .get();
  return legacy.empty ? null : legacy.docs[0];
}

function windowFields(window) {
  return {
    uploadsOpenFrom: Timestamp.fromMillis(window.fromMs),
    uploadsOpenUntil: Timestamp.fromMillis(window.untilMs),
  };
}

function sameWindow(data, window) {
  return (
    data.uploadsOpenFrom instanceof Timestamp &&
    data.uploadsOpenUntil instanceof Timestamp &&
    data.uploadsOpenFrom.toMillis() === window.fromMs &&
    data.uploadsOpenUntil.toMillis() === window.untilMs
  );
}

/**
 * Restituisce la galleria dell'attività, creandola se la finestra è aperta.
 * Allinea la finestra alle date dell'attività finché un admin non l'ha
 * cambiata a mano (`uploadsWindowSource: "manual"`).
 */
async function ensureGallery(db, { stakeId, activityId, role, uid, nowMs }) {
  const activitySnap = await db.doc(`stakes/${stakeId}/activities/${activityId}`).get();
  if (!activitySnap.exists) {
    throw new HttpsError("not-found", "Attività non trovata.");
  }
  const activity = activitySnap.data() || {};
  const window = computeUploadWindow(activity);
  const existing = await findActivityGallery(db, stakeId, activityId);

  if (existing) {
    const data = existing.data() || {};
    if (window && data.uploadsWindowSource !== "manual" && !sameWindow(data, window)) {
      await existing.ref.update({
        ...windowFields(window),
        uploadsWindowSource: "activity",
        updatedAt: new Date(nowMs).toISOString(),
      });
    }
    return { galleryId: existing.id, created: false };
  }

  if (!window || (role !== "staff" && !isWindowOpen(window, nowMs))) {
    return { galleryId: null, created: false };
  }

  const ref = db.doc(`stakes/${stakeId}/galleries/${galleryIdForActivity(activityId)}`);
  const ts = new Date(nowMs).toISOString();
  try {
    await ref.create({
      title: typeof activity.title === "string" ? activity.title.slice(0, 200) : "Galleria",
      description: "",
      activityId,
      createdBy: uid,
      createdAt: ts,
      updatedAt: ts,
      published: false,
      publishedAt: null,
      coverMediaId: null,
      coverImageUrl: null,
      mediaCount: 0,
      batchSize: 30,
      accessMode: "open",
      likeCount: 0,
      commentsEnabled: false,
      postsCreated: false,
      uploadsClosed: false,
      uploadsWindowSource: "activity",
      ...windowFields(window),
    });
    return { galleryId: ref.id, created: true };
  } catch (error) {
    // Due persone aprono la galleria nello stesso momento: vince la prima.
    if (error?.code === 6 || /already exists/i.test(String(error?.message))) {
      return { galleryId: ref.id, created: false };
    }
    throw error;
  }
}

async function reportMedia(db, { stakeId, galleryId, mediaId, reason, uid, nowMs }) {
  if (!REPORT_REASONS.includes(reason)) {
    throw new HttpsError("invalid-argument", "Motivo non valido.");
  }
  const galleryRef = db.doc(`stakes/${stakeId}/galleries/${galleryId}`);
  const mediaRef = galleryRef.collection("media").doc(mediaId);
  const hiddenRef = galleryRef.collection("hiddenMedia").doc(mediaId);
  // Un report per segnalazione (non per persona): dopo un ripristino una nuova
  // segnalazione crea un doc nuovo e il trigger avvisa di nuovo gli admin.
  const lifecycleRef = galleryRef.collection("mediaLifecycle").doc(mediaId);
  const rotationSeed = randomUUID();
  const reportRef = galleryRef.collection("reports").doc(`${mediaId}_${uid}_${nowMs}`);
  const ts = new Date(nowMs).toISOString();

  // Il tetto è un freno, non un vincolo esatto: si legge fuori dalla
  // transazione. Una query dentro la transazione resta bloccata dalla gara di
  // due segnalazioni insieme e la chiude ("Transaction is invalid or closed").
  const openReports = await galleryRef
    .collection("reports")
    .where("reporterUid", "==", uid)
    .where("status", "==", "open")
    .count()
    .get();
  if (openReports.data().count >= MAX_REPORTS_PER_USER) {
    throw new HttpsError(
      "resource-exhausted",
      "Hai già segnalato molti contenuti. Parlane con un responsabile.",
    );
  }

  return runTransactionWithRetry(db, async (tx) => {
    const mediaSnap = await tx.get(mediaRef);
    const hiddenSnap = await tx.get(hiddenRef);
    const lifecycle = await tx.get(lifecycleRef);
    if (lifecycle.data()?.operation === "delete") throw new HttpsError("failed-precondition", "Cancellazione in corso.");
    if (!mediaSnap.exists) {
      // Già nascosto da un'altra segnalazione: per chi segnala è comunque fatto.
      if (hiddenSnap.exists) {
        if (!lifecycle.exists) tx.set(lifecycleRef, lifecycleData("hide", rotationSeed));
        return { status: "already_hidden" };
      }
      throw new HttpsError("not-found", "Contenuto non trovato.");
    }
    const media = mediaSnap.data() || {};
    tx.set(lifecycleRef, lifecycleData("hide", rotationSeed));
    tx.set(reportRef, {
      mediaId,
      reporterUid: uid,
      reason,
      uploadedBy: typeof media.uploadedBy === "string" ? media.uploadedBy : null,
      status: "open",
      createdAt: ts,
      resolvedAt: null,
      resolvedBy: null,
    });
    tx.set(hiddenRef, {
      ...media,
      hiddenAt: ts,
      hiddenBy: uid,
      hiddenReason: reason,
    });
    tx.delete(mediaRef);
    tx.update(galleryRef, { mediaCount: FieldValue.increment(-1), updatedAt: ts });
    return { status: "hidden" };
  });
}

// This document is also the pessimistic lock for Storage side effects. All
// callbacks are idempotent: a transaction retry uses the same persisted seed.
function lifecycleData(operation, rotationSeed) {
  return { operation, status: "pending", ...(rotationSeed ? { rotationSeed } : {}),
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
}
function runtimeMediaStorage() {
  const storage = getStorage();
  const bucketNames = resolveMediaBucketNames({ projectId: resolveProjectId(), emulator: isEmulatorRuntime(), defaultBucketName: storage.bucket().name });
  return createGalleryMediaStorage({ storage, bucketNames });
}
async function processMediaLifecycle(db, ids, mediaStorage = runtimeMediaStorage()) {
  const { stakeId, galleryId, mediaId } = ids;
  const galleryRef = db.doc(`stakes/${stakeId}/galleries/${galleryId}`);
  const lifecycleRef = galleryRef.collection("mediaLifecycle").doc(mediaId);
  const hiddenRef = galleryRef.collection("hiddenMedia").doc(mediaId);
  return runTransactionWithRetry(db, async (tx) => {
    const lifecycle = await tx.get(lifecycleRef);
    if (!lifecycle.exists || lifecycle.data().status !== "pending") return { status: "complete" };
    const state = lifecycle.data();
    const hidden = await tx.get(hiddenRef);
    if (state.operation === "hide") {
      const revoked = await mediaStorage.revokeMedia({ ...ids, rotationSeed: state.rotationSeed,
        isCurrent: async () => {
          const current = (await lifecycleRef.get()).data();
          return current?.operation === "hide" && current.rotationSeed === state.rotationSeed;
        } });
      if (hidden.exists) {
        const patch = {};
        for (const field of URL_FIELDS) {
          const value = hidden.data()[field];
          const next = rewriteMediaDownloadUrl(value, { ...revoked, prefix: mediaFolder(stakeId, galleryId, mediaId),
            emulatorHost: isEmulatorRuntime() ? process.env.FIREBASE_STORAGE_EMULATOR_HOST : undefined });
          if (next !== value) patch[field] = next;
        }
        if (Object.keys(patch).length) tx.update(hiddenRef, patch);
      }
    } else if (state.operation === "delete") {
      await mediaStorage.deleteMedia(ids);
      // Keep the tombstone even after all files and comments have disappeared.
      await db.recursiveDelete(galleryRef.collection("media").doc(mediaId));
      if (hidden.exists) tx.delete(hiddenRef);
    } else { throw new Error("Operazione lifecycle non valida."); }
    tx.update(lifecycleRef, { status: "complete", updatedAt: FieldValue.serverTimestamp() });
    return { status: "complete" };
  });
}
async function completeMediaOperation(db, ids) {
  try { await processMediaLifecycle(db, ids); }
  catch {
    throw new HttpsError("unavailable", "Contenuto già nascosto. Protezione dei file in corso: riprova tra poco.", { mediaState: "hidden", cleanupStatus: "pending" });
  }
}

async function resolveReports(tx, galleryRef, mediaId, resolution, uid, ts) {
  const reports = await tx.get(
    galleryRef.collection("reports").where("mediaId", "==", mediaId).where("status", "==", "open"),
  );
  return () => {
    for (const doc of reports.docs) {
      tx.update(doc.ref, { status: resolution, resolvedAt: ts, resolvedBy: uid });
    }
  };
}

async function restoreMedia(db, { stakeId, galleryId, mediaId, uid, nowMs }) {
  const galleryRef = db.doc(`stakes/${stakeId}/galleries/${galleryId}`);
  const hiddenRef = galleryRef.collection("hiddenMedia").doc(mediaId);
  const mediaRef = galleryRef.collection("media").doc(mediaId);
  const ts = new Date(nowMs).toISOString();
  return runTransactionWithRetry(db, async (tx) => {
    const hiddenSnap = await tx.get(hiddenRef);
    const lifecycle = await tx.get(galleryRef.collection("mediaLifecycle").doc(mediaId));
    if (lifecycle.data()?.operation === "delete") throw new HttpsError("failed-precondition", "Cancellazione già avviata.");
    if (!hiddenSnap.exists) throw new HttpsError("not-found", "Contenuto non trovato.");
    if (lifecycle.data()?.operation !== "hide" || lifecycle.data()?.status !== "complete") {
      throw new HttpsError("failed-precondition", "Protezione dei file in corso. Riprova tra poco.");
    }
    const applyResolution = await resolveReports(tx, galleryRef, mediaId, "restored", uid, ts);
    const media = { ...(hiddenSnap.data() || {}) };
    for (const key of HIDDEN_ONLY_FIELDS) delete media[key];
    tx.set(mediaRef, { ...media, updatedAt: ts });
    tx.delete(hiddenRef);
    tx.update(galleryRef, { mediaCount: FieldValue.increment(1), updatedAt: ts });
    applyResolution();
    return { status: "restored" };
  });
}

async function deleteHiddenMedia(db, { stakeId, galleryId, mediaId, uid, nowMs }) {
  const galleryRef = db.doc(`stakes/${stakeId}/galleries/${galleryId}`);
  const hiddenRef = galleryRef.collection("hiddenMedia").doc(mediaId);
  const lifecycleRef = galleryRef.collection("mediaLifecycle").doc(mediaId);
  const ts = new Date(nowMs).toISOString();
  await runTransactionWithRetry(db, async (tx) => {
    const hiddenSnap = await tx.get(hiddenRef);
    const lifecycle = await tx.get(lifecycleRef);
    if (lifecycle.data()?.operation === "delete") return;
    if (!hiddenSnap.exists) throw new HttpsError("not-found", "Contenuto non trovato.");
    const applyResolution = await resolveReports(tx, galleryRef, mediaId, "deleted", uid, ts);
    tx.set(lifecycleRef, lifecycleData("delete"));
    applyResolution();
  });
  try { await processMediaLifecycle(db, { stakeId, galleryId, mediaId }); }
  catch { throw new HttpsError("unavailable", "Cancellazione in corso. Riprova tra poco.", { cleanupStatus: "pending", mediaState: "deleting" }); }
  return { status: "deleted" };
}
async function handleVisibleMediaDeleted(db, ids, mediaStorage) {
  const galleryRef = db.doc(`stakes/${ids.stakeId}/galleries/${ids.galleryId}`);
  await runTransactionWithRetry(db, async (tx) => {
    const ref = galleryRef.collection("mediaLifecycle").doc(ids.mediaId);
    const lifecycle = await tx.get(ref);
    const hidden = await tx.get(galleryRef.collection("hiddenMedia").doc(ids.mediaId));
    const visible = await tx.get(galleryRef.collection("media").doc(ids.mediaId));
    if (visible.exists) return; // Delayed report event after a restore.
    if (hidden.exists && lifecycle.data()?.operation !== "delete") {
      if (!lifecycle.exists) tx.set(ref, lifecycleData("hide", randomUUID()));
    } else if (lifecycle.data()?.operation !== "delete") tx.set(ref, lifecycleData("delete"));
  });
  return processMediaLifecycle(db, ids, mediaStorage);
}
const onGalleryMediaLifecycle = onDocumentWritten({ region: REGION, retry: true,
  document: "stakes/{stakeId}/galleries/{galleryId}/mediaLifecycle/{mediaId}" }, async (event) => {
  if (event.data?.after.data()?.status !== "pending") return;
  await processMediaLifecycle(getFirestore(), event.params);
});
const onGalleryMediaDeleted = onDocumentDeleted({ region: REGION, retry: true,
  document: "stakes/{stakeId}/galleries/{galleryId}/media/{mediaId}" }, async (event) => {
  await handleVisibleMediaDeleted(getFirestore(), event.params);
});

const activityGallery = onCall({ region: REGION }, async (request) => {
  const db = getFirestore();
  const data = request.data || {};
  const action = data.action;
  const stakeId = cleanId(data.stakeId, "stakeId");
  const role = await loadRole(db, request, stakeId);
  const uid = request.auth.uid;
  const nowMs = Date.now();

  if (action === "ensure") {
    const activityId = cleanId(data.activityId, "activityId");
    return ensureGallery(db, { stakeId, activityId, role, uid, nowMs });
  }

  const galleryId = cleanId(data.galleryId, "galleryId");
  const mediaId = cleanId(data.mediaId, "mediaId");

  if (action === "report") {
    const result = await reportMedia(db, {
      stakeId,
      galleryId,
      mediaId,
      reason: data.reason,
      uid,
      nowMs,
    });
    await completeMediaOperation(db, { stakeId, galleryId, mediaId });
    logger.info("Contenuto galleria segnalato.", { stakeId, galleryId, mediaId, status: result.status });
    return result;
  }

  if (role !== "staff") {
    throw new HttpsError("permission-denied", "Solo un responsabile può farlo.");
  }
  if (action === "restore") {
    const lifecycleRef = db.doc(`stakes/${stakeId}/galleries/${galleryId}/mediaLifecycle/${mediaId}`);
    await runTransactionWithRetry(db, async (tx) => {
      const lifecycle = await tx.get(lifecycleRef);
      const hidden = await tx.get(db.doc(`stakes/${stakeId}/galleries/${galleryId}/hiddenMedia/${mediaId}`));
      if (!lifecycle.exists && hidden.exists) tx.set(lifecycleRef, lifecycleData("hide", randomUUID()));
    });
    await completeMediaOperation(db, { stakeId, galleryId, mediaId });
    return restoreMedia(db, { stakeId, galleryId, mediaId, uid, nowMs });
  }
  if (action === "delete") {
    return deleteHiddenMedia(db, {
      stakeId,
      galleryId,
      mediaId,
      uid,
      nowMs,
    });
  }
  throw new HttpsError("invalid-argument", "Azione non valida.");
});

module.exports = {
  activityGallery,
  onGalleryMediaLifecycle,
  onGalleryMediaDeleted,
  processMediaLifecycle,
  handleVisibleMediaDeleted,
  computeUploadWindow,
  isWindowOpen,
  resolveGalleryRole,
  galleryIdForActivity,
  rewriteDownloadUrl,
  MAX_REPORTS_PER_USER,
  REPORT_REASONS,
  OPEN_BEFORE_START_MS,
  OPEN_AFTER_END_MS,
};
