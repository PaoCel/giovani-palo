const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const webpush = require("web-push");

initializeApp();

const db = getFirestore();

// Cloud Functions per autorizzazione genitoriale (Brevo magic link).
const { EnvironmentConfigError, getAppPublicUrl, isProduction } = require("./lib/config");
const parentAuthorization = require("./lib/parentAuthorization");
const campManagement = require("./lib/campManagement");
const roomMates = require("./lib/roomMates");
const roomManagement = require("./lib/roomManagement");
const recordNight = require("./lib/recordNight");
const recordNightGuest = require("./lib/recordNightGuest");

exports.onRegistrationPendingParentAuth = parentAuthorization.onRegistrationPendingParentAuth;
exports.parentAuthorizationGetContext = parentAuthorization.parentAuthorizationGetContext;
exports.parentAuthorizationConfirm = parentAuthorization.parentAuthorizationConfirm;
exports.parentAuthorizationReject = parentAuthorization.parentAuthorizationReject;
exports.parentAuthorizationResend = parentAuthorization.parentAuthorizationResend;
exports.parentAuthorizationIssueOwnToken =
  parentAuthorization.parentAuthorizationIssueOwnToken;
exports.parentAuthorizationBackfillLegacyApprovals =
  parentAuthorization.parentAuthorizationBackfillLegacyApprovals;
exports.parentAuthorizationGetSignedConsentUrl =
  parentAuthorization.parentAuthorizationGetSignedConsentUrl;
exports.parentAuthorizationDownloadSignedConsentsZip =
  parentAuthorization.parentAuthorizationDownloadSignedConsentsZip;
exports.campManagementSave = campManagement.campManagementSave;
exports.roomMateSuggestions = roomMates.roomMateSuggestions;
exports.roomManagementSave = roomManagement.roomManagementSave;
exports.onRoomRegistrationDeleted = roomManagement.onRoomRegistrationDeleted;
exports.onRoomActivityDeleted = roomManagement.onRoomActivityDeleted;
exports.recordNightParticipant = recordNight.recordNightParticipant;
exports.recordNightAdmin = recordNight.recordNightAdmin;
exports.recordNightGuest = recordNightGuest.recordNightGuest;
exports.onRecordNightRegistrationChanged = recordNight.onRecordNightRegistrationChanged;
exports.onRecordNightActivityDeleted = recordNight.onRecordNightActivityDeleted;
const WEB_PUSH_PRIVATE_KEY = defineSecret("WEB_PUSH_PRIVATE_KEY");
const PRODUCTION_WEB_PUSH_PUBLIC_KEY = "BNXpBiGfPKrQKpHDW7d7-qYscOYyBZhhG3zFosp6_V9-Azmg5OLCWTb_Sib6v5wYaJkGOiGHBQ5MiNDjYbKH-p8";
const PRODUCTION_WEB_PUSH_SUBJECT = "https://giovani-palo.web.app";

// Identità VAPID dell'ambiente. Fuori da produzione la chiave pubblica arriva
// da WEB_PUSH_PUBLIC_KEY (coppia propria del progetto, con il secret
// WEB_PUSH_PRIVATE_KEY corrispondente) e non può essere quella di produzione.
function getWebPushIdentity() {
  if (isProduction()) {
    return {
      subject: PRODUCTION_WEB_PUSH_SUBJECT,
      publicKey: PRODUCTION_WEB_PUSH_PUBLIC_KEY,
    };
  }

  const publicKey = String(process.env.WEB_PUSH_PUBLIC_KEY || "").trim();
  if (!publicKey || publicKey === PRODUCTION_WEB_PUSH_PUBLIC_KEY) {
    throw new EnvironmentConfigError(
      "WEB_PUSH_PUBLIC_KEY mancante o uguale a quella di produzione.",
    );
  }

  const appUrl = getAppPublicUrl();
  return {
    subject: appUrl.startsWith("https://") ? appUrl : "mailto:supporto@gugditalia.it",
    publicKey,
  };
}

function nowIso() {
  return new Date().toISOString();
}

function getAlertId(activityId, registrationId) {
  return `registration_created_${activityId}_${registrationId}`;
}

function getRegistrationPayload(snapshot) {
  const data = snapshot.data() || {};

  return {
    fullName: typeof data.fullName === "string" ? data.fullName : "Nuovo iscritto",
    submittedByMode:
      data.submittedByMode === "anonymous" || data.submittedByMode === "parent"
        ? data.submittedByMode
        : "authenticated",
    linkedLaterToUserId:
      typeof data.linkedLaterToUserId === "string" ? data.linkedLaterToUserId : null,
  };
}

function getSubscriptionFromDevice(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const subscription = data.subscription;

  if (!subscription || typeof subscription !== "object") {
    return null;
  }

  if (
    typeof subscription.endpoint !== "string" ||
    !subscription.keys ||
    typeof subscription.keys !== "object" ||
    typeof subscription.keys.auth !== "string" ||
    typeof subscription.keys.p256dh !== "string"
  ) {
    return null;
  }

  return {
    endpoint: subscription.endpoint,
    expirationTime:
      typeof subscription.expirationTime === "number"
        ? subscription.expirationTime
        : null,
    keys: {
      auth: subscription.keys.auth,
      p256dh: subscription.keys.p256dh,
    },
  };
}

async function getEventTitle(stakeId, activityId) {
  const eventSnapshot = await db.doc(`stakes/${stakeId}/activities/${activityId}`).get();

  if (!eventSnapshot.exists) {
    return "attivita";
  }

  const data = eventSnapshot.data() || {};
  return typeof data.title === "string" && data.title.trim() ? data.title : "attivita";
}

async function writeAdminAlert({
  stakeId,
  activityId,
  registrationId,
  fullName,
  submittedByMode,
  eventTitle,
}) {
  const timestamp = nowIso();
  const alertId = getAlertId(activityId, registrationId);

  await db.doc(`stakes/${stakeId}/adminAlerts/${alertId}`).set(
    {
      type: "registration_created",
      stakeId,
      eventId: activityId,
      registrationId,
      eventTitle,
      participantName: fullName,
      submittedByMode,
      title: "Nuovo iscritto",
      message: `${fullName} si e iscritto a ${eventTitle}.`,
      severity: "info",
      active: true,
      readBy: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    { merge: true },
  );

  return alertId;
}

function createPushPayload({
  activityId,
  registrationId,
  fullName,
  eventTitle,
  alertId,
}) {
  return JSON.stringify({
    title: "Nuovo iscritto",
    body: `${fullName} si e iscritto a ${eventTitle}.`,
    tag: alertId,
    url: `/admin/events/${activityId}`,
    eventId: activityId,
    registrationId,
  });
}

function getPushErrorSummary(error) {
  if (!error || typeof error !== "object") {
    return {
      statusCode: null,
      headers: null,
      body: null,
      message: "Push notification delivery failed.",
    };
  }

  return {
    statusCode: "statusCode" in error ? error.statusCode ?? null : null,
    headers: "headers" in error ? error.headers ?? null : null,
    body: "body" in error ? error.body ?? null : null,
    message: error instanceof Error ? error.message : "Push notification delivery failed.",
  };
}

function getEndpointHost(endpoint) {
  if (typeof endpoint !== "string" || !endpoint) {
    return "unknown";
  }

  try {
    return new URL(endpoint).host;
  } catch (error) {
    return "invalid-endpoint";
  }
}

async function commitInChunks(refs, mutator) {
  const CHUNK = 400;
  for (let i = 0; i < refs.length; i += CHUNK) {
    const slice = refs.slice(i, i + CHUNK);
    const batch = db.batch();
    for (const ref of slice) batch.update(ref, mutator(ref));
    await batch.commit();
  }
}

exports.propagateUnitNameChange = onDocumentUpdated(
  {
    document: "stakes/{stakeId}/units/{unitId}",
    region: "europe-west1",
  },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    const beforeName = typeof before.name === "string" ? before.name : "";
    const afterName = typeof after.name === "string" ? after.name : "";

    if (beforeName === afterName) return;

    const { stakeId, unitId } = event.params;
    const ts = nowIso();

    logger.info("Propagating unit name change.", {
      stakeId,
      unitId,
      beforeName,
      afterName,
    });

    const activities = await db.collection(`stakes/${stakeId}/activities`).select().get();
    const regRefs = [];
    for (const act of activities.docs) {
      const regs = await act.ref
        .collection("registrations")
        .where("unitId", "==", unitId)
        .select("unitId")
        .get();
      for (const r of regs.docs) regRefs.push(r.ref);
    }

    // Gli id unità non sono unici fra pali (slug del nome): senza il filtro
    // sul palo una rinomina riscriverebbe il nome anche agli utenti di un
    // altro palo con un'unità omonima.
    const usersSnap = await db
      .collection("users")
      .where("stakeId", "==", stakeId)
      .where("unitId", "==", unitId)
      .select("unitId")
      .get();
    const userRefs = usersSnap.docs.map((d) => d.ref);

    await Promise.all([
      commitInChunks(regRefs, () => ({ unitNameSnapshot: afterName, updatedAt: ts })),
      commitInChunks(userRefs, () => ({ unitName: afterName, updatedAt: ts })),
    ]);

    logger.info("Unit name propagation complete.", {
      stakeId,
      unitId,
      registrationsUpdated: regRefs.length,
      usersUpdated: userRefs.length,
    });
  },
);

exports.sendAdminPushForNewRegistration = onDocumentCreated(
  {
    document: "stakes/{stakeId}/activities/{activityId}/registrations/{registrationId}",
    region: "europe-west1",
    secrets: [WEB_PUSH_PRIVATE_KEY],
  },
  async (event) => {
    const snapshot = event.data;

    if (!snapshot) {
      logger.warn("Registration trigger invoked without snapshot data.", {
        eventId: event.id,
      });
      return;
    }

    const { stakeId, activityId, registrationId } = event.params;
    const registration = getRegistrationPayload(snapshot);

    if (registration.linkedLaterToUserId) {
      logger.info("Skipping push for guest registration linked later to an account.", {
        stakeId,
        activityId,
        registrationId,
      });
      return;
    }

    const [eventTitle, devicesSnapshot] = await Promise.all([
      getEventTitle(stakeId, activityId),
      db.collection(`stakes/${stakeId}/adminPushDevices`).get(),
    ]);

    const alertId = await writeAdminAlert({
      stakeId,
      activityId,
      registrationId,
      fullName: registration.fullName,
      submittedByMode: registration.submittedByMode,
      eventTitle,
    });

    if (devicesSnapshot.empty) {
      logger.info("No admin push devices registered for stake.", {
        stakeId,
        activityId,
        registrationId,
      });
      return;
    }

    let webPushIdentity;
    try {
      webPushIdentity = getWebPushIdentity();
    } catch (error) {
      if (!(error instanceof EnvironmentConfigError)) throw error;
      logger.warn("Push admin disattivato: configurazione dell'ambiente incompleta.", {
        stakeId,
        activityId,
        registrationId,
        detail: error.message,
      });
      return;
    }

    webpush.setVapidDetails(
      webPushIdentity.subject,
      webPushIdentity.publicKey,
      WEB_PUSH_PRIVATE_KEY.value(),
    );

    const payload = createPushPayload({
      activityId,
      registrationId,
      fullName: registration.fullName,
      eventTitle,
      alertId,
    });
    const deliveryTimestamp = nowIso();
    const staleDeviceIds = [];

    await Promise.allSettled(
      devicesSnapshot.docs.map(async (deviceDocument) => {
        const data = deviceDocument.data();
        const subscription = getSubscriptionFromDevice(data);

        if (!subscription) {
          staleDeviceIds.push(deviceDocument.id);
          return;
        }

        try {
          const endpointHost = getEndpointHost(subscription.endpoint);

          await webpush.sendNotification(subscription, payload, {
            TTL: 60 * 60,
            urgency: "high",
          });

          await deviceDocument.ref.set(
            {
              updatedAt: deliveryTimestamp,
              lastDeliveredAt: deliveryTimestamp,
              lastError: null,
              lastEndpointHost: endpointHost,
            },
            { merge: true },
          );
        } catch (error) {
          const endpointHost = getEndpointHost(subscription.endpoint);
          const { statusCode, headers, body, message } = getPushErrorSummary(error);

          logger.write({
            severity: "ERROR",
            message: "Unable to send admin push notification.",
            stakeId,
            activityId,
            registrationId,
            deviceId: deviceDocument.id,
            endpointHost,
            statusCode,
            responseBody: body,
            responseHeaders: headers,
            errorMessage: message,
          });

          if (statusCode === 404 || statusCode === 410) {
            staleDeviceIds.push(deviceDocument.id);
            return;
          }

          await deviceDocument.ref.set(
            {
              updatedAt: deliveryTimestamp,
              lastEndpointHost: endpointHost,
              lastError:
                [
                  statusCode,
                  typeof body === "string" ? body : body ? JSON.stringify(body) : null,
                  message,
                ]
                  .filter((value) => Boolean(value))
                  .join(" | ") ||
                "Push notification delivery failed.",
            },
            { merge: true },
          );
        }
      }),
    );

    if (staleDeviceIds.length > 0) {
      const batch = db.batch();

      for (const deviceId of staleDeviceIds) {
        batch.delete(db.doc(`stakes/${stakeId}/adminPushDevices/${deviceId}`));
      }

      await batch.commit();
    }
  },
);
