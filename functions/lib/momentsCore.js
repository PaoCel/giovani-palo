const { HttpsError } = require("firebase-functions/v2/https");
const { createHash } = require("node:crypto");
const { assertExactKeys, pathId, cleanLine } = require("./recordNight");

const MOMENT_TYPES = ["info", "turni"];
const MAX_MOMENTS = 50;
const MAX_CAPACITY = 2000;
const MAX_PEOPLE = 100;
const ACTIVE_REGISTRATION_STATUSES = new Set([
  "active",
  "confirmed",
  "pending_parent_authorization",
]);
function isMomentRegistrationActive(registration) {
  return (
    registration !== null &&
    typeof registration === "object" &&
    !Array.isArray(registration) &&
    registration.status !== "cancelled" &&
    (registration.registrationStatus == null ||
      ACTIVE_REGISTRATION_STATUSES.has(registration.registrationStatus))
  );
}
function registrationOwnerUid(id, data) {
  if (!data) return null;
  if (id.startsWith("user_") && id.length > 5) return id.slice(5);
  if (
    typeof data.parentUid === "string" &&
    data.parentUid &&
    id.startsWith(`child_${data.parentUid}_`)
  )
    return data.parentUid;
  return null;
}
function parseIso(value, label, optional = false) {
  if (optional && (value === undefined || value === null || value === ""))
    return null;
  const match =
    typeof value === "string" &&
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) throw new HttpsError("invalid-argument", `${label} non valido.`);
  const [, year, month, day, hour, minute, second] = match;
  const numericYear = Number(year);
  const leapYear =
    numericYear % 4 === 0 &&
    (numericYear % 100 !== 0 || numericYear % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (
    numericYear < 1 ||
    +month < 1 ||
    +month > 12 ||
    +day < 1 ||
    +day > daysInMonth[Number(month) - 1] ||
    +hour > 23 ||
    +minute > 59 ||
    +(second || 0) > 59
  ) {
    throw new HttpsError("invalid-argument", `${label} non valido.`);
  }
  const date = new Date(value);
  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() < 1 ||
    date.getUTCFullYear() > 9999
  )
    throw new HttpsError("invalid-argument", `${label} non valido.`);
  return date.toISOString();
}
function textBlock(value) {
  if (value === undefined || value === null) return "";
  if (
    typeof value !== "string" ||
    value.trim().length > 600 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  )
    throw new HttpsError("invalid-argument", "Descrizione non valida.");
  return value.trim();
}
function parseMomentFields(raw) {
  assertExactKeys(
    raw,
    [
      "type",
      "title",
      "startsAt",
      "endsAt",
      "place",
      "description",
      "capacity",
      "customWindow",
      "opensAt",
      "closesAt",
    ],
    "Momento",
  );
  if (!MOMENT_TYPES.includes(raw.type))
    throw new HttpsError("invalid-argument", "Tipo di momento non valido.");
  const startsAt = parseIso(raw.startsAt, "Inizio");
  const endsAt = parseIso(raw.endsAt, "Fine", true) || startsAt;
  if (endsAt < startsAt)
    throw new HttpsError(
      "invalid-argument",
      "La fine non può precedere l'inizio.",
    );
  let capacity = null,
    opensAt = null,
    closesAt = null;
  const customWindow = raw.customWindow === true;
  if (raw.customWindow !== undefined && typeof raw.customWindow !== "boolean")
    throw new HttpsError(
      "invalid-argument",
      "Finestra di iscrizione non valida.",
    );
  if (raw.type === "turni") {
    capacity = raw.capacity;
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY)
      throw new HttpsError(
        "invalid-argument",
        `Indica da 1 a ${MAX_CAPACITY} posti.`,
      );
    if (customWindow) {
      opensAt = parseIso(raw.opensAt, "Apertura iscrizioni");
      closesAt = parseIso(raw.closesAt, "Chiusura iscrizioni");
      if (closesAt <= opensAt)
        throw new HttpsError(
          "invalid-argument",
          "La chiusura deve essere dopo l'apertura.",
        );
    } else if (raw.opensAt || raw.closesAt)
      throw new HttpsError(
        "invalid-argument",
        "Attiva la finestra personalizzata per modificare le scadenze.",
      );
  } else if (
    (raw.capacity !== undefined && raw.capacity !== null) ||
    customWindow ||
    raw.opensAt ||
    raw.closesAt
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Un momento informativo non raccoglie iscrizioni.",
    );
  }
  return {
    type: raw.type,
    title: cleanLine(raw.title, "Titolo", 80, true),
    startsAt,
    endsAt,
    place: cleanLine(raw.place, "Luogo", 80, false),
    description: textBlock(raw.description),
    capacity,
    customWindow,
    opensAt,
    closesAt,
  };
}
function parseMomentRequest(data, actor) {
  const actions =
    actor === "admin"
      ? [
          "context",
          "save",
          "publish",
          "hide",
          "show",
          "draft",
          "delete",
          "roster",
        ]
      : ["context", "join", "withdraw"];
  if (!data || !actions.includes(data.action))
    throw new HttpsError("invalid-argument", "Azione non valida.");
  const allowed = ["action", "stakeId", "activityId"];
  if (data.action !== "context") allowed.push("momentId");
  if (actor === "admin" && !["context", "roster"].includes(data.action))
    allowed.push("expectedRevision", "requestId");
  if (data.action === "save") allowed.push("fields");
  if (actor === "participant" && data.action !== "context")
    allowed.push("registrationId", "expectedRevision", "requestId");
  assertExactKeys(data, allowed, "Richiesta");
  const parsed = {
    action: data.action,
    stakeId: pathId(data.stakeId, "Palo"),
    activityId: pathId(data.activityId, "Attività"),
  };
  if (data.action !== "context")
    parsed.momentId = pathId(data.momentId, "Momento");
  if (actor === "admin" && !["context", "roster"].includes(data.action)) {
    if (
      data.expectedRevision !== null &&
      (!Number.isInteger(data.expectedRevision) || data.expectedRevision < 1)
    )
      throw new HttpsError("invalid-argument", "Revisione non valida.");
    parsed.expectedRevision = data.expectedRevision;
    parsed.requestId = pathId(data.requestId, "Richiesta");
  }
  if (data.action === "save") parsed.fields = parseMomentFields(data.fields);
  if (actor === "participant" && data.action !== "context") {
    parsed.registrationId = pathId(data.registrationId, "Partecipante");
    if (
      data.expectedRevision !== null &&
      (!Number.isInteger(data.expectedRevision) || data.expectedRevision < 0)
    )
      throw new HttpsError(
        "invalid-argument",
        "Revisione della partecipazione non valida.",
      );
    parsed.expectedRevision = data.expectedRevision;
    parsed.requestId = pathId(data.requestId, "Richiesta");
  }
  return parsed;
}
function requestFingerprint(input) {
  return createHash("sha256")
    .update(
      JSON.stringify({ action: input.action, fields: input.fields || null }),
    )
    .digest("hex");
}
function isParticipationOpen(moment, now) {
  const ts = (value) => value?.toMillis?.() ?? new Date(value).getTime();
  return (
    moment?.type === "turni" &&
    moment.status === "published" &&
    ts(moment.visibleFromTs) <= now.getTime() &&
    ts(moment.participation?.opensAtTs) <= now.getTime() &&
    now.getTime() < ts(moment.participation?.closesAtTs)
  );
}
module.exports = {
  MOMENT_TYPES,
  MAX_MOMENTS,
  MAX_CAPACITY,
  MAX_PEOPLE,
  isMomentRegistrationActive,
  registrationOwnerUid,
  parseMomentFields,
  parseMomentRequest,
  requestFingerprint,
  isParticipationOpen,
};
