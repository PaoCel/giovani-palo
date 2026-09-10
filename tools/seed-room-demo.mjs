// Synthetic data only. Refuse every non-local emulator or non-demo project.
import { createRequire } from "node:module";
const require = createRequire(new URL("../functions/package.json", import.meta.url));
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const projectId = process.env.GCLOUD_PROJECT;
if (!projectId?.startsWith("demo-") || process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8180" || process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9199") {
  throw new Error("Use only demo-* with the room-planner local emulators.");
}
initializeApp({ projectId });
const db = getFirestore();
const auth = getAuth();
const uid = "room-demo-admin";
try { await auth.getUser(uid); } catch (error) {
  if (error.code !== "auth/user-not-found") throw error;
  await auth.createUser({ uid, email: "room-admin@example.invalid", password: "RoomDemo2026!", emailVerified: true });
}
const timestamp = new Date().toISOString();
const batch = db.batch();
batch.set(db.doc(`users/${uid}`), {
  firstName: "Admin", lastName: "Demo", fullName: "Admin Demo", role: "admin", stakeId: "roma-est",
  email: "room-admin@example.invalid", genderRoleCategory: "dirigente", birthDate: "1980-01-01",
  unitId: "demo", unitName: "Unità demo", createdAt: timestamp, updatedAt: timestamp,
  stakeSlug: "roma-est", stakeName: "Palo di Roma Est", mustChangePassword: false, lastLoginAt: timestamp,
});
batch.set(db.doc("stakes/roma-est"), {
  name: "Palo di Roma Est", stakeName: "Palo di Roma Est", slug: "roma-est", isActive: true,
  publicHomeTitle: "Collaudo stanze", publicHomeSubtitle: "Solo dati sintetici", updatedAt: timestamp,
});
const activity = db.doc("stakes/roma-est/activities/room-demo");
batch.set(activity, {
  title: "Viaggio al Tempio · anteprima", description: "Collaudo locale con partecipanti fittizi.",
  location: "Foresteria del Tempio di Roma", startDate: "2026-10-16T08:00:00", endDate: "2026-10-17T18:00:00",
  overnight: true, activityType: "overnight", status: "registrations_open", isVisible: true, isPublic: false,
  createdAt: timestamp, updatedAt: timestamp,
});
batch.set(activity.collection("config").doc("form"), {
  allowGuestRegistration: false, requireLoginForEdit: true,
  enabledStandardFields: ["birthDate", "genderRoleCategory", "roomPreference1Name", "roomPreference2Name", "roomNotes"], customFields: [],
});
const boys = ["Marco", "Luca", "Andrea", "Matteo", "Davide", "Simone", "Gabriele", "Pietro", "Lorenzo", "Alessandro", "Filippo", "Tommaso", "Edoardo", "Leonardo"];
const girls = ["Giulia", "Sofia", "Chiara", "Anna", "Elena", "Alice", "Sara", "Emma", "Giorgia", "Beatrice", "Aurora", "Francesca", "Martina", "Ilaria"];
for (const [group, names] of [["giovane_uomo", boys], ["giovane_donna", girls]]) {
  for (const [index, firstName] of names.entries()) {
    batch.set(activity.collection("registrations").doc(`${group}-${index}`), {
      firstName, lastName: "Esempio", fullName: `${firstName} Esempio`, genderRoleCategory: group,
      birthDate: `${2009 + index % 3}-04-15`, registrationStatus: "confirmed", userId: `${group}-${index}`,
      unitId: "demo", unitNameSnapshot: "Unità demo", email: "", phone: "", assignedRoomId: null,
      roomPreferenceMatches: {}, answers: { roomPreference1Name: `${names[index % 2 ? index - 1 : index + 1]} Esempio`,
        ...(index === 13 && group === "giovane_uomo" ? { roomNotes: "Preferisco la stanza al piano terra." } : {}) },
      createdAt: timestamp, updatedAt: timestamp,
    });
  }
}
for (const [index, firstName] of ["Paolo", "Maria", "Carlo", "Luisa"].entries()) {
  batch.set(activity.collection("registrations").doc(`staff-${index}`), {
    firstName, lastName: "Demo", fullName: `${firstName} Demo`, genderRoleCategory: "accompagnatore",
    birthDate: "1980-05-10", registrationStatus: "confirmed", userId: `staff-${index}`, unitId: "demo", unitNameSnapshot: "Unità demo",
    email: "", phone: "", assignedRoomId: null, roomPreferenceMatches: {},
    answers: index < 2 ? { roomPreference1Name: `${index ? "Paolo" : "Maria"} Demo`, roomNotes: "Chiedo di stare in stanza con mio marito / mia moglie." } : {},
    createdAt: timestamp, updatedAt: timestamp,
  });
}
await batch.commit();
console.log("Demo pronta: 32 partecipanti fittizi. Apri /admin/events/room-demo/rooms sul server locale.");
