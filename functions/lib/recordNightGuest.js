// Notte dei Record: richieste di chi non ha un account
// (docs/NOTTE_DEI_RECORD_SENZA_ACCOUNT.md, fonte di verità).
//
// Callable `recordNightGuest`: il "telefono" è una sessione anonima Firebase.
// Chi la usa può segnarsi a un record (proporne uno o sfidarne uno) con nome,
// cognome e unità; la richiesta NON conta e non la vede nessuno finché lo staff
// non la collega a un'iscrizione (azioni linkRequest & co. in recordNight.js).
// Le richieste stanno in `stakes/{s}/activities/{a}/recordRequests/{id}`: le
// rules negano ogni accesso ai client, passa tutto da qui (Admin SDK).
//
// Principi che questo file deve tenere:
// - `submit` NON legge le iscrizioni né le richieste degli altri per decidere la
//   risposta: legge solo le richieste dello STESSO telefono (tetti e idempotenza)
//   e il conteggio delle aperte dell'attività. Un nome iscritto, uno sconosciuto
//   e un duplicato ricevono la stessa forma di risposta, gli stessi messaggi e
//   le stesse letture.
// - `mine` restituisce solo i campi elencati in `buildMineItem`, mai un
//   documento intero: niente id o nome dell'iscrizione, niente altri tentativi,
//   niente contatori, niente nota dello staff.
// - Dopo il collegamento il telefono vede solo lo stato; ritirare o ripristinare
//   una richiesta collegata è impossibile e l'errore è lo stesso di ogni altro
//   caso (richiesta altrui, inesistente, scaduta).
// - Nessun nome, testo o dato di minore nei log: azione, id, anonUid.
// - Ogni azione legge e scrive in UNA transazione (letture prima delle scritture).
//
// Risposte (tutte `{ ok: true, action, ... }`):
//   context  -> { open, closeAt, intakeOpen, units: [{id,name}], records: [{id,title,category,measure,durationSeconds}] }
//   submit   -> { requestId }
//   mine     -> { open, closeAt, requests: [ vedi buildMineItem ] }
//   withdraw -> { requestId, state }      (state: "withdrawn")
//   restore  -> { requestId, state }      (state: "received")

const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

const { REGION } = require("./config");
const { normalizeName } = require("./nameMatch");
const {
  MAX_OPEN_REQUESTS_PER_ACTIVITY,
  REQUEST_KINDS,
  cleanLine,
  getParticipantWindow,
  isRequestExpired,
  parseProposalFields,
  parseRequestEnvelope,
  pathId,
  refsFor,
  resolveCloseAt,
  toDate,
  view,
} = require("./recordNight");

// Tetti per ingressi in `open` iniziati dal telefono (submit e restore). Sono un
// freno agli errori e ai dispetti, non una difesa: una sessione anonima è gratis.
const MAX_OPEN_PER_PHONE = 6;
const MAX_CREATED_PER_PHONE = 20;
const MAX_OPEN_PER_PERSON = 2;

const NAME_MIN_LENGTH = 2;
const NAME_MAX_LENGTH = 40;
// Lettere (anche accentate), spazio, apostrofo, trattino: separatori solo fra
// lettere. Niente cifre, URL, markup.
const NAME_PATTERN = /^\p{L}[\p{L}\p{M}]*(?:(?: ?['-] ?| )\p{L}[\p{L}\p{M}]*)*$/u;

// Conservazione: data di inizio dell'attività + 7 giorni; senza data di inizio,
// chiusura delle iscrizioni + 14 giorni.
const EXPIRY_AFTER_START_DAYS = 7;
const EXPIRY_AFTER_CLOSE_DAYS = 14;
const FALLBACK_EXPIRY_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

const MESSAGES = Object.freeze({
  account: "Hai un account: accedi",
  disabled: "La Notte dei Record non è attiva per questa attività.",
  closed: "Le iscrizioni ai record sono chiuse.",
  phoneCap: "Hai già inviato il massimo di richieste da questo telefono.",
  // Coda piena, interruttore spento, richiesta non gestibile: stesso testo, senza dire perché.
  unavailable: "Non riesco a riceverla ora. Parlane con il dirigente della tua unità.",
});

const GUEST_ACTION_KEYS = Object.freeze({
  context: [],
  submit: [
    "submissionId",
    "kind",
    "firstName",
    "lastName",
    "unitId",
    "text",
    "measure",
    "durationSeconds",
    "needs",
    "recordId",
  ],
  mine: [],
  withdraw: ["requestId"],
  restore: ["requestId"],
});

// ---------------------------------------------------------------------------
// Validazione input
// ---------------------------------------------------------------------------

function isBlank(value) {
  return value === undefined || value === null || value === "";
}

// Nome o cognome: 2-40 caratteri, lettere (anche accentate), spazio, apostrofo,
// trattino. L'apostrofo tipografico diventa ASCII e il testo va in forma NFC.
function parsePersonName(value, label) {
  const line = cleanLine(value, label, NAME_MAX_LENGTH, true);
  const text = line.normalize("NFC").replace(/’/gu, "'");
  if (text.length < NAME_MIN_LENGTH) {
    throw new HttpsError("invalid-argument", `Campo «${label}» troppo corto (minimo ${NAME_MIN_LENGTH} caratteri).`);
  }
  if (!NAME_PATTERN.test(text)) {
    throw new HttpsError("invalid-argument", `Campo «${label}» non valido: solo lettere, spazio, apostrofo e trattino.`);
  }
  return text;
}

function parseSubmitFields(data) {
  const kind = typeof data.kind === "string" && REQUEST_KINDS.includes(data.kind) ? data.kind : null;
  if (!kind) throw new HttpsError("invalid-argument", "Campo «Tipo» non valido.");
  const fields = {
    submissionId: pathId(data.submissionId, "submissionId"),
    kind,
    firstName: parsePersonName(data.firstName, "Nome"),
    lastName: parsePersonName(data.lastName, "Cognome"),
    unitId: pathId(data.unitId, "unitId"),
    text: null,
    measure: null,
    durationSeconds: null,
    needs: "",
    recordId: null,
  };
  if (kind === "proposal") {
    if (!isBlank(data.recordId)) throw new HttpsError("invalid-argument", "Campo «recordId» non ammesso in una proposta.");
    const proposal = parseProposalFields(data);
    return { ...fields, ...proposal };
  }
  for (const key of ["text", "measure", "durationSeconds", "needs"]) {
    if (!isBlank(data[key])) {
      throw new HttpsError("invalid-argument", `Campo «${key}» non ammesso in una sfida.`);
    }
  }
  return { ...fields, recordId: pathId(data.recordId, "recordId") };
}

function parseGuestRequest(data) {
  const base = parseRequestEnvelope(data, GUEST_ACTION_KEYS);
  switch (base.action) {
    case "submit":
      return { ...base, fields: parseSubmitFields(data) };
    case "withdraw":
    case "restore":
      return { ...base, fields: { requestId: pathId(data.requestId, "requestId") } };
    default:
      return { ...base, fields: {} };
  }
}

// ---------------------------------------------------------------------------
// Logica pura
// ---------------------------------------------------------------------------

// `nome cognome|unitId` senza maiuscole né accenti: serve al tetto per persona e
// al raggruppamento dei duplicati dello staff. Il confronto con le iscrizioni NON
// passa da qui.
function personKeyOf(firstName, lastName, unitId) {
  const part = (value) => normalizeName(value) || String(value || "").toLocaleLowerCase("it-IT").trim();
  return `${part(firstName)} ${part(lastName)}|${unitId}`;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

// Scadenza della richiesta (campo TTL `expiresAt`): inizio attività + 7 giorni;
// solo se manca la data di inizio, chiusura + 14 giorni. Se la scadenza è già
// passata restituisce null: la richiesta nascerebbe "inesistente", quindi chi
// chiama non la crea (le iscrizioni sono da considerare chiuse).
function resolveRequestExpiry(activity, now) {
  const start = toDate(activity.startDate);
  if (start) {
    const expires = addDays(start, EXPIRY_AFTER_START_DAYS);
    return expires.getTime() > now.getTime() ? expires : null;
  }
  const closeAt = resolveCloseAt(activity);
  if (closeAt) {
    const expires = addDays(closeAt, EXPIRY_AFTER_CLOSE_DAYS);
    return expires.getTime() > now.getTime() ? expires : null;
  }
  return addDays(now, FALLBACK_EXPIRY_DAYS);
}

// Tetti del telefono per un ingresso in `open` (submit e restore), sui dati già
// letti per `anonUid`: `phoneRequests` = richieste dello stesso telefono (dati
// piatti, non scadute). `countCreated`: solo `submit` crea (il tetto di 20 create
// in tutto non si applica a `restore`). Si controllano PRIMA di contare la coda
// dell'attività, che costa una lettura in più e un lock condiviso.
function assertPhoneCaps({ phoneRequests, personKey, countCreated }) {
  const open = phoneRequests.filter((request) => request.status === "open");
  if (open.length >= MAX_OPEN_PER_PHONE) throw new HttpsError("failed-precondition", MESSAGES.phoneCap);
  if (countCreated && phoneRequests.length >= MAX_CREATED_PER_PHONE) {
    throw new HttpsError("failed-precondition", MESSAGES.phoneCap);
  }
  if (open.filter((request) => request.personKey === personKey).length >= MAX_OPEN_PER_PERSON) {
    throw new HttpsError("failed-precondition", MESSAGES.phoneCap);
  }
}

// Tetto della coda: `openInActivity` = quante richieste `open` ha l'attività in tutto.
function assertActivityCap(openInActivity) {
  if (openInActivity >= MAX_OPEN_REQUESTS_PER_ACTIVITY) {
    throw new HttpsError("failed-precondition", MESSAGES.unavailable);
  }
}

// Stato mostrato al richiedente, derivato dalla richiesta e dal tentativo
// collegato (`entry` = null se non c'è o non esiste più):
//   open -> received · withdrawn -> withdrawn · rejected -> not_linked
//   linked + pending/approved/rejected -> pending/approved/rejected
//   linked + ritirato da chiunque (o tentativo sparito) -> removed
function deriveRequesterState(request, entry) {
  switch (request.status) {
    case "withdrawn":
      return "withdrawn";
    case "rejected":
      return "not_linked";
    case "linked":
      if (!entry) return "removed";
      if (entry.status === "pending") return "pending";
      if (entry.status === "approved") return "approved";
      if (entry.status === "rejected") return "rejected";
      return "removed";
    default:
      return "received";
  }
}

// Unico punto in cui una richiesta diventa risposta per il telefono: elenco
// esplicito di campi. Il motivo c'è solo per "Non accettata" ed è quello scritto
// per il ragazzo (`rejectionReason`), mai la nota interna dello staff.
function buildMineItem(id, request, entry, { recordTitle, windowOpen }) {
  const state = deriveRequesterState(request, entry);
  const proposal = request.kind === "proposal";
  return {
    requestId: id,
    kind: request.kind,
    firstName: request.firstName,
    lastName: request.lastName,
    unitName: request.unitName,
    text: proposal ? request.proposedText ?? null : null,
    measure: proposal ? request.proposedMeasure ?? null : null,
    durationSeconds: proposal ? request.proposedDurationSeconds ?? null : null,
    needs: proposal ? request.proposedNeeds || "" : "",
    recordId: proposal ? null : request.recordId ?? null,
    recordTitle: proposal ? null : recordTitle ?? null,
    state,
    reason: state === "rejected" && entry && typeof entry.rejectionReason === "string" ? entry.rejectionReason : "",
    createdAt: request.createdAt ?? null,
    canWithdraw: windowOpen && state === "received",
    canRestore: windowOpen && state === "withdrawn",
  };
}

// ---------------------------------------------------------------------------
// Accesso ai dati
// ---------------------------------------------------------------------------

function assertGuestAuth(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sessione non valida: riapri la pagina e riprova.");
  const provider = request.auth.token?.firebase?.sign_in_provider;
  if (typeof provider === "string" && provider && provider !== "anonymous") {
    throw new HttpsError("permission-denied", MESSAGES.account);
  }
  return request.auth.uid;
}

function assertWindowOpen(activity, now) {
  const state = getParticipantWindow(activity, now);
  if (state === "disabled") throw new HttpsError("failed-precondition", MESSAGES.disabled);
  if (state === "closed") throw new HttpsError("failed-precondition", MESSAGES.closed);
}

// Richieste dello stesso telefono (non scadute): servono ai tetti, all'idempotenza
// e a `mine`. Una sola query di sola uguaglianza.
async function readPhoneRequests(tx, refs, uid, now) {
  const snapshot = await tx.get(refs.requests.where("anonUid", "==", uid));
  return snapshot.docs.map(view).filter((request) => !isRequestExpired(request.data, now));
}

// Quante richieste `open` ha l'attività: un'aggregazione `count()`, senza scaricare
// i documenti (nomi e testi dei minori restano dove sono). Conta anche una richiesta
// scaduta ma non ancora cancellata dal TTL: succede solo dopo la fine delle
// iscrizioni, quando submit e restore sono comunque chiusi.
async function countOpenInActivity(tx, refs) {
  const snapshot = await tx.get(refs.requests.where("status", "==", "open").count());
  return snapshot.data().count;
}

// Richiesta del chiamante, oppure null: inesistente, scaduta e altrui sono lo
// stesso caso (nessun oracolo su richieste di altri telefoni).
async function readOwnRequest(tx, refs, requestId, uid, now) {
  const snapshot = await tx.get(refs.requests.doc(requestId));
  if (!snapshot.exists) return null;
  const request = view(snapshot);
  if (request.data.anonUid !== uid || isRequestExpired(request.data, now)) return null;
  return request;
}

function unavailable() {
  return new HttpsError("failed-precondition", MESSAGES.unavailable);
}

// ---------------------------------------------------------------------------
// Azioni
// ---------------------------------------------------------------------------

// Sola lettura e pubblica (nessuna sessione): moduli, scadenza, unità attive e
// i record che lo staff ha scritto. L'elenco dei record si mostra solo con
// l'interruttore acceso: i titoli approvati quando l'elenco era per loggati non
// diventano pubblici finché lo staff non ha visto l'anteprima e acceso il
// pulsante (D1). Mai note, conteggi o dati di chi si è iscritto.
async function guestContext(ctx) {
  const { tx, refs, activity, now } = ctx;
  const windowOpen = getParticipantWindow(activity, now) === "open";
  const switchOn = activity.recordsGuestEnabled === true;
  const closeAt = resolveCloseAt(activity);

  const unitsSnap = await tx.get(refs.units.where("isActive", "==", true));
  const units = unitsSnap.docs
    .map(view)
    .filter((unit) => unit.data.isActive === true && typeof unit.data.name === "string" && unit.data.name.trim())
    .map((unit) => ({ id: unit.id, name: unit.data.name.trim() }))
    .sort((left, right) => left.name.localeCompare(right.name, "it-IT") || left.id.localeCompare(right.id));

  let records = [];
  if (switchOn) {
    const recordsSnap = await tx.get(refs.records.where("status", "==", "open"));
    records = recordsSnap.docs
      .map(view)
      .filter((record) => record.data.status === "open" && record.data.challengerCount > 0)
      .map((record) => ({
        id: record.id,
        title: String(record.data.title || ""),
        category: record.data.category ?? null,
        measure: record.data.measure ?? null,
        durationSeconds: record.data.durationSeconds ?? null,
      }))
      .sort((left, right) => String(left.category).localeCompare(String(right.category)) || left.title.localeCompare(right.title, "it-IT") || left.id.localeCompare(right.id));
  }
  return {
    open: windowOpen,
    closeAt: closeAt ? closeAt.toISOString() : null,
    intakeOpen: windowOpen && switchOn,
    units,
    records,
  };
}

// Crea la richiesta `open`. Stessa risposta per chiunque: il nome non viene
// confrontato con nulla. Un nuovo foglio (submissionId nuovo) è una richiesta
// nuova; lo stesso submissionId rimanda la richiesta già creata, in qualunque
// stato sia (doppio tocco, risposta persa).
async function guestSubmit(ctx) {
  const { tx, refs, fields, uid, activity, now, nowIso } = ctx;
  const phoneRequests = await readPhoneRequests(tx, refs, uid, now);
  const replay = phoneRequests.find((request) => request.data.submissionId === fields.submissionId);
  if (replay) return { requestId: replay.id };

  assertWindowOpen(activity, now);
  if (activity.recordsGuestEnabled !== true) throw unavailable();
  const expiresAt = resolveRequestExpiry(activity, now);
  if (!expiresAt) throw new HttpsError("failed-precondition", MESSAGES.closed);

  // Prima i tetti del telefono (dati già letti), poi il resto: chi è al limite non costa altre letture.
  const personKey = personKeyOf(fields.firstName, fields.lastName, fields.unitId);
  assertPhoneCaps({ phoneRequests: phoneRequests.map((request) => request.data), personKey, countCreated: true });

  const unitSnap = await tx.get(refs.units.doc(fields.unitId));
  if (!unitSnap.exists || unitSnap.data().isActive !== true || typeof unitSnap.data().name !== "string") {
    throw new HttpsError("invalid-argument", "Unità non valida.");
  }
  if (fields.kind === "challenge") {
    const recordSnap = await tx.get(refs.records.doc(fields.recordId));
    const record = recordSnap.exists ? recordSnap.data() : null;
    // Come per il ragazzo con l'account: si sfida solo un record che l'elenco mostra.
    if (!record || record.status !== "open" || !(record.challengerCount > 0)) {
      throw new HttpsError("failed-precondition", "Questo record non è più disponibile.");
    }
  }
  assertActivityCap(await countOpenInActivity(tx, refs));

  const requestRef = refs.requests.doc();
  const proposal = fields.kind === "proposal";
  tx.create(requestRef, {
    anonUid: uid,
    submissionId: fields.submissionId,
    firstName: fields.firstName,
    lastName: fields.lastName,
    unitId: fields.unitId,
    unitName: unitSnap.data().name.trim(),
    personKey,
    kind: fields.kind,
    proposedText: proposal ? fields.text : null,
    proposedMeasure: proposal ? fields.measure : null,
    proposedDurationSeconds: proposal ? fields.durationSeconds : null,
    proposedNeeds: proposal ? fields.needs : "",
    recordId: proposal ? null : fields.recordId,
    status: "open",
    // Nota interna dello staff: non passa mai al telefono.
    staffNote: "",
    linkedRegistrationId: null,
    linkedEntryId: null,
    linkedBy: null,
    linkedAt: null,
    decidedBy: null,
    decidedAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    expiresAt: Timestamp.fromDate(expiresAt),
  });
  return { requestId: requestRef.id };
}

// Le richieste di questo telefono con il loro stato. Funziona anche a finestra
// chiusa e a interruttore spento.
async function guestMine(ctx) {
  const { tx, refs, uid, activity, now } = ctx;
  const windowOpen = getParticipantWindow(activity, now) === "open";
  const closeAt = resolveCloseAt(activity);
  const requests = await readPhoneRequests(tx, refs, uid, now);

  const entryIds = [
    ...new Set(
      requests
        .filter((request) => request.data.status === "linked" && typeof request.data.linkedEntryId === "string" && request.data.linkedEntryId)
        .map((request) => request.data.linkedEntryId),
    ),
  ];
  const recordIds = [
    ...new Set(
      requests
        .filter((request) => request.data.kind === "challenge" && typeof request.data.recordId === "string" && request.data.recordId)
        .map((request) => request.data.recordId),
    ),
  ];
  const entrySnaps = entryIds.length ? await tx.getAll(...entryIds.map((id) => refs.entries.doc(id))) : [];
  const recordSnaps = recordIds.length ? await tx.getAll(...recordIds.map((id) => refs.records.doc(id))) : [];
  const entries = new Map(entrySnaps.filter((snap) => snap.exists).map((snap) => [snap.id, snap.data() || {}]));
  // Il titolo si mostra solo se è pubblico adesso: record aperto, con almeno uno
  // sfidante e interruttore acceso (come in `context`). Dopo lo spegnimento o il
  // nascondimento torna null.
  const titlesPublic = activity.recordsGuestEnabled === true;
  const titles = new Map(
    recordSnaps
      .filter((snap) => titlesPublic && snap.exists && (snap.data() || {}).status === "open" && (snap.data() || {}).challengerCount > 0)
      .map((snap) => [snap.id, String((snap.data() || {}).title || "")]),
  );

  const items = requests
    .map((request) =>
      buildMineItem(request.id, request.data, entries.get(request.data.linkedEntryId) || null, {
        recordTitle: titles.get(request.data.recordId) ?? null,
        windowOpen,
      }),
    )
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)) || left.requestId.localeCompare(right.requestId));
  return { open: windowOpen, closeAt: closeAt ? closeAt.toISOString() : null, requests: items };
}

// Ritiro dal telefono: solo `open` -> `withdrawn`, a finestra aperta. Ripetuto su
// una richiesta già ritirata non cambia nulla. Linked, rifiutata, altrui,
// inesistente e scaduta: stesso errore.
async function guestWithdraw(ctx) {
  const { tx, refs, fields, uid, activity, now, nowIso } = ctx;
  assertWindowOpen(activity, now);
  const request = await readOwnRequest(tx, refs, fields.requestId, uid, now);
  if (!request) throw unavailable();
  if (request.data.status === "withdrawn") return { requestId: request.id, state: "withdrawn" };
  if (request.data.status !== "open") throw unavailable();
  tx.update(request.ref, { status: "withdrawn", updatedAt: nowIso });
  return { requestId: request.id, state: "withdrawn" };
}

// "Annulla" / "Ripristina": solo `withdrawn` -> `open`, a finestra aperta e con
// gli stessi tetti di `submit` (tranne le 20 create: qui non si crea nulla). Già
// `open` (doppio tocco) non cambia nulla. L'interruttore spento non lo blocca.
async function guestRestore(ctx) {
  const { tx, refs, fields, uid, activity, now, nowIso } = ctx;
  assertWindowOpen(activity, now);
  const request = await readOwnRequest(tx, refs, fields.requestId, uid, now);
  if (!request) throw unavailable();
  if (request.data.status === "open") return { requestId: request.id, state: "received" };
  if (request.data.status !== "withdrawn") throw unavailable();

  const phoneRequests = await readPhoneRequests(tx, refs, uid, now);
  assertPhoneCaps({
    phoneRequests: phoneRequests.map((item) => item.data),
    personKey: request.data.personKey,
    countCreated: false,
  });
  assertActivityCap(await countOpenInActivity(tx, refs));
  tx.update(request.ref, { status: "open", updatedAt: nowIso });
  return { requestId: request.id, state: "received" };
}

const GUEST_ACTIONS = Object.freeze({
  context: guestContext,
  submit: guestSubmit,
  mine: guestMine,
  withdraw: guestWithdraw,
  restore: guestRestore,
});

// ---------------------------------------------------------------------------
// Callable
// ---------------------------------------------------------------------------

function createRecordNightGuestHandler({ db, clock = () => new Date() } = {}) {
  return async (request) => {
    const firestore = db || getFirestore();
    const input = parseGuestRequest(request.data);
    // `context` è pubblico; tutto il resto vuole una sessione anonima.
    const uid = input.action === "context" ? null : assertGuestAuth(request);
    const refs = refsFor(firestore, input.stakeId, input.activityId);

    // `context` e `mine` non scrivono: transazione di sola lettura, senza lock condivisi.
    const readOnly = input.action === "context" || input.action === "mine";
    const result = await firestore.runTransaction(async (tx) => {
      const now = clock();
      const nowIso = now.toISOString();
      const activitySnap = await tx.get(refs.activityRef);
      if (!activitySnap.exists) throw new HttpsError("not-found", "Attività non trovata.");
      const activity = activitySnap.data() || {};
      // `recordsEnabled` falso spegne tutto, per tutti.
      if (activity.recordsEnabled !== true) throw new HttpsError("failed-precondition", MESSAGES.disabled);
      return GUEST_ACTIONS[input.action]({ tx, refs, uid, fields: input.fields, activity, now, nowIso });
    }, { readOnly });

    // Solo azione e id: mai nomi, testi o altri dati di minori.
    logger.info("Record night guest action.", {
      action: input.action,
      stakeId: input.stakeId,
      activityId: input.activityId,
      anonUid: uid,
      requestId: result.requestId ?? null,
    });
    return { ok: true, action: input.action, ...result };
  };
}

// Gen2, region esplicita. `maxInstances` basso limita il costo, non l'abuso.
const recordNightGuest = onCall(
  { region: REGION, timeoutSeconds: 30, maxInstances: 10 },
  createRecordNightGuestHandler(),
);

module.exports = {
  recordNightGuest,
  createRecordNightGuestHandler,
  // Logica pura.
  MAX_OPEN_PER_PHONE,
  MAX_CREATED_PER_PHONE,
  MAX_OPEN_PER_PERSON,
  MESSAGES,
  parseGuestRequest,
  parsePersonName,
  personKeyOf,
  resolveRequestExpiry,
  assertPhoneCaps,
  assertActivityCap,
  deriveRequesterState,
  buildMineItem,
};
