/**
 * Scelte su foto e social dopo la firma: cambio e revoca senza rifare il
 * modulo, compito per gli admin quando un consenso viene revocato, richiesta
 * di completamento ai genitori delle firme raccolte con "senza risposta".
 *
 * Due strade per cambiare le scelte, stessa callable:
 *  - genitore con account (`/family`): `stakeId/activityId/registrationId`,
 *    autorizzato da `registration.parentUid == auth.uid`;
 *  - genitore senza account: `token` di un link di gestione
 *    (`parentConsentLinks`, solo server) arrivato per email.
 * Il PDF firmato non si rigenera: fanno fede i campi, `consentUpdatedAt` e il
 * log di audit.
 */

const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

const { REGION } = require("./config");
const {
  sendConsentCompletionEmail,
  sendConsentReceiptEmail,
  buildConsentCompletionContent,
  consentCompletionSubject,
} = require("./brevo");
const {
  CONSENT_TEXT_VERSION,
  deriveConsentLinkStatus,
  hashLinkToken,
  isUnanswered,
  issueConsentLink,
  resolveConsentUpdate,
} = require("./consentCore");
const { consentHelpers } = require("./parentAuthorization");

const {
  BREVO_API_KEY,
  assertAdminForStake,
  buildConsentUrl,
  loadActivity,
  loadRegistration,
  normalizeEmail,
  writeAuditLog,
} = consentHelpers;

const MAX_COMPLETION_BATCH = 100;

const LINK_ERROR_MESSAGES = {
  expired:
    "Questo link è scaduto. Per riceverne uno nuovo contatta il dirigente della tua unità.",
  not_found: "Link non valido. Controlla di aver aperto l'ultima email ricevuta.",
  mismatch:
    "Questo link non è più valido perché l'indirizzo email del genitore è cambiato. Controlla l'email più recente.",
};

function asString(value) {
  return typeof value === "string" ? value : "";
}

function isCancelled(registration) {
  return (
    registration.status === "cancelled" || registration.registrationStatus === "cancelled"
  );
}

function registrationPath(stakeId, activityId, registrationId) {
  return `stakes/${stakeId}/activities/${activityId}/registrations/${registrationId}`;
}

function effectiveValue(value) {
  return value === "accepted" || value === "refused" || value === "revoked"
    ? value
    : "not_answered";
}

async function loadLinkByRawToken(db, rawToken) {
  const snapshot = await db.doc(`parentConsentLinks/${hashLinkToken(rawToken)}`).get();
  return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
}

/** Risolve il link in iscrizione valida, o lancia un errore italiano. */
async function resolveLink(db, rawToken) {
  const link = await loadLinkByRawToken(db, rawToken);
  const registration = link
    ? await loadRegistration(db, link.stakeId, link.activityId, link.registrationId)
    : null;
  const status = deriveConsentLinkStatus(link, registration);
  return { link, registration, status };
}

// =============================================================================
// Contesto pubblico per la pagina dei link
// =============================================================================

const parentConsentGetContext = onCall({ region: REGION, cors: true }, async (request) => {
  const rawToken = asString(request.data?.token).trim();
  if (!rawToken) {
    throw new HttpsError("invalid-argument", "Link non valido.");
  }

  const db = getFirestore();
  const { link, registration, status } = await resolveLink(db, rawToken);
  if (status !== "valid") {
    return { status };
  }

  const state = registration.parentAuthorization || {};
  if (state.status !== "authorized") {
    return { status: "not_signed" };
  }
  const activity = await loadActivity(db, link.stakeId, link.activityId);
  return {
    status: "valid",
    activityTitle: activity?.title || "",
    activityStartDate: activity?.startDate || "",
    activityEndDate: activity?.endDate || "",
    participantName: registration.fullName || "",
    photoConsent: effectiveValue(state.photoConsent),
    socialPublicationConsent: effectiveValue(state.socialPublicationConsent),
    consentUpdatedAt: state.consentUpdatedAt || state.authorizedAt || null,
  };
});

// =============================================================================
// Cambio delle scelte
// =============================================================================

const parentConsentUpdate = onCall(
  { region: REGION, secrets: [BREVO_API_KEY], cors: true },
  async (request) => {
    const db = getFirestore();
    const rawToken = asString(request.data?.token).trim();

    let stakeId;
    let activityId;
    let registrationId;
    let via;
    let tokenHash = null;

    if (rawToken) {
      const { link, status } = await resolveLink(db, rawToken);
      if (status !== "valid") {
        throw new HttpsError("failed-precondition", LINK_ERROR_MESSAGES[status], {
          reason: `link_${status}`,
        });
      }
      ({ stakeId, activityId, registrationId } = link);
      tokenHash = link.tokenHash;
      via = "link";
    } else {
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "Login richiesto.");
      }
      stakeId = asString(request.data?.stakeId).trim();
      activityId = asString(request.data?.activityId).trim();
      registrationId = asString(request.data?.registrationId).trim();
      if (!stakeId || !activityId || !registrationId) {
        throw new HttpsError("invalid-argument", "Parametri mancanti.");
      }
      via = "family";
    }

    const registrationRef = db.doc(registrationPath(stakeId, activityId, registrationId));
    const now = new Date().toISOString();
    let notifyAdmins = null;
    let receiptTarget = null;

    const outcome = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(registrationRef);
      if (!snapshot.exists) {
        throw new HttpsError("not-found", "Iscrizione non trovata.");
      }
      const registration = snapshot.data();

      if (via === "family" && registration.parentUid !== request.auth.uid) {
        throw new HttpsError(
          "permission-denied",
          "Puoi cambiare le scelte solo per i tuoi figli.",
        );
      }

      const state =
        registration.parentAuthorization && typeof registration.parentAuthorization === "object"
          ? registration.parentAuthorization
          : {};
      if (state.status !== "authorized") {
        throw new HttpsError(
          "failed-precondition",
          "Il modulo di autorizzazione non è ancora firmato: le scelte si danno al momento della firma.",
        );
      }

      const update = resolveConsentUpdate(state, request.data);
      if (!update.changed) {
        return { changed: false, update };
      }

      tx.update(registrationRef, {
        "parentAuthorization.photoConsent": update.photoConsent,
        "parentAuthorization.socialPublicationConsent": update.socialPublicationConsent,
        "parentAuthorization.consentUpdatedAt": now,
        "parentAuthorization.consentTextVersion": CONSENT_TEXT_VERSION,
        "parentAuthorization.updatedAt": now,
        updatedAt: now,
      });

      await writeAuditLog(
        db,
        stakeId,
        activityId,
        registrationId,
        {
          tokenId: tokenHash,
          event: "consent_updated",
          parentEmail: state.parentEmail || null,
          parentName:
            `${state.parentFirstName || ""} ${state.parentLastName || ""}`.trim() || null,
          photoConsent: update.photoConsent,
          socialPublicationConsent: update.socialPublicationConsent,
          previousPhotoConsent: update.previousPhotoConsent,
          previousSocialPublicationConsent: update.previousSocialPublicationConsent,
          consentTextVersion: CONSENT_TEXT_VERSION,
          consentVia: via,
          actorUserId: via === "family" ? request.auth.uid : null,
        },
        tx,
      );

      if (update.photoRevoked || update.socialRevoked) {
        const taskRef = db
          .collection(`stakes/${stakeId}/activities/${activityId}/consentTasks`)
          .doc();
        const participantName = asString(registration.fullName).trim() || "iscritto";
        const kind = update.photoRevoked ? "photo_consent_revoked" : "social_consent_revoked";
        tx.set(taskRef, {
          id: taskRef.id,
          stakeId,
          activityId,
          registrationId,
          participantName,
          kind,
          title:
            kind === "photo_consent_revoked"
              ? `Consenso foto revocato per ${participantName}: controlla album e social`
              : `Consenso social revocato per ${participantName}: controlla i post pubblicati`,
          status: "todo",
          createdAt: now,
          doneAt: null,
          doneByUid: null,
        });
        notifyAdmins = { taskId: taskRef.id, kind };
      }

      receiptTarget = {
        parentEmail: normalizeEmail(state.parentEmail),
        parentName: `${state.parentFirstName || ""} ${state.parentLastName || ""}`.trim(),
        participantName: asString(registration.fullName),
      };
      return { changed: true, update };
    });

    const { update } = outcome;
    const result = {
      ok: true,
      changed: outcome.changed,
      photoConsent: update.photoConsent,
      socialPublicationConsent: update.socialPublicationConsent,
      receiptSent: false,
    };
    if (!outcome.changed) return result;

    // Ricevuta al genitore con la scelta nuova. Un errore di posta non annulla
    // il cambio: la scelta è già registrata e nel log.
    if (receiptTarget?.parentEmail) {
      try {
        const activity = await loadActivity(db, stakeId, activityId);
        const link = await issueConsentLink(db, {
          stakeId,
          activityId,
          registrationId,
          parentEmail: receiptTarget.parentEmail,
          kind: "receipt",
        });
        await sendConsentReceiptEmail({
          apiKey: BREVO_API_KEY.value(),
          parentEmail: receiptTarget.parentEmail,
          parentName: receiptTarget.parentName,
          participantName: receiptTarget.participantName,
          activityTitle: activity?.title || "",
          photoConsent: update.photoConsent,
          socialPublicationConsent: update.socialPublicationConsent,
          consentUrl: buildConsentUrl(link.rawToken),
        });
        result.receiptSent = true;
      } catch (error) {
        logger.error("Consent receipt email failed.", {
          stakeId,
          activityId,
          registrationId,
          error: error.message,
        });
      }
    }

    if (notifyAdmins) {
      logger.info("Consent revoked: admin task created.", {
        stakeId,
        activityId,
        registrationId,
        ...notifyAdmins,
      });
    }
    return result;
  },
);

// =============================================================================
// Richiesta di completamento ai genitori delle firme senza risposta
// =============================================================================

async function listCompletionCandidates(db, stakeId, activityId, { resend }) {
  const activityDocs = activityId
    ? [await db.doc(`stakes/${stakeId}/activities/${activityId}`).get()].filter(
        (doc) => doc.exists,
      )
    : (await db.collection(`stakes/${stakeId}/activities`).get()).docs;

  const candidates = [];
  let skippedAlreadyRequested = 0;
  let skippedNoEmail = 0;
  for (const activityDoc of activityDocs) {
    const activity = activityDoc.data() || {};
    const registrations = await db
      .collection(`stakes/${stakeId}/activities/${activityDoc.id}/registrations`)
      .where("parentAuthorization.status", "==", "authorized")
      .get();
    for (const doc of registrations.docs) {
      const registration = doc.data();
      if (isCancelled(registration)) continue;
      const state = registration.parentAuthorization || {};
      const missing = [];
      if (isUnanswered(state.photoConsent)) missing.push("photo");
      if (isUnanswered(state.socialPublicationConsent)) missing.push("social");
      if (missing.length === 0) continue;
      const parentEmail = normalizeEmail(state.parentEmail);
      if (!parentEmail) {
        skippedNoEmail += 1;
        continue;
      }
      if (state.consentCompletionRequestedAt && !resend) {
        skippedAlreadyRequested += 1;
        continue;
      }
      candidates.push({
        activityId: activityDoc.id,
        activityTitle: asString(activity.title),
        activityStartDate: asString(activity.startDate),
        registrationId: doc.id,
        participantName: asString(registration.fullName),
        parentName: `${state.parentFirstName || ""} ${state.parentLastName || ""}`.trim(),
        parentEmail,
        missing,
        alreadyRequestedAt: state.consentCompletionRequestedAt || null,
      });
    }
  }
  return { candidates, skippedAlreadyRequested, skippedNoEmail };
}

const parentConsentRequestCompletion = onCall(
  { region: REGION, secrets: [BREVO_API_KEY], cors: true, timeoutSeconds: 300 },
  async (request) => {
    const stakeId = asString(request.data?.stakeId).trim();
    const activityId = asString(request.data?.activityId).trim();
    if (!stakeId) {
      throw new HttpsError("invalid-argument", "Parametri mancanti.");
    }
    const db = getFirestore();
    await assertAdminForStake(db, request, stakeId);

    // Simulazione di default: si invia solo con dryRun === false esplicito.
    const dryRun = request.data?.dryRun !== false;
    const resend = request.data?.resend === true;

    const { candidates, skippedAlreadyRequested, skippedNoEmail } =
      await listCompletionCandidates(db, stakeId, activityId, { resend });

    const previewActivity = candidates[0];
    const preview = previewActivity
      ? {
          subject: consentCompletionSubject(previewActivity.activityTitle),
          paragraphs: buildConsentCompletionContent({
            parentName: previewActivity.parentName,
            participantName: previewActivity.participantName,
            activityTitle: previewActivity.activityTitle,
            consentUrl: null,
          }).paragraphs,
        }
      : null;

    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        total: candidates.length,
        skippedAlreadyRequested,
        skippedNoEmail,
        candidates,
        preview,
      };
    }

    // Chi invia ha visto una lista: il numero di destinatari deve coincidere.
    const expectedCount = Number(request.data?.expectedCount);
    if (!Number.isInteger(expectedCount) || expectedCount !== candidates.length) {
      throw new HttpsError(
        "failed-precondition",
        `I destinatari sono ${candidates.length}, non ${
          Number.isInteger(expectedCount) ? expectedCount : "il numero atteso"
        }: rifai la simulazione prima di inviare.`,
      );
    }
    if (candidates.length > MAX_COMPLETION_BATCH) {
      throw new HttpsError(
        "failed-precondition",
        `Troppi destinatari in un colpo solo (massimo ${MAX_COMPLETION_BATCH}): scegli una sola attività.`,
      );
    }

    const sent = [];
    const errors = [];
    for (const candidate of candidates) {
      const ref = db.doc(
        registrationPath(stakeId, candidate.activityId, candidate.registrationId),
      );
      const now = new Date().toISOString();

      // Prenota il turno: due invii in parallelo non mandano due mail.
      const claimed = await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        const state = snapshot.data()?.parentAuthorization || {};
        if (
          state.status !== "authorized" ||
          (state.consentCompletionRequestedAt && !resend) ||
          (!isUnanswered(state.photoConsent) && !isUnanswered(state.socialPublicationConsent))
        ) {
          return false;
        }
        tx.update(ref, { "parentAuthorization.consentCompletionRequestedAt": now });
        return true;
      });
      if (!claimed) continue;

      try {
        const link = await issueConsentLink(db, {
          stakeId,
          activityId: candidate.activityId,
          registrationId: candidate.registrationId,
          parentEmail: candidate.parentEmail,
          kind: "completion",
        });
        const result = await sendConsentCompletionEmail({
          apiKey: BREVO_API_KEY.value(),
          parentEmail: candidate.parentEmail,
          parentName: candidate.parentName,
          participantName: candidate.participantName,
          activityTitle: candidate.activityTitle,
          consentUrl: buildConsentUrl(link.rawToken),
        });
        await writeAuditLog(db, stakeId, candidate.activityId, candidate.registrationId, {
          event: "consent_completion_requested",
          parentEmail: candidate.parentEmail,
          parentName: candidate.parentName || null,
          actorUserId: request.auth.uid,
          emailProvider: result.provider === "brevo" ? "brevo" : "simulated",
          brevoMessageId: result.messageId || null,
        });
        sent.push({
          registrationId: candidate.registrationId,
          activityId: candidate.activityId,
          simulated: Boolean(result.simulated),
        });
      } catch (error) {
        // L'invio non è partito: libera la prenotazione per un nuovo tentativo.
        await ref.update({
          "parentAuthorization.consentCompletionRequestedAt": FieldValue.delete(),
        });
        errors.push({
          registrationId: candidate.registrationId,
          activityId: candidate.activityId,
          message: error.message ? error.message.slice(0, 200) : "unknown",
        });
        logger.error("Consent completion email failed.", {
          stakeId,
          activityId: candidate.activityId,
          registrationId: candidate.registrationId,
          error: error.message,
        });
      }
    }

    return {
      ok: true,
      dryRun: false,
      total: candidates.length,
      sent: sent.length,
      simulated: sent.filter((item) => item.simulated).length,
      errors,
    };
  },
);

module.exports = {
  parentConsentGetContext,
  parentConsentUpdate,
  parentConsentRequestCompletion,
};
