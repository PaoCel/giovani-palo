// Essential activity program. New paths are server-only, including reads:
// context responses resolve the current registration instead of trusting a UID
// projection that has not been deployed. See PROGRAMMA_PRIMO_INCREMENTO.md.
const {
  getFirestore,
  Timestamp,
  FieldValue,
} = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const {
  onDocumentWritten,
  onDocumentDeleted,
} = require("firebase-functions/v2/firestore");
const { REGION } = require("./config");
const { runTransactionWithRetry } = require("./transactionRetry");
const {
  buildPeople,
  participantNameFromRegistration,
} = require("./recordNight");
const {
  MAX_MOMENTS,
  MAX_CAPACITY,
  MAX_PEOPLE,
  isMomentRegistrationActive,
  registrationOwnerUid,
  parseMomentRequest,
  requestFingerprint,
  isParticipationOpen,
} = require("./momentsCore");

function authUid(request) {
  if (!request.auth)
    throw new HttpsError("unauthenticated", "Accedi per aprire il programma.");
  if (request.auth.token?.firebase?.sign_in_provider === "anonymous")
    throw new HttpsError("permission-denied", "Serve un account personale.");
  return request.auth.uid;
}
function activityRef(db, input) {
  return db.doc(`stakes/${input.stakeId}/activities/${input.activityId}`);
}
function isAdmin(profile, stakeId) {
  return (
    profile?.role === "super_admin" ||
    (profile?.role === "admin" && profile.stakeId === stakeId)
  );
}
async function readCaller(tx, db, uid, stakeId, adminOnly = false) {
  const snap = await tx.get(db.doc(`users/${uid}`));
  if (!snap.exists)
    throw new HttpsError(
      "permission-denied",
      "Il profilo non è più disponibile.",
    );
  if (adminOnly && !isAdmin(snap.data(), stakeId))
    throw new HttpsError(
      "permission-denied",
      "Solo un admin del palo può gestire il programma.",
    );
  return snap.data();
}
function iso(value) {
  return value?.toDate?.().toISOString() || null;
}
function visibleActivity(activity) {
  return activity.status !== "draft" && activity.status !== "cancelled";
}
function publicMoment(snap) {
  const m = snap.data();
  return {
    id: snap.id,
    type: m.type,
    title: m.title,
    description: m.description,
    place: m.place,
    startsAt: m.startsAt,
    endsAt: m.endsAt,
    status: m.status,
    revision: m.revision,
    visibleFrom: iso(m.visibleFromTs),
    capacity: m.slots?.[0]?.capacity ?? null,
    taken: m.slots?.[0]?.taken ?? 0,
    hasEntries: (m.summary?.totalEntries || 0) > 0,
    participation: m.participation
      ? {
          opensAt: iso(m.participation.opensAtTs),
          closesAt: iso(m.participation.closesAtTs),
          customWindow: m.participation.customWindow === true,
        }
      : null,
    updatedAt: iso(m.updatedAt),
  };
}
function ownEntry(snap) {
  if (!snap?.exists) return null;
  const entry = snap.data();
  return {
    registrationId: entry.registrationId,
    revision: entry.revision || 0,
    status: entry.status,
    withdrawnReason: entry.withdrawnReason || null,
    restoreBlockedReason: entry.restoreBlockedReason || null,
    titleSnapshot: entry.titleSnapshot,
    startsAtSnapshot: entry.startsAtSnapshot,
  };
}
function momentConfiguration(fields, previous, now) {
  const taken = previous?.slots?.[0]?.taken || 0;
  if (fields.type === "turni" && fields.capacity < taken)
    throw new HttpsError(
      "failed-precondition",
      `Ci sono già ${taken} iscritti. I posti non possono essere meno.`,
    );
  const defaultOpens =
    previous?.participation?.customWindow === false
      ? previous.participation.opensAtTs
      : previous?.visibleFromTs;
  const opens = fields.customWindow
    ? Timestamp.fromDate(new Date(fields.opensAt))
    : defaultOpens || Timestamp.fromDate(now);
  const closes = Timestamp.fromDate(
    new Date(fields.customWindow ? fields.closesAt : fields.startsAt),
  );
  if (fields.type === "turni" && closes.toMillis() <= opens.toMillis())
    throw new HttpsError(
      "invalid-argument",
      "La chiusura delle iscrizioni deve seguire l'apertura. Controlla l'orario o personalizza la finestra.",
    );
  return {
    type: fields.type,
    title: fields.title,
    description: fields.description,
    place: fields.place,
    startsAt: fields.startsAt,
    endsAt: fields.endsAt,
    startsAtTs: Timestamp.fromDate(new Date(fields.startsAt)),
    endsAtTs: Timestamp.fromDate(new Date(fields.endsAt)),
    audience: "registered",
    participation:
      fields.type === "turni"
        ? {
            opensAtTs: opens,
            closesAtTs: closes,
            maxPerPerson: 1,
            moderation: "none",
            showTitles: false,
            customWindow: fields.customWindow,
          }
        : null,
    slots:
      fields.type === "turni"
        ? [
            {
              id: "main",
              label: fields.title,
              capacity: fields.capacity,
              taken,
            },
          ]
        : [],
  };
}
function assertRevision(moment, expectedRevision) {
  if (moment.revision !== expectedRevision)
    throw new HttpsError(
      "aborted",
      "Il momento è cambiato. Ricarica il programma prima di salvare.",
    );
}
function createMomentsAdminHandler({ db, clock = () => new Date() } = {}) {
  return async (request) => {
    const uid = authUid(request),
      input = parseMomentRequest(request.data, "admin");
    const firestore = db || getFirestore(),
      parent = activityRef(firestore, input);
    return runTransactionWithRetry(firestore, async (tx) => {
      await readCaller(tx, firestore, uid, input.stakeId, true);
      const activity = await tx.get(parent);
      if (!activity.exists)
        throw new HttpsError("not-found", "Attività non trovata.");
      if (input.action === "context") {
        const moments = await tx.get(
          parent.collection("moments").limit(MAX_MOMENTS + 1),
        );
        return {
          moments: moments.docs
            .map(publicMoment)
            .sort(
              (a, b) =>
                a.startsAt.localeCompare(b.startsAt) ||
                a.id.localeCompare(b.id),
            ),
        };
      }
      const ref = parent.collection("moments").doc(input.momentId),
        snap = await tx.get(ref),
        previous = snap.exists ? snap.data() : null;
      if (input.action === "roster") {
        if (!snap.exists)
          throw new HttpsError("not-found", "Momento non trovato.");
        const entries = await tx.get(
          ref
            .collection("entries")
            .where("status", "==", "approved")
            .limit(MAX_CAPACITY + 1),
        );
        if (entries.size > MAX_CAPACITY)
          throw new HttpsError(
            "failed-precondition",
            "Gli iscritti devono essere controllati da un admin.",
          );
        const regs = entries.docs.length
          ? await tx.getAll(
              ...entries.docs.map((entry) =>
                parent.collection("registrations").doc(entry.id),
              ),
            )
          : [];
        return {
          entries: entries.docs.map((entry, index) => ({
            registrationId: entry.id,
            status: entry.data().status,
            displayName: regs[index].exists
              ? participantNameFromRegistration(regs[index].data())
              : "Iscrizione non più disponibile",
          })),
        };
      }
      if (!snap.exists && input.action === "delete")
        return { deleted: true, moment: null };
      if (!snap.exists && input.action !== "save")
        throw new HttpsError("not-found", "Momento non trovato.");
      const fingerprint = requestFingerprint(input);
      if (
        previous?.lastRequestId === input.requestId &&
        previous.updatedBy === uid
      ) {
        if (previous.lastRequestFingerprint !== fingerprint)
          throw new HttpsError(
            "invalid-argument",
            "La stessa richiesta non può cambiare contenuto.",
          );
        return { moment: publicMoment(snap) };
      }
      if (snap.exists) assertRevision(previous, input.expectedRevision);
      else if (input.expectedRevision !== null)
        throw new HttpsError(
          "aborted",
          "La bozza non esiste più. Ricarica il programma.",
        );
      const now = clock(),
        timestamp = Timestamp.fromDate(now);
      let patch;
      if (input.action === "save") {
        if (previous && previous.type !== input.fields.type)
          throw new HttpsError(
            "failed-precondition",
            "Il tipo non si può cambiare dopo il salvataggio.",
          );
        if (!previous) {
          const all = await tx.get(
            parent.collection("moments").limit(MAX_MOMENTS),
          );
          if (all.size >= MAX_MOMENTS)
            throw new HttpsError(
              "resource-exhausted",
              `Puoi creare al massimo ${MAX_MOMENTS} momenti per attività.`,
            );
        }
        patch = {
          ...momentConfiguration(input.fields, previous, now),
          ...(previous
            ? {}
            : {
                status: "draft",
                visibleFromTs: timestamp,
                createdAt: timestamp,
                createdBy: uid,
                summary: { entryCount: 0, totalEntries: 0 },
              }),
        };
      } else {
        if (input.action === "delete" || input.action === "draft") {
          const entries = await tx.get(ref.collection("entries").limit(1));
          if (!entries.empty)
            throw new HttpsError(
              "failed-precondition",
              "Ci sono partecipazioni da conservare. Puoi nascondere il momento.",
            );
        }
        if (input.action === "delete") {
          if (!["draft", "hidden"].includes(previous.status))
            throw new HttpsError(
              "failed-precondition",
              "Nascondi il momento prima di eliminarlo.",
            );
          tx.delete(ref);
          return { deleted: true, moment: null };
        }
        const target = {
          publish: "published",
          show: "published",
          hide: "hidden",
          draft: "draft",
        }[input.action];
        if (
          (input.action === "publish" && previous.status !== "draft") ||
          (input.action === "show" && previous.status !== "hidden") ||
          (input.action === "hide" && previous.status !== "published")
        ) {
          throw new HttpsError(
            "failed-precondition",
            "Lo stato del momento è cambiato. Ricarica il programma.",
          );
        }
        patch = {
          status: target,
          ...(input.action === "publish" ? { visibleFromTs: timestamp } : {}),
        };
      }
      patch = {
        ...patch,
        revision: (previous?.revision || 0) + 1,
        updatedAt: timestamp,
        updatedBy: uid,
        lastRequestId: input.requestId,
        lastRequestFingerprint: fingerprint,
      };
      if (previous) tx.update(ref, patch);
      else tx.create(ref, patch);
      return {
        moment: publicMoment({
          id: ref.id,
          data: () => ({ ...previous, ...patch }),
        }),
      };
    });
  };
}
async function readPeople(tx, parent, uid) {
  const own = await tx.get(
    parent.collection("registrations").doc(`user_${uid}`),
  );
  const children = await tx.get(
    parent
      .collection("registrations")
      .where("parentUid", "==", uid)
      .limit(MAX_PEOPLE + 1),
  );
  if (children.size > MAX_PEOPLE)
    throw new HttpsError(
      "resource-exhausted",
      "Ci sono troppe iscrizioni associate a questo account. Contatta un admin.",
    );
  const rows = new Map();
  for (const snap of [own, ...children.docs])
    if (snap.exists && registrationOwnerUid(snap.id, snap.data()) === uid)
      rows.set(snap.id, { id: snap.id, data: snap.data() });
  if (rows.size > MAX_PEOPLE)
    throw new HttpsError(
      "resource-exhausted",
      "Ci sono troppe iscrizioni associate a questo account. Contatta un admin.",
    );
  const people = buildPeople(
    rows.get(`user_${uid}`) || null,
    [...rows.values()].filter((row) => row.id !== `user_${uid}`),
  );
  return people.map((person) => ({
    ...person,
    eligible: isMomentRegistrationActive(rows.get(person.registrationId).data),
  }));
}
async function participantContext(tx, firestore, parent, uid, stakeId, now) {
  const profile = await readCaller(tx, firestore, uid, stakeId);
  const activity = await tx.get(parent);
  if (!activity.exists)
    throw new HttpsError("not-found", "Attività non trovata.");
  const people = await readPeople(tx, parent, uid);
  const canRead =
    visibleActivity(activity.data()) &&
    (people.some((person) => person.eligible) || isAdmin(profile, stakeId));
  const snapshots = await tx.get(
    parent.collection("moments").limit(MAX_MOMENTS + 1),
  );
  const moments = [];
  for (const snap of snapshots.docs) {
    const entrySnaps = await tx.get(
      snap.ref
        .collection("entries")
        .where("ownerUids", "array-contains", uid)
        .limit(MAX_PEOPLE + 1),
    );
    // Revalidate ownership from today's registration; copied ownerUids cannot
    // keep an old parent authorised after a reassignment or cancelled account.
    const allowedIds = new Set(people.map((person) => person.registrationId));
    const entries = entrySnaps.docs
      .filter((entry) => allowedIds.has(entry.id))
      .map(ownEntry);
    const data = snap.data();
    const visible =
      canRead &&
      data.status === "published" &&
      data.visibleFromTs?.toMillis() <= now.getTime();
    if (visible)
      moments.push({
        ...publicMoment(snap),
        restricted: false,
        participationOpen: isParticipationOpen(data, now),
        entries,
      });
    else if (entries.length)
      moments.push({
        id: snap.id,
        type: data.type,
        title: entries[0].titleSnapshot,
        startsAt: entries[0].startsAtSnapshot,
        endsAt: entries[0].startsAtSnapshot,
        status: "hidden",
        restricted: true,
        participationOpen: false,
        description: "",
        place: "",
        capacity: null,
        taken: 0,
        hasEntries: true,
        visibleFrom: null,
        updatedAt: null,
        participation: null,
        revision: 0,
        entries,
      });
  }
  return {
    serverNow: now.toISOString(),
    people,
    moments: moments.sort(
      (a, b) =>
        a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id),
    ),
  };
}
function updateTaken(tx, ref, moment, delta, newEntry = false) {
  const slot = moment.slots?.[0];
  if (
    !slot ||
    !Number.isInteger(slot.taken) ||
    slot.taken + delta < 0 ||
    slot.taken + delta > slot.capacity
  )
    throw new HttpsError(
      "failed-precondition",
      "I posti devono essere controllati da un admin.",
    );
  tx.update(ref, {
    slots: [{ ...slot, taken: slot.taken + delta }],
    summary: {
      ...moment.summary,
      entryCount: slot.taken + delta,
      totalEntries: (moment.summary?.totalEntries || 0) + (newEntry ? 1 : 0),
    },
  });
}
function createMomentsParticipantHandler({
  db,
  clock = () => new Date(),
} = {}) {
  return async (request) => {
    const uid = authUid(request),
      input = parseMomentRequest(request.data, "participant"),
      firestore = db || getFirestore(),
      parent = activityRef(firestore, input);
    return runTransactionWithRetry(firestore, async (tx) => {
      const now = clock();
      if (input.action === "context")
        return participantContext(
          tx,
          firestore,
          parent,
          uid,
          input.stakeId,
          now,
        );
      await readCaller(tx, firestore, uid, input.stakeId);
      const [activity, registration, moment, entry] = await tx.getAll(
        parent,
        parent.collection("registrations").doc(input.registrationId),
        parent.collection("moments").doc(input.momentId),
        parent
          .collection("moments")
          .doc(input.momentId)
          .collection("entries")
          .doc(input.registrationId),
      );
      if (!activity.exists || !moment.exists)
        throw new HttpsError("not-found", "Momento non più disponibile.");
      if (
        !registration.exists ||
        registrationOwnerUid(input.registrationId, registration.data()) !== uid
      )
        throw new HttpsError(
          "permission-denied",
          "Puoi gestire solo la tua iscrizione o quella dei tuoi figli.",
        );
      const data = moment.data(),
        current = entry.exists ? entry.data() : null;
      if (
        current?.lastRequestId === input.requestId &&
        current.lastRequestAction !== input.action
      )
        throw new HttpsError(
          "invalid-argument",
          "La stessa richiesta non può cambiare azione.",
        );
      const assertEntryRevision = () => {
        if ((current ? current.revision || 0 : null) !== input.expectedRevision)
          throw new HttpsError(
            "aborted",
            "La partecipazione è cambiata. Ricarica il programma prima di riprovare.",
          );
      };
      if (input.action === "withdraw") {
        if (!current)
          throw new HttpsError(
            "not-found",
            "Non risulti iscritto a questo momento.",
          );
        if (current.status === "withdrawn") return { entry: ownEntry(entry) };
        assertEntryRevision();
        updateTaken(tx, moment.ref, data, -1);
        const patch = {
          status: "withdrawn",
          withdrawnReason: "participant",
          restoreBlockedReason: null,
          revision: (current.revision || 0) + 1,
          lastRequestId: input.requestId,
          lastRequestAction: input.action,
          updatedAt: Timestamp.fromDate(now),
          ownerUids: [uid],
        };
        tx.update(entry.ref, patch);
        return {
          entry: ownEntry({
            exists: true,
            data: () => ({ ...current, ...patch }),
          }),
        };
      }
      if (!isMomentRegistrationActive(registration.data()))
        throw new HttpsError(
          "failed-precondition",
          "L'iscrizione all'attività non è attiva.",
        );
      if (current?.status === "approved") return { entry: ownEntry(entry) };
      assertEntryRevision();
      if (!visibleActivity(activity.data()) || !isParticipationOpen(data, now))
        throw new HttpsError(
          "failed-precondition",
          "Le iscrizioni a questo momento sono chiuse.",
        );
      if (data.slots[0].taken >= data.slots[0].capacity)
        throw new HttpsError(
          "resource-exhausted",
          current?.status === "withdrawn"
            ? "I posti sono esauriti. La tua rinuncia resta invariata."
            : "I posti sono esauriti. Ricarica il programma per aggiornare la disponibilità.",
        );
      const patch = {
        registrationId: input.registrationId,
        ownerUids: [uid],
        slotId: "main",
        status: "approved",
        withdrawnReason: null,
        revision: (current?.revision || 0) + 1,
        lastRequestId: input.requestId,
        lastRequestAction: input.action,
        restoreBlockedReason: null,
        titleSnapshot: data.title,
        startsAtSnapshot: data.startsAt,
        createdAt: current?.createdAt || Timestamp.fromDate(now),
        updatedAt: Timestamp.fromDate(now),
      };
      updateTaken(tx, moment.ref, data, 1, !current);
      if (current) tx.update(entry.ref, patch);
      else tx.create(entry.ref, patch);
      return { entry: ownEntry({ exists: true, data: () => patch }) };
    });
  };
}

function patchSystemEntry(tx, entry, data, patch, now) {
  const changed = Object.entries(patch).some(
    ([key, value]) =>
      JSON.stringify(data[key] ?? null) !== JSON.stringify(value),
  );
  if (!changed) return;
  tx.update(entry.ref, {
    ...patch,
    revision: (data.revision || 0) + 1,
    lastRequestId: null,
    lastRequestAction: null,
    updatedAt: Timestamp.fromDate(now),
  });
}

// Re-read current truth for every delivery, including delayed/duplicate events.
async function reconcileMomentRegistration(
  db,
  { stakeId, activityId, registrationId },
  clock = () => new Date(),
) {
  const parent = activityRef(db, { stakeId, activityId }),
    moments = await parent
      .collection("moments")
      .limit(MAX_MOMENTS + 1)
      .get();
  for (const snap of moments.docs)
    await runTransactionWithRetry(db, async (tx) => {
      const [registration, moment, entry] = await tx.getAll(
        parent.collection("registrations").doc(registrationId),
        snap.ref,
        snap.ref.collection("entries").doc(registrationId),
      );
      if (!moment.exists || !entry.exists) return;
      const owner = registration.exists
        ? registrationOwnerUid(registrationId, registration.data())
        : null;
      const ownerProfile = owner
        ? await tx.get(db.doc(`users/${owner}`))
        : null;
      const data = entry.data(),
        config = moment.data(),
        now = clock();
      const active =
        ownerProfile?.exists && isMomentRegistrationActive(registration.data());
      const sameOwner = owner && data.ownerUids.includes(owner);
      if (!active || !sameOwner) {
        if (data.status === "approved") updateTaken(tx, snap.ref, config, -1);
        patchSystemEntry(
          tx,
          entry,
          data,
          {
            status: "withdrawn",
            withdrawnReason: sameOwner
              ? data.status === "approved"
                ? "registration_inactive"
                : data.withdrawnReason || null
              : "ownership_changed",
            ownerUids: sameOwner && ownerProfile?.exists ? [owner] : [],
            restoreBlockedReason: null,
          },
          now,
        );
      } else if (
        data.status === "withdrawn" &&
        data.withdrawnReason === "registration_inactive"
      ) {
        const activity = await tx.get(parent);
        const open =
          activity.exists &&
          visibleActivity(activity.data()) &&
          isParticipationOpen(config, now);
        const full = config.slots[0].taken >= config.slots[0].capacity;
        if (open && !full) {
          updateTaken(tx, snap.ref, config, 1);
          patchSystemEntry(
            tx,
            entry,
            data,
            {
              status: "approved",
              withdrawnReason: null,
              restoreBlockedReason: null,
            },
            now,
          );
        } else
          patchSystemEntry(
            tx,
            entry,
            data,
            { restoreBlockedReason: full ? "full" : "closed" },
            now,
          );
      }
    });
}
async function assertDeletedMomentIdentity(db, auth, uid, tx) {
  try {
    await auth.getUser(uid);
    const error = new Error("Identità ancora esistente.");
    error.code = "account_exists";
    throw error;
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
  }
  const profile = tx
    ? await tx.get(db.doc(`users/${uid}`))
    : await db.doc(`users/${uid}`).get();
  if (profile.exists) {
    const error = new Error("Profilo ancora esistente.");
    error.code = "profile_exists";
    throw error;
  }
}
async function cleanupMomentsForUser(db, auth, uid) {
  let changed = 0,
    cursor = null;
  try {
    await assertDeletedMomentIdentity(db, auth, uid);
    for (;;) {
      let query = db
        .collectionGroup("entries")
        .where("ownerUids", "array-contains", uid)
        .limit(200);
      if (cursor) query = query.startAfter(cursor);
      const entries = await query.get();
      if (entries.empty) break;
      const own = entries.docs.filter((snap) =>
        /^stakes\/[^/]+\/activities\/[^/]+\/moments\/[^/]+\/entries\/[^/]+$/.test(
          snap.ref.path,
        ),
      );
      for (const entry of own) {
        const updated = await runTransactionWithRetry(db, async (tx) => {
          await assertDeletedMomentIdentity(db, auth, uid, tx);
          const [current, moment] = await tx.getAll(
            entry.ref,
            entry.ref.parent.parent,
          );
          if (!current.exists || !current.data().ownerUids.includes(uid))
            return false;
          if (current.data().status === "approved" && moment.exists)
            updateTaken(tx, moment.ref, moment.data(), -1);
          tx.update(entry.ref, {
            ownerUids: current.data().ownerUids.filter((id) => id !== uid),
            status: "withdrawn",
            withdrawnReason: "account_deleted",
            restoreBlockedReason: null,
            revision: (current.data().revision || 0) + 1,
            lastRequestId: null,
            lastRequestAction: null,
            updatedAt: FieldValue.serverTimestamp(),
          });
          return true;
        });
        if (updated) changed++;
      }
      cursor = entries.docs[entries.docs.length - 1];
      if (entries.size < 200) break;
    }
    return { changed };
  } catch (error) {
    if (["account_exists", "profile_exists"].includes(error.code))
      return { changed, skipped: error.code };
    throw error;
  }
}
async function cleanupDeletedMomentsActivity(db, ids) {
  const parent = activityRef(db, ids);
  if ((await parent.get()).exists) return false;
  // listDocuments includes missing moment parents with orphaned entries.
  // Each moment stays discoverable until its last child batch is removed.
  const moments = await parent.collection("moments").listDocuments();
  for (const moment of moments) {
    for (;;) {
      const entries = await moment.collection("entries").limit(200).get();
      if (entries.empty) break;
      const removed = await runTransactionWithRetry(db, async (tx) => {
        if ((await tx.get(parent)).exists) return false;
        const current = await tx.getAll(
          ...entries.docs.map((snap) => snap.ref),
        );
        for (const snap of current) if (snap.exists) tx.delete(snap.ref);
        return true;
      });
      if (!removed) return false;
    }
    const removed = await runTransactionWithRetry(db, async (tx) => {
      if ((await tx.get(parent)).exists) return false;
      const current = await tx.get(moment);
      if (current.exists) tx.delete(moment);
      return true;
    });
    if (!removed) return false;
  }
  return true;
}
const momentsAdmin = onCall(
  { region: REGION, timeoutSeconds: 60 },
  createMomentsAdminHandler(),
);
const momentsParticipant = onCall(
  { region: REGION, timeoutSeconds: 60 },
  createMomentsParticipantHandler(),
);
const onMomentRegistrationChanged = onDocumentWritten(
  {
    region: REGION,
    retry: true,
    document:
      "stakes/{stakeId}/activities/{activityId}/registrations/{registrationId}",
  },
  async (event) => {
    const before = event.data?.before.data(),
      after = event.data?.after.data();
    if (!before) return; // A newly created registration cannot have program entries yet.
    if (
      before &&
      after &&
      ["registrationStatus", "status", "parentUid", "userId"].every(
        (key) => before[key] === after[key],
      )
    )
      return;
    await reconcileMomentRegistration(getFirestore(), event.params);
  },
);
const onMomentsActivityDeleted = onDocumentDeleted(
  {
    region: REGION,
    retry: true,
    document: "stakes/{stakeId}/activities/{activityId}",
  },
  (event) => cleanupDeletedMomentsActivity(getFirestore(), event.params),
);
const onMomentsUserDeleted = onDocumentDeleted(
  { region: REGION, retry: true, document: "users/{uid}" },
  (event) => cleanupMomentsForUser(getFirestore(), getAuth(), event.params.uid),
);
module.exports = {
  momentsAdmin,
  momentsParticipant,
  onMomentRegistrationChanged,
  onMomentsActivityDeleted,
  onMomentsUserDeleted,
  createMomentsAdminHandler,
  createMomentsParticipantHandler,
  reconcileMomentRegistration,
  cleanupMomentsForUser,
  cleanupDeletedMomentsActivity,
};
