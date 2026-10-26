// Eseguire soltanto con Firestore Emulator e progetto demo-*.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { initializeApp, deleteApp } from "firebase/app";
import {
  getFirestore, connectFirestoreEmulator, collection, doc, query, where,
  getDocsFromServer, getDocFromServer, setDoc, updateDoc, deleteDoc,
} from "firebase/firestore";

const require = createRequire(import.meta.url);
const { initializeApp: initializeAdminApp, deleteApp: deleteAdminApp } = require("firebase-admin/app");
const { getFirestore: getAdminFirestore } = require("firebase-admin/firestore");
const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
const host = process.env.FIRESTORE_EMULATOR_HOST || "";
assert.match(project, /^demo-/u, "Richiesto progetto demo-*");
assert.match(host, /^(localhost|127\.0\.0\.1):\d+$/u, "Richiesto Firestore Emulator locale");
const [hostname, port] = host.split(":");
const run = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const stake = `survey-test-${run}`;
const adminApp = initializeAdminApp({ projectId: project }, `survey-admin-${run}`);
const adminDb = getAdminFirestore(adminApp);
const clients = {};
const activityPath = (event = "enabled") => `stakes/${stake}/activities/${event}`;
const ref = (db, path, event) => doc(db, `${activityPath(event)}/${path}`);
const questions = (db, event) => collection(db, `${activityPath(event)}/surveyQuestions`);
const responses = (db, event) => collection(db, `${activityPath(event)}/surveyResponses`);
const payload = (event = "enabled", extra = {}) => ({
  stakeId: stake, eventId: event, category: "", isDraft: true,
  answers: { active: { type: "rating", value: 4 } },
  createdAt: "2026-10-23T08:00:00Z", updatedAt: "2026-10-23T08:00:00Z", submittedAt: null,
  ...extra,
});
const events = {
  enabled: {}, disabled: { surveyGuestEnabled: false },
  missingFlag: { surveyGuestEnabled: undefined },
  private: { isPublic: false }, hidden: { isVisible: false }, draft: { status: "draft" },
};
async function denied(promise) {
  await assert.rejects(promise, error => {
    assert.equal(error.code, "permission-denied");
    return true;
  });
}

before(async () => {
  const batch = adminDb.batch();
  for (const [event, extra] of Object.entries(events)) {
    const data = { isPublic: true, isVisible: true, status: "published", surveyGuestEnabled: true, ...extra };
    if (data.surveyGuestEnabled === undefined) delete data.surveyGuestEnabled;
    batch.set(adminDb.doc(activityPath(event)), data);
    for (const status of ["active", "draft", "archived"]) {
      batch.set(adminDb.doc(`${activityPath(event)}/surveyQuestions/${status}`), {
        status, text: "Domanda sintetica", type: "rating", order: status === "active" ? 2 : 1,
      });
    }
    batch.set(adminDb.doc(`${activityPath(event)}/surveyResponses/draft`), payload(event));
    batch.set(adminDb.doc(`${activityPath(event)}/surveyResponses/final`), payload(event, { isDraft: false }));
  }
  batch.set(adminDb.doc(`${activityPath()}/records/open`), { status: "open", title: "Prova sintetica", challengerCount: 1 });
  batch.set(adminDb.doc(`stakes/${stake}/galleries/private`), { visibility: "private", activityId: "enabled" });
  batch.set(adminDb.doc(`users/admin-${run}`), { role: "admin", stakeId: stake });
  batch.set(adminDb.doc(`stakes/${stake}/members/account-${run}`), { status: "active", staffRole: null });
  batch.set(adminDb.doc(`stakes/${stake}/members/pending-${run}`), { status: "pending", staffRole: null });
  batch.set(adminDb.doc(`users/nonmember-${run}`), { role: "participant", stakeId: stake });
  batch.set(adminDb.doc(`users/pending-${run}`), { role: "participant", stakeId: stake });
  await batch.commit();
  for (const [actor, provider] of [["guest", "anonymous"], ["account", "password"], ["nonmember", "password"], ["pending", "password"], ["admin", "password"], ["signedOut", null]]) {
    const app = initializeApp({ apiKey: "demo-key", projectId: project }, `survey-${actor}-${run}`);
    const db = getFirestore(app);
    connectFirestoreEmulator(db, hostname, Number(port), provider ? {
      mockUserToken: { sub: `${actor}-${run}`, firebase: { sign_in_provider: provider } },
    } : {});
    clients[actor] = { app, db };
  }
});

after(async () => {
  await Promise.all(Object.values(clients).map(({ app }) => deleteApp(app)));
  await adminDb.recursiveDelete(adminDb.doc(`stakes/${stake}`));
  await adminDb.doc(`users/admin-${run}`).delete();
  await adminDb.doc(`users/nonmember-${run}`).delete();
  await adminDb.doc(`users/pending-${run}`).delete();
  await deleteAdminApp(adminApp);
});

test("ospite: query esatta delle sole domande attive, senza orderBy", async () => {
  const db = clients.guest.db;
  const snap = await getDocsFromServer(query(questions(db), where("status", "==", "active")));
  assert.deepEqual(snap.docs.map(item => item.id), ["active"]);
  assert.equal((await getDocFromServer(ref(db, "surveyQuestions/active"))).exists(), true);
  await denied(getDocsFromServer(questions(db)));
  for (const status of ["draft", "archived"]) {
    await denied(getDocFromServer(ref(db, `surveyQuestions/${status}`)));
    await denied(getDocsFromServer(query(questions(db), where("status", "==", status))));
  }
});

test("ospite: crea e riprende bozza anonima, invia e non modifica il definitivo", async () => {
  const db = clients.guest.db;
  const target = ref(db, "surveyResponses/guest-created");
  await setDoc(target, payload());
  assert.equal((await getDocFromServer(target)).data().category, "");
  await updateDoc(target, { answers: { active: { type: "rating", value: 5 } } });
  await updateDoc(target, { isDraft: false });
  await denied(updateDoc(target, { isDraft: true }));
  await denied(updateDoc(target, { answers: {} }));
  await denied(deleteDoc(target));
  await denied(getDocsFromServer(responses(db)));
});

test("ospite: invio diretto senza bozza consentito e definitivo immutabile", async () => {
  const target = ref(clients.guest.db, "surveyResponses/direct-final");
  await setDoc(target, payload("enabled", { isDraft: false }));
  assert.equal((await getDocFromServer(target)).data().isDraft, false);
  await denied(updateDoc(target, { answers: {} }));
});

test("ospite: nessuna identità o categoria personale nel payload", async () => {
  const db = clients.guest.db;
  const invalid = [
    { userId: "synthetic-uid" }, { anonymousUid: "synthetic-uid" },
    { name: "Nome sintetico" }, { fullName: "Nome sintetico" }, { winnerName: "Nome sintetico" },
    { category: "giovane_uomo" }, { stakeId: "other-stake" }, { eventId: "other-event" },
    { isDraft: "true" }, { answers: [] }, { answers: "testo" },
  ];
  for (const [i, extra] of invalid.entries()) {
    await denied(setDoc(ref(db, `surveyResponses/invalid-${i}`), payload("enabled", extra)));
    await denied(updateDoc(ref(db, "surveyResponses/draft"), extra));
  }
});

test("ospite: campi obbligatori assenti non diventano risposte valide", async () => {
  const db = clients.guest.db;
  for (const field of ["category", "isDraft", "answers", "eventId", "stakeId"]) {
    const invalid = payload();
    delete invalid[field];
    await denied(setDoc(ref(db, `surveyResponses/missing-${field}`), invalid));
  }
});

test("ospite: evento inesistente non apre sottocollection orfane", async () => {
  const event = "missing-event";
  await adminDb.doc(`${activityPath(event)}/surveyQuestions/active`).set({ status: "active", order: 1 });
  await adminDb.doc(`${activityPath(event)}/surveyResponses/draft`).set(payload(event));
  const db = clients.guest.db;
  await denied(getDocFromServer(ref(db, "surveyQuestions/active", event)));
  await denied(getDocsFromServer(query(questions(db, event), where("status", "==", "active"))));
  await denied(getDocFromServer(ref(db, "surveyResponses/draft", event)));
  await denied(setDoc(ref(db, "surveyResponses/new", event), payload(event)));
  await denied(updateDoc(ref(db, "surveyResponses/draft", event), { isDraft: false }));
});

for (const event of Object.keys(events).filter(id => id !== "enabled")) {
  test(`ospite: evento ${event} nega letture e scritture sondaggio`, async () => {
    const db = clients.guest.db;
    await denied(getDocFromServer(ref(db, "surveyQuestions/active", event)));
    await denied(getDocsFromServer(query(questions(db, event), where("status", "==", "active"))));
    await denied(getDocFromServer(ref(db, "surveyResponses/draft", event)));
    await denied(setDoc(ref(db, "surveyResponses/new", event), payload(event)));
    await denied(updateDoc(ref(db, "surveyResponses/draft", event), { isDraft: false }));
  });
}

test("membro attivo: permessi correnti invariati anche senza opt-in guest", async () => {
  const db = clients.account.db;
  const snap = await getDocsFromServer(questions(db, "disabled"));
  assert.equal(snap.size, 3);
  await getDocFromServer(ref(db, "surveyResponses/draft", "disabled"));
  const target = ref(db, "surveyResponses/account-new", "disabled");
  await setDoc(target, payload("disabled", { category: "dirigente" }));
  await updateDoc(target, { isDraft: false });
  await denied(updateDoc(target, { answers: {} }));
  await denied(getDocsFromServer(responses(db, "disabled")));
  await denied(setDoc(ref(db, "surveyQuestions/account-new"), { status: "active" }));
});

for (const actor of ["nonmember", "pending"]) {
  test(`${actor}: opt-in ospite non scavalca l'appartenenza per account personali`, async () => {
    const db = clients[actor].db;
    for (const event of ["enabled", "disabled"]) {
      await denied(getDocsFromServer(query(questions(db, event), where("status", "==", "active"))));
      await denied(getDocFromServer(ref(db, "surveyResponses/draft", event)));
      await denied(setDoc(ref(db, `surveyResponses/${actor}-new`, event), payload(event)));
      await denied(updateDoc(ref(db, "surveyResponses/draft", event), { isDraft: false }));
    }
  });
}

test("revoca a sessione aperta: un membro perde accesso a query, bozza e invio", async () => {
  const db = clients.account.db;
  const membership = adminDb.doc(`stakes/${stake}/members/account-${run}`);
  await membership.set({ status: "active", staffRole: null });
  await getDocsFromServer(query(questions(db), where("status", "==", "active")));
  await membership.update({ status: "removed" });
  try {
    await denied(getDocsFromServer(query(questions(db), where("status", "==", "active"))));
    await denied(getDocFromServer(ref(db, "surveyResponses/draft")));
    await denied(setDoc(ref(db, "surveyResponses/revoked"), payload()));
  } finally { await membership.update({ status: "active" }); }
});

test("admin: gestione domande e lista risposte conservate", async () => {
  const db = clients.admin.db;
  const target = ref(db, "surveyQuestions/admin-new", "disabled");
  await setDoc(target, { status: "draft", text: "Domanda sintetica" });
  await updateDoc(target, { status: "active" });
  await deleteDoc(target);
  assert.equal((await getDocsFromServer(responses(db, "disabled"))).size >= 2, true);
});

test("senza sessione: nessun accesso al sondaggio né creazione risposte", async () => {
  const db = clients.signedOut.db;
  await denied(getDocsFromServer(query(questions(db), where("status", "==", "active"))));
  await denied(getDocFromServer(ref(db, "surveyResponses/draft")));
  await denied(setDoc(ref(db, "surveyResponses/signed-out"), payload()));
});

test("ospite sondaggio: record e gallerie restano chiusi", async () => {
  const db = clients.guest.db;
  await denied(getDocsFromServer(query(collection(db, `${activityPath()}/records`), where("status", "==", "open"))));
  await denied(getDocFromServer(ref(db, "records/open")));
  await denied(getDocFromServer(doc(db, `stakes/${stake}/galleries/private`)));
  await denied(getDocsFromServer(collection(db, `stakes/${stake}/galleries/private/media`)));
});
