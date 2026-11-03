// Callable `roomMates` (docs/ROOM_MANAGEMENT.md, «Compagni di stanza») contro
// gli emulatori: utenti veri dell'Auth Emulator, chiamate con il client SDK verso
// il Functions Emulator, Admin SDK solo per il seed. Nomi tutti inventati.
//
//   firebase emulators:exec --config firebase.room-mates-test.json --project demo-room-mates \
//     'node --test functions/tests/roomMatesEmulator.test.mjs'
//
// Il seed crea le iscrizioni già nello stato voluto e non le aggiorna mai: un
// update da idonea a non idonea farebbe scattare `onRoomRegistrationUpdated`, che
// pulirebbe il piano. Così le annullate restano nel piano come prima del trigger.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { initializeApp as initializeClientApp, deleteApp as deleteClientApp } from "firebase/app";
import {
  EmailAuthProvider,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  getIdTokenResult,
  linkWithCredential,
  signInAnonymously,
} from "firebase/auth";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";

const require = createRequire(import.meta.url);
const { initializeApp: initializeAdminApp, getApps } = require("firebase-admin/app");
const { getFirestore: getAdminFirestore } = require("firebase-admin/firestore");

const PROJECT = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || "";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "";
assert.equal(PROJECT, "demo-room-mates", "Usare esclusivamente il progetto demo-room-mates");
assert.match(FIRESTORE_HOST, /^(127\.0\.0\.1|localhost):8380$/, "Firestore Emulator richiesto sulla porta 8380");
assert.match(AUTH_HOST, /^(127\.0\.0\.1|localhost):9399$/, "Auth Emulator richiesto sulla porta 9399");

if (getApps().length === 0) initializeAdminApp({ projectId: PROJECT });
const adminDb = getAdminFirestore();
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = "room-mates-test-password";

const stakeId = `mates-${runId}`;
const otherStakeId = `mates-altro-${runId}`;
const activityId = "campeggio";
const otherActivityId = "altra-attivita";
const draftActivityId = "attivita-bozza";
const crowdedActivityId = "attivita-affollata";
const savedActivityId = "attivita-salvata";
const deletedActivityId = "attivita-cancellata";
const activityPath = (activity = activityId, stake = stakeId) => `stakes/${stake}/activities/${activity}`;
const registrationRef = (id, activity = activityId, stake = stakeId) =>
  adminDb.doc(`${activityPath(activity, stake)}/registrations/${id}`);
const planRef = (activity = activityId, stake = stakeId) =>
  adminDb.doc(`${activityPath(activity, stake)}/management/rooms`);

const NO_ROOM = { room: null, mates: [] };

function room(id, name, capacity, category, extra = {}) {
  return {
    id,
    name,
    capacity,
    floor: "primo",
    category,
    accessible: false,
    notes: "Nota interna dello staff, mai ai partecipanti",
    minAge: category === "boys" || category === "girls" ? 12 : null,
    maxAge: category === "boys" || category === "girls" ? 18 : null,
    ...extra,
  };
}

const GLICINE = room("glicine", "Camera Glicine", 8, "girls");
const ORTENSIA = room("ortensia", "Camera Ortensia", 4, "boys");
const LAVANDA = room("lavanda", "Camera Lavanda", 6, "girls");

// Ogni iscrizione porta dati che la callable non deve mai restituire.
function registration(fields) {
  const data = {
    birthDate: "2010-05-05",
    email: "privato@example.invalid",
    phone: "+39 000 0000000",
    unitId: "unita-inventata",
    unitName: "Rione Inventato",
    healthNotes: "Nota sanitaria riservata",
    answers: { taglia: "M" },
    roomPreferenceMatches: {},
    genderRoleCategory: "giovane_donna",
    registrationStatus: "confirmed",
    userId: null,
    anonymousUid: null,
    ...fields,
  };
  for (const [key, value] of Object.entries(data)) if (value === undefined) delete data[key];
  return data;
}

const clients = [];
async function client(name, mode = "password") {
  const app = initializeClientApp({ apiKey: "demo-key", projectId: PROJECT }, `${name}-${runId}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9399", { disableWarnings: true });
  if (mode === "anonymous") {
    await signInAnonymously(auth);
  } else if (mode === "password") {
    await createUserWithEmailAndPassword(auth, `${name}-${runId}@example.invalid`, PASSWORD);
  }
  const functions = getFunctions(app, "europe-west1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5301);
  const entry = {
    app,
    auth,
    uid: auth.currentUser?.uid ?? null,
    mates: httpsCallable(functions, "roomMates"),
    save: httpsCallable(functions, "roomManagementSave"),
  };
  clients.push(entry);
  return entry;
}

async function expectCode(promise, suffix, label) {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.code, `functions/${suffix}`, `${label}: ${error?.code} ${error?.message}`);
    return true;
  }, label);
}

// Forma esatta della risposta: solo `room` e `mates`, `room` solo nome e posti,
// ogni compagno solo nome e flag adulto.
function assertShape(data, label) {
  assert.deepEqual(Object.keys(data).sort(), ["mates", "room"], `${label}: chiavi della risposta`);
  if (data.room !== null) {
    assert.deepEqual(Object.keys(data.room).sort(), ["capacity", "name"], `${label}: chiavi di room`);
  }
  assert.ok(Array.isArray(data.mates), `${label}: mates è un array`);
  for (const mate of data.mates) {
    assert.deepEqual(Object.keys(mate).sort(), ["adult", "fullName"], `${label}: chiavi di un compagno`);
    assert.equal(typeof mate.fullName, "string", `${label}: fullName stringa`);
    assert.equal(typeof mate.adult, "boolean", `${label}: adult booleano`);
  }
}

async function callMates(caller, data, label) {
  const response = await caller.mates(data);
  assertShape(response.data, label);
  return response.data;
}

const youth = (fullName) => ({ fullName, adult: false });
const adult = (fullName) => ({ fullName, adult: true });

// Persone della Camera Glicine idonee, senza chi chiama.
const GLICINE_YOUTH = [
  "Alice Rossi",
  "Beatrice Gialli",
  "Chiara Fittizia",
  "Delia Manuale",
  "Elena Nomi",
  "Giada Risalvata",
  "Gina Ospite",
  "Olga Anonima",
];
const GLICINE_ADULTS = ["Anna Accompagnatrice", "Zaira Dirigente"];
const glicineMatesWithout = (self) => [
  ...GLICINE_YOUTH.filter((name) => name !== self).map(youth),
  ...GLICINE_ADULTS.map(adult),
];
const GLICINE_ROOM = { name: "Camera Glicine", capacity: 8 };
const ORTENSIA_ROOM = { name: "Camera Ortensia", capacity: 4 };

let people;

before(async () => {
  const [alice, bruno, paola, piero, gina, giada, anon, irene, ugo, vera, nobody, mallory, signedOut] = await Promise.all([
    client("alice"),
    client("bruno"),
    client("paola-genitore"),
    client("piero-genitore"),
    client("gina-ospite", "anonymous"),
    client("giada-risalvata"),
    client("olga-anonima", "anonymous"),
    client("irene"),
    client("ugo"),
    client("vera"),
    client("nessuno"),
    client("mallory"),
    client("senza-login", "none"),
  ]);
  // Un account per ogni documento con due titolari: l'id deriva dall'uid.
  const [doppioAnon, doppioUser, doppioParent, doppioGuest, userRotto] = await Promise.all([
    client("doppio-anon"),
    client("doppio-user"),
    client("doppio-parent"),
    client("doppio-guest"),
    client("user-rotto"),
  ]);
  people = {
    alice, bruno, paola, piero, gina, giada, anon, irene, ugo, vera, nobody, mallory, signedOut,
    doppioAnon, doppioUser, doppioParent, doppioGuest, userRotto,
  };

  const registrations = {
    // Camera Glicine: chi chiama nei vari casi e i compagni idonei.
    [`user_${alice.uid}`]: registration({ fullName: "Alice Rossi", userId: alice.uid }),
    user_fakebea: registration({ fullName: "Beatrice Gialli", userId: "fakebea", registrationStatus: "submitted" }),
    [`child_${paola.uid}_figlia1`]: registration({
      fullName: "Chiara Fittizia",
      parentUid: paola.uid,
      childId: "figlia1",
      registrationStatus: "pending_parent_authorization",
    }),
    manual_delia01: registration({ fullName: "Delia Manuale", createdByAdmin: true }),
    // Formato vecchio: niente fullName, solo nome e cognome.
    user_fakeelena: registration({ fullName: undefined, firstName: "Elena", lastName: "Nomi", userId: "fakeelena", registrationStatus: "active" }),
    [`guest_${gina.uid}`]: registration({ fullName: "Gina Ospite", anonymousUid: gina.uid, registrationStatus: "active" }),
    // Ospite collegato che ha risalvato il modulo: guest_ con userId, senza anonymousUid.
    [`guest_${giada.uid}`]: registration({ fullName: "Giada Risalvata", userId: giada.uid }),
    [`guest_${anon.uid}`]: registration({ fullName: "Olga Anonima", anonymousUid: anon.uid }),
    // Adulti con id che precedono in ordine alfabetico quelli dei ragazzi.
    "user_aaa-zaira": registration({ fullName: "Zaira Dirigente", userId: "aaa-zaira", genderRoleCategory: "dirigente", birthDate: "1980-01-01" }),
    "user_aab-anna": registration({ fullName: "Anna Accompagnatrice", userId: "aab-anna", genderRoleCategory: "accompagnatore", birthDate: "1979-01-01" }),
    // Non idonee ma ancora nel piano (trigger non ancora passato).
    [`user_${irene.uid}`]: registration({ fullName: "Irene Annullata", userId: irene.uid, registrationStatus: "cancelled" }),
    user_ines: registration({ fullName: "Ines Annullata", userId: "ines", registrationStatus: "cancelled" }),
    user_rita: registration({ fullName: "Rita Rifiutata", userId: "rita", registrationStatus: "rejected" }),
    user_rina: registration({ fullName: "Rina Rifiutata", userId: "rina", registrationStatus: "rejected_by_parent" }),
    user_wanda: registration({ fullName: "Wanda Attesa", userId: "wanda", registrationStatus: "waitlist" }),
    user_dora: registration({ fullName: "Dora Bozza", userId: "dora", registrationStatus: "draft" }),
    user_lea: registration({ fullName: "Lea Vecchia", userId: "lea", registrationStatus: undefined, status: "cancelled" }),
    user_mara: registration({ fullName: "Mara Mista", userId: "mara", registrationStatus: "confirmed", status: "cancelled" }),
    user_sara: registration({ fullName: "Sara Sconosciuta", userId: "sara", registrationStatus: "sospesa" }),
    user_tina: registration({ fullName: "Tina Maiuscola", userId: "tina", registrationStatus: "CANCELLED" }),

    // Camera Ortensia.
    [`user_${bruno.uid}`]: registration({ fullName: "Bruno Verdi", userId: bruno.uid, genderRoleCategory: "giovane_uomo" }),
    user_fakecarlo: registration({ fullName: "Carlo Neri", userId: "fakecarlo", genderRoleCategory: "giovane_uomo" }),
    [`child_${piero.uid}_figlio9`]: registration({
      fullName: "Filippo Fittizio",
      parentUid: piero.uid,
      childId: "figlio9",
      genderRoleCategory: "giovane_uomo",
    }),
    user_fakemario: registration({ fullName: "Mario Guida", userId: "fakemario", genderRoleCategory: "dirigente", birthDate: "1975-01-01" }),

    // Camera Lavanda: documenti incoerenti di Mallory, assegnati, con una
    // compagna che non deve mai uscire.
    user_fakelivia: registration({ fullName: "Livia Segreta", userId: "fakelivia" }),
    [`user_${mallory.uid}`]: registration({ fullName: "Mallory Uno", userId: alice.uid }),
    [`child_${mallory.uid}_x1`]: registration({ fullName: "Mallory Due", parentUid: paola.uid, childId: "x1" }),
    [`child_${mallory.uid}_x2`]: registration({ fullName: "Mallory Tre", parentUid: mallory.uid, childId: "altro" }),
    [`child_${mallory.uid}_x3`]: registration({ fullName: "Mallory Quattro", parentUid: mallory.uid, childId: "x3", userId: "qualcuno" }),
    [`child_${mallory.uid}_x4`]: registration({ fullName: "Mallory Cinque", parentUid: mallory.uid, childId: "x4", anonymousUid: mallory.uid }),
    [`child_${mallory.uid}_x5`]: registration({ fullName: "Mallory Sei", parentUid: mallory.uid, childId: "x5", userId: mallory.uid }),
    // Due titolari nello stesso documento: non risponde a nessuno dei due.
    [`user_${doppioAnon.uid}`]: registration({ fullName: "Doppio Anonimo", userId: doppioAnon.uid, anonymousUid: "altro-ospite" }),
    [`user_${doppioUser.uid}`]: registration({ fullName: "Doppio Utente", userId: "altro-utente", anonymousUid: doppioUser.uid }),
    [`user_${doppioParent.uid}`]: registration({ fullName: "Doppio Genitore", userId: doppioParent.uid, parentUid: "altro-genitore" }),
    [`guest_${doppioGuest.uid}`]: registration({ fullName: "Doppio Ospite", userId: doppioGuest.uid, anonymousUid: doppioGuest.uid }),
    // user_ non suo e guest_ valido: il ripiego su guest_ vale solo se user_ manca.
    [`user_${userRotto.uid}`]: registration({ fullName: "Rotto Uno", userId: "altro-utente" }),
    [`guest_${userRotto.uid}`]: registration({ fullName: "Rotto Due", anonymousUid: userRotto.uid }),

    // Iscritti senza stanza, o con una stanza che il piano non ha più.
    [`user_${ugo.uid}`]: registration({ fullName: "Ugo Senzastanza", userId: ugo.uid, genderRoleCategory: "giovane_uomo" }),
    [`user_${vera.uid}`]: registration({ fullName: "Vera Spaesata", userId: vera.uid }),
  };

  const assignments = {
    [`user_${alice.uid}`]: "glicine",
    user_fakebea: "glicine",
    [`child_${paola.uid}_figlia1`]: "glicine",
    manual_delia01: "glicine",
    user_fakeelena: "glicine",
    [`guest_${gina.uid}`]: "glicine",
    [`guest_${giada.uid}`]: "glicine",
    [`guest_${anon.uid}`]: "glicine",
    "user_aaa-zaira": "glicine",
    "user_aab-anna": "glicine",
    [`user_${irene.uid}`]: "glicine",
    user_ines: "glicine",
    user_rita: "glicine",
    user_rina: "glicine",
    user_wanda: "glicine",
    user_dora: "glicine",
    user_lea: "glicine",
    user_mara: "glicine",
    user_sara: "glicine",
    user_tina: "glicine",
    // Iscrizione cancellata ma ancora citata dal piano.
    user_fantasma: "glicine",
    [`user_${bruno.uid}`]: "ortensia",
    user_fakecarlo: "ortensia",
    [`child_${piero.uid}_figlio9`]: "ortensia",
    user_fakemario: "ortensia",
    user_fakelivia: "lavanda",
    [`user_${mallory.uid}`]: "lavanda",
    [`child_${mallory.uid}_x1`]: "lavanda",
    [`child_${mallory.uid}_x2`]: "lavanda",
    [`child_${mallory.uid}_x3`]: "lavanda",
    [`child_${mallory.uid}_x4`]: "lavanda",
    [`child_${mallory.uid}_x5`]: "lavanda",
    [`user_${doppioAnon.uid}`]: "lavanda",
    [`user_${doppioUser.uid}`]: "lavanda",
    [`user_${doppioParent.uid}`]: "lavanda",
    [`guest_${doppioGuest.uid}`]: "lavanda",
    [`user_${userRotto.uid}`]: "lavanda",
    [`guest_${userRotto.uid}`]: "lavanda",
    [`user_${vera.uid}`]: "stanza-sparita",
  };

  const plan = {
    rooms: [GLICINE, ORTENSIA, LAVANDA],
    assignments,
    lockedIds: [],
    adultGenders: { "user_aaa-zaira": "female", "user_aab-anna": "female", user_fakemario: "male" },
    couples: [],
    published: true,
    revision: 3,
    updatedAt: "2026-07-01T10:00:00.000Z",
  };

  // Altra attività dello stesso palo e stessa attività di un altro palo: piani
  // pubblicati che citano Alice, ma senza la sua iscrizione.
  const foreignPlan = {
    ...plan,
    rooms: [GLICINE],
    assignments: { [`user_${alice.uid}`]: "glicine", user_fakelivia: "glicine" },
  };

  const writes = [
    adminDb.doc(activityPath()).set({ title: "Campeggio di prova", overnight: true, startDate: "2026-07-15" }),
    planRef().set(plan),
    ...Object.entries(registrations).map(([id, data]) => registrationRef(id).set(data)),
    adminDb.doc(activityPath(otherActivityId)).set({ title: "Altra attività", overnight: true, startDate: "2026-08-01" }),
    planRef(otherActivityId).set(foreignPlan),
    registrationRef("user_fakelivia", otherActivityId).set(registration({ fullName: "Livia Segreta", userId: "fakelivia" })),
    adminDb.doc(activityPath(activityId, otherStakeId)).set({ title: "Campeggio di un altro palo", overnight: true, startDate: "2026-07-15" }),
    planRef(activityId, otherStakeId).set(foreignPlan),
    registrationRef("user_fakelivia", activityId, otherStakeId).set(registration({ fullName: "Livia Segreta", userId: "fakelivia" })),
    // Attività cancellata: il documento non c'è, iscrizioni e piano pubblicato sì
    // (mai creato, così il trigger di cancellazione non toglie il piano).
    planRef(deletedActivityId).set({
      ...plan,
      rooms: [GLICINE],
      assignments: { [`user_${alice.uid}`]: "glicine", [`user_${irene.uid}`]: "glicine", user_fakelivia: "glicine" },
    }),
    registrationRef(`user_${alice.uid}`, deletedActivityId).set(registration({ fullName: "Alice Rossi", userId: alice.uid })),
    // Annullata e ancora nel piano: l'attività assente prevale sull'idoneità.
    registrationRef(`user_${irene.uid}`, deletedActivityId).set(registration({
      fullName: "Irene Annullata",
      userId: irene.uid,
      registrationStatus: "cancelled",
    })),
    registrationRef("user_fakelivia", deletedActivityId).set(registration({ fullName: "Livia Segreta", userId: "fakelivia" })),
  ];
  await Promise.all(writes);
});

after(async () => {
  await Promise.all(clients.map((entry) => deleteClientApp(entry.app)));
  await adminDb.terminate();
});

test("partecipante: nome e posti della sua stanza e solo i compagni idonei, ragazzi poi adulti", async () => {
  const data = await callMates(people.alice, { stakeId, activityId }, "alice");
  assert.deepEqual(data, { room: GLICINE_ROOM, mates: glicineMatesWithout("Alice Rossi") });
  const names = data.mates.map((mate) => mate.fullName);
  assert.equal(names.includes("Alice Rossi"), false, "chi chiama escluso");
  for (const name of ["Livia Segreta", "Bruno Verdi", "Carlo Neri", "Mario Guida", "Ugo Senzastanza", "Vera Spaesata"]) {
    assert.equal(names.includes(name), false, `${name} non è in questa stanza`);
  }
  // `childId: null` vale come assente.
  assert.deepEqual(await callMates(people.alice, { stakeId, activityId, childId: null }, "alice childId null"), data);
});

test("partecipante di un'altra stanza: i suoi compagni, mai quelli della prima", async () => {
  const data = await callMates(people.bruno, { stakeId, activityId }, "bruno");
  assert.deepEqual(data, {
    room: ORTENSIA_ROOM,
    mates: [youth("Carlo Neri"), youth("Filippo Fittizio"), adult("Mario Guida")],
  });
  const glicineNames = [...GLICINE_YOUTH, ...GLICINE_ADULTS];
  for (const mate of data.mates) assert.equal(glicineNames.includes(mate.fullName), false, mate.fullName);
});

test("annullate, rifiutate, in attesa, bozze, stati legacy o ignoti e iscrizioni cancellate non compaiono", async () => {
  const data = await callMates(people.alice, { stakeId, activityId }, "alice");
  const names = data.mates.map((mate) => mate.fullName);
  for (const name of [
    "Irene Annullata",
    "Ines Annullata",
    "Rita Rifiutata",
    "Rina Rifiutata",
    "Wanda Attesa",
    "Dora Bozza",
    "Lea Vecchia",
    "Mara Mista",
    "Sara Sconosciuta",
    "Tina Maiuscola",
  ]) {
    assert.equal(names.includes(name), false, `${name} non deve comparire`);
  }
  assert.equal(data.mates.length, 9, "solo le 9 compagne idonee");
});

test("chi chiama ha l'iscrizione annullata: nessuna stanza e nessun nome", async () => {
  assert.deepEqual(await callMates(people.irene, { stakeId, activityId }, "irene"), NO_ROOM);
});

test("iscrizione non assegnata, o assegnata a una stanza che il piano non ha: room null", async () => {
  assert.deepEqual(await callMates(people.ugo, { stakeId, activityId }, "ugo"), NO_ROOM);
  assert.deepEqual(await callMates(people.vera, { stakeId, activityId }, "vera"), NO_ROOM);
});

test("non iscritto all'attività: not-found", async () => {
  await expectCode(people.nobody.mates({ stakeId, activityId }), "not-found", "senza iscrizione");
  await expectCode(people.nobody.mates({ stakeId: `mai-esistito-${runId}`, activityId }), "not-found", "palo inesistente");
});

test("genitore con childId: la stanza del figlio, figlio escluso dai compagni", async () => {
  const paolaData = await callMates(people.paola, { stakeId, activityId, childId: "figlia1" }, "paola");
  assert.deepEqual(paolaData, { room: GLICINE_ROOM, mates: glicineMatesWithout("Chiara Fittizia") });
  const pieroData = await callMates(people.piero, { stakeId, activityId, childId: "figlio9" }, "piero");
  assert.deepEqual(pieroData, {
    room: ORTENSIA_ROOM,
    mates: [youth("Bruno Verdi"), youth("Carlo Neri"), adult("Mario Guida")],
  });
  // Senza childId il genitore non ha un'iscrizione sua.
  await expectCode(people.paola.mates({ stakeId, activityId }), "not-found", "genitore senza childId");
});

test("genitore con il childId di un altro genitore o inesistente: not-found", async () => {
  await expectCode(people.piero.mates({ stakeId, activityId, childId: "figlia1" }), "not-found", "figlio di Paola");
  await expectCode(people.piero.mates({ stakeId, activityId, childId: "inesistente" }), "not-found", "figlio inesistente");
  await expectCode(people.alice.mates({ stakeId, activityId, childId: "figlia1" }), "not-found", "partecipante con childId altrui");
});

test("documenti incoerenti o con due titolari: not-found, mai i nomi della stanza", async () => {
  const { mallory } = people;
  await expectCode(mallory.mates({ stakeId, activityId, childId: "x1" }), "not-found", "child_ con parentUid di un altro");
  await expectCode(mallory.mates({ stakeId, activityId, childId: "x2" }), "not-found", "child_ con childId diverso nel documento");
  await expectCode(mallory.mates({ stakeId, activityId, childId: "x3" }), "not-found", "child_ con userId valorizzato");
  await expectCode(mallory.mates({ stakeId, activityId, childId: "x4" }), "not-found", "child_ con anonymousUid valorizzato");
  await expectCode(mallory.mates({ stakeId, activityId, childId: "x5" }), "not-found", "child_ con userId uguale al genitore");
  await expectCode(mallory.mates({ stakeId, activityId }), "not-found", "user_ con userId di Alice");
  await expectCode(people.doppioAnon.mates({ stakeId, activityId }), "not-found", "user_ con userId suo e anonymousUid altrui");
  await expectCode(people.doppioUser.mates({ stakeId, activityId }), "not-found", "user_ con userId altrui e anonymousUid suo");
  await expectCode(people.doppioParent.mates({ stakeId, activityId }), "not-found", "user_ con parentUid valorizzato");
  await expectCode(people.doppioGuest.mates({ stakeId, activityId }), "not-found", "guest_ con userId e anonymousUid entrambi suoi");
  await expectCode(people.userRotto.mates({ stakeId, activityId }), "not-found", "user_ non suo e guest_ valido");
});

test("ospite che ha collegato un account: vede i compagni dalla sua iscrizione guest_", async () => {
  const { gina } = people;
  const user = gina.auth.currentUser;
  const credential = EmailAuthProvider.credential(`gina-ospite-${runId}@example.invalid`, PASSWORD);
  await linkWithCredential(user, credential);
  assert.equal(gina.auth.currentUser.uid, gina.uid, "il collegamento conserva l'uid");
  const token = await getIdTokenResult(gina.auth.currentUser, true);
  assert.notEqual(token.signInProvider, "anonymous", "dopo il collegamento il token non è anonimo");
  const data = await callMates(gina, { stakeId, activityId }, "gina collegata");
  assert.deepEqual(data, { room: GLICINE_ROOM, mates: glicineMatesWithout("Gina Ospite") });
});

test("ospite collegato che ha risalvato il modulo (guest_ con userId, senza anonymousUid): vede i compagni", async () => {
  const data = await callMates(people.giada, { stakeId, activityId }, "giada");
  assert.deepEqual(data, { room: GLICINE_ROOM, mates: glicineMatesWithout("Giada Risalvata") });
});

test("attività cancellata con iscrizioni e piano pubblicato rimasti: not-found", async () => {
  assert.equal((await adminDb.doc(activityPath(deletedActivityId)).get()).exists, false);
  assert.equal((await planRef(deletedActivityId).get()).data().published, true);
  await expectCode(
    people.alice.mates({ stakeId, activityId: deletedActivityId }),
    "not-found",
    "attività cancellata",
  );
  await expectCode(
    people.irene.mates({ stakeId, activityId: deletedActivityId }),
    "not-found",
    "iscrizione annullata in attività cancellata",
  );
});

test("account anonimo con iscrizione guest_: permission-denied", async () => {
  const token = await getIdTokenResult(people.anon.auth.currentUser);
  assert.equal(token.signInProvider, "anonymous");
  await expectCode(people.anon.mates({ stakeId, activityId }), "permission-denied", "anonimo");
});

test("senza login: unauthenticated", async () => {
  await expectCode(people.signedOut.mates({ stakeId, activityId }), "unauthenticated", "senza login");
});

test("input ostili: invalid-argument o not-found, mai nomi", async () => {
  const { alice } = people;
  const invalid = [
    ["chiave extra", { stakeId, activityId, foo: "x" }],
    ["chiave extra registrationId", { stakeId, activityId, registrationId: "user_fakebea" }],
    ["data null", null],
    ["data stringa", "campeggio"],
    ["data array", [stakeId, activityId]],
    ["stakeId mancante", { activityId }],
    ["activityId mancante", { stakeId }],
    ["stakeId con /", { stakeId: `${stakeId}/activities/${activityId}`, activityId }],
    ["stakeId ..", { stakeId: "..", activityId }],
    ["stakeId ../", { stakeId: `../${stakeId}`, activityId }],
    ["activityId con /", { stakeId, activityId: `${activityId}/registrations/user_fakebea` }],
    ["activityId ..", { stakeId, activityId: ".." }],
    ["stakeId vuoto", { stakeId: "", activityId }],
    ["stakeId numero", { stakeId: 42, activityId }],
    ["stakeId oggetto", { stakeId: { id: stakeId }, activityId }],
    ["stakeId troppo lungo", { stakeId: "x".repeat(129), activityId }],
    ["childId __proto__", { stakeId, activityId, childId: "__proto__" }],
    ["childId constructor", { stakeId, activityId, childId: "constructor" }],
    ["childId prototype", { stakeId, activityId, childId: "prototype" }],
    ["childId vuoto", { stakeId, activityId, childId: "" }],
    ["childId numero", { stakeId, activityId, childId: 7 }],
    ["childId oggetto", { stakeId, activityId, childId: {} }],
    ["childId con /", { stakeId, activityId, childId: "x/../../user_fakebea" }],
    ["activityId __proto__", { stakeId, activityId: "__proto__" }],
  ];
  for (const [label, data] of invalid) await expectCode(alice.mates(data), "invalid-argument", label);

  // Id validi ma dove Alice non è iscritta, anche se il piano la cita.
  await expectCode(alice.mates({ stakeId, activityId: otherActivityId }), "not-found", "altra attività");
  await expectCode(alice.mates({ stakeId: otherStakeId, activityId }), "not-found", "altro palo");
  await expectCode(alice.mates({ stakeId, activityId, childId: "x1" }), "not-found", "childId di Mallory");
});

test("compagno iscritto a mano dall'admin (manual_) compare come gli altri", async () => {
  const data = await callMates(people.alice, { stakeId, activityId }, "alice");
  assert.deepEqual(
    data.mates.filter((mate) => mate.fullName === "Delia Manuale"),
    [youth("Delia Manuale")],
  );
});

test("piano assente, in bozza o con published non booleano: room null; ripubblicato i nomi tornano", async () => {
  const { alice } = people;
  const request = { stakeId, activityId: draftActivityId };
  await Promise.all([
    adminDb.doc(activityPath(draftActivityId)).set({ title: "Attività in bozza", overnight: true, startDate: "2026-09-01" }),
    registrationRef(`user_${alice.uid}`, draftActivityId).set(registration({ fullName: "Alice Rossi", userId: alice.uid })),
    registrationRef("user_fakebea", draftActivityId).set(registration({ fullName: "Beatrice Gialli", userId: "fakebea" })),
  ]);
  assert.deepEqual(await callMates(alice, request, "piano assente"), NO_ROOM);

  const draftPlan = {
    rooms: [GLICINE],
    assignments: { [`user_${alice.uid}`]: "glicine", user_fakebea: "glicine" },
    lockedIds: [],
    adultGenders: {},
    couples: [],
    revision: 1,
    updatedAt: "2026-07-01T10:00:00.000Z",
  };
  // Piano salvato prima della pubblicazione: niente flag.
  await planRef(draftActivityId).set(draftPlan);
  assert.deepEqual(await callMates(alice, request, "piano senza flag"), NO_ROOM);
  await planRef(draftActivityId).set({ ...draftPlan, published: false });
  assert.deepEqual(await callMates(alice, request, "piano in bozza"), NO_ROOM);
  await planRef(draftActivityId).set({ ...draftPlan, published: "true" });
  assert.deepEqual(await callMates(alice, request, "published stringa"), NO_ROOM);
  await planRef(draftActivityId).set({ ...draftPlan, published: 1 });
  assert.deepEqual(await callMates(alice, request, "published numero"), NO_ROOM);

  await planRef(draftActivityId).set({ ...draftPlan, published: true });
  assert.deepEqual(await callMates(alice, request, "ripubblicato"), {
    room: GLICINE_ROOM,
    mates: [youth("Beatrice Gialli")],
  });
  await planRef(draftActivityId).set({ ...draftPlan, published: false });
  assert.deepEqual(await callMates(alice, request, "di nuovo bozza"), NO_ROOM);
});

test("stanza con troppe assegnazioni: al massimo 50 compagni letti", async () => {
  const { alice } = people;
  const crowdedRoom = room("camerone", "Camerone", 50, "girls");
  const ids = Array.from({ length: 60 }, (_, index) => `user_p${String(index + 1).padStart(2, "0")}`);
  const batch = adminDb.batch();
  batch.set(adminDb.doc(activityPath(crowdedActivityId)), { title: "Attività affollata", overnight: true, startDate: "2026-07-15" });
  batch.set(registrationRef(`user_${alice.uid}`, crowdedActivityId), registration({ fullName: "Alice Rossi", userId: alice.uid }));
  for (const [index, id] of ids.entries()) {
    batch.set(registrationRef(id, crowdedActivityId), registration({
      fullName: `Persona ${String(index + 1).padStart(2, "0")}`,
      userId: id.slice("user_".length),
    }));
  }
  batch.set(planRef(crowdedActivityId), {
    rooms: [crowdedRoom],
    assignments: Object.fromEntries([`user_${alice.uid}`, ...ids].map((id) => [id, "camerone"])),
    lockedIds: [],
    adultGenders: {},
    couples: [],
    published: true,
    revision: 1,
    updatedAt: "2026-07-01T10:00:00.000Z",
  });
  await batch.commit();

  const data = await callMates(alice, { stakeId, activityId: crowdedActivityId }, "affollata");
  assert.deepEqual(data.room, { name: "Camerone", capacity: 50 });
  assert.equal(data.mates.length, 50);
  assert.equal(new Set(data.mates.map((mate) => mate.fullName)).size, 50, "nomi distinti");
  for (const mate of data.mates) {
    assert.match(mate.fullName, /^Persona \d\d$/);
    assert.equal(mate.adult, false);
  }
});

test("piano pubblicato con roomManagementSave: i compagni seguono pubblicazione e ritiro", async () => {
  const [admin, luca, davide] = await Promise.all([client("admin-salva"), client("luca"), client("davide-dirigente")]);
  const savedPath = activityPath(savedActivityId);
  const lucaId = `user_${luca.uid}`;
  const davideId = `user_${davide.uid}`;
  await Promise.all([
    adminDb.doc(`users/${admin.uid}`).set({ role: "admin", stakeId }),
    adminDb.doc(savedPath).set({ title: "Attività salvata", overnight: true, startDate: "2026-07-15" }),
    registrationRef(lucaId, savedActivityId).set(registration({
      fullName: "Luca Bianchi",
      userId: luca.uid,
      genderRoleCategory: "giovane_uomo",
      birthDate: "2010-01-01",
    })),
    registrationRef("user_fakemarco", savedActivityId).set(registration({
      fullName: "Marco Grigi",
      userId: "fakemarco",
      genderRoleCategory: "giovane_uomo",
      birthDate: "2011-03-03",
    })),
    registrationRef(davideId, savedActivityId).set(registration({
      fullName: "Davide Guida",
      userId: davide.uid,
      genderRoleCategory: "dirigente",
      birthDate: "1985-01-01",
    })),
  ]);

  const plan = (revision, published) => ({
    rooms: [
      { id: "staff", name: "Staff", capacity: 2, floor: "terra", category: "staff_male", accessible: false, notes: "", minAge: null, maxAge: null },
      { id: "boys", name: "Ragazzi", capacity: 3, floor: "primo", category: "boys", accessible: false, notes: "", minAge: 12, maxAge: 18 },
    ],
    assignments: { [lucaId]: "boys", user_fakemarco: "boys", [davideId]: "staff" },
    lockedIds: [],
    adultGenders: { [davideId]: "male" },
    couples: [],
    published,
    revision,
    updatedAt: "",
  });
  const save = (revision, published) =>
    admin.save({ stakeId, activityId: savedActivityId, expectedRevision: revision, plan: plan(revision, published) });
  const request = { stakeId, activityId: savedActivityId };

  // Salvato in bozza: nessun nome.
  assert.equal((await save(0, false)).data.plan.revision, 1);
  assert.deepEqual(await callMates(luca, request, "bozza salvata"), NO_ROOM);

  assert.equal((await save(1, true)).data.plan.published, true);
  assert.deepEqual(await callMates(luca, request, "luca pubblicato"), {
    room: { name: "Ragazzi", capacity: 3 },
    mates: [youth("Marco Grigi")],
  });
  // Il dirigente da solo nella stanza staff: la stanza sì, nessun compagno.
  assert.deepEqual(await callMates(davide, request, "davide pubblicato"), {
    room: { name: "Staff", capacity: 2 },
    mates: [],
  });

  await save(2, false);
  assert.deepEqual(await callMates(luca, request, "ritirato"), NO_ROOM);
  await save(3, true);
  assert.deepEqual(await callMates(luca, request, "ripubblicato"), {
    room: { name: "Ragazzi", capacity: 3 },
    mates: [youth("Marco Grigi")],
  });
});
