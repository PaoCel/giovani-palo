#!/usr/bin/env node
/**
 * Collega le iscrizioni esistenti agli account genitore.
 *
 * Per ogni utente con role == 'parent', cerca le iscrizioni che hanno
 * parentAuthorization.parentEmail uguale all'email dell'account (case
 * insensitive) e nessun proprietario account (userId == null). Per ogni
 * partecipante distinto (nome + data di nascita) crea un profilo figlio in
 * users/{parentUid}/children e scrive parentUid/childId sull'iscrizione.
 *
 * Le iscrizioni collegate diventano VISIBILI nella dashboard famiglia.
 * Restano modificabili solo dal flusso originale (codice di recupero o
 * admin): non cambiamo né l'id del documento né il submittedByMode.
 *
 * Uso (da functions/, con credenziali admin attive):
 *   node scripts/linkParentRegistrations.mjs                  # dry-run
 *   node scripts/linkParentRegistrations.mjs --apply
 *   node scripts/linkParentRegistrations.mjs --parent-email mario@example.com
 */
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
const emailArgIndex = process.argv.indexOf("--parent-email");
const ONLY_EMAIL =
  emailArgIndex >= 0 ? (process.argv[emailArgIndex + 1] ?? "").toLowerCase() : null;

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

const normalizeEmail = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";
const childKey = (fullName, birthDate) =>
  `${(fullName ?? "").trim().toLowerCase()}|${birthDate ?? ""}`;

const stats = { parents: 0, matched: 0, childrenCreated: 0, linked: 0, skipped: 0 };

async function loadParents() {
  const snapshot = await db.collection("users").where("role", "==", "parent").get();
  return snapshot.docs
    .map((doc) => ({ uid: doc.id, ...doc.data() }))
    .filter((parent) => normalizeEmail(parent.email))
    .filter((parent) => !ONLY_EMAIL || normalizeEmail(parent.email) === ONLY_EMAIL);
}

async function loadExistingChildren(parentUid) {
  const snapshot = await db.collection(`users/${parentUid}/children`).get();
  const byKey = new Map();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    byKey.set(childKey(data.fullName, data.birthDate), doc.id);
  }
  return byKey;
}

async function processParent(parent) {
  const parentEmail = normalizeEmail(parent.email);
  console.log(`\nGenitore: ${parent.uid} <${parentEmail}>`);

  // Niente indice su parentAuthorization.parentEmail: scandiamo le iscrizioni
  // per stake/attività. Volumi attuali contenuti; rivalutare se crescono.
  const registrations = await db.collectionGroup("registrations").get();
  const matches = registrations.docs.filter((doc) => {
    const data = doc.data();
    return (
      normalizeEmail(data?.parentAuthorization?.parentEmail) === parentEmail &&
      (data.userId == null || data.userId === "") &&
      (data.parentUid == null || data.parentUid === "")
    );
  });

  if (matches.length === 0) {
    console.log("  Nessuna iscrizione da collegare.");
    return;
  }

  const childrenByKey = await loadExistingChildren(parent.uid);

  for (const doc of matches) {
    const data = doc.data();
    stats.matched++;
    const key = childKey(data.fullName, data.birthDate);
    let childId = childrenByKey.get(key);

    if (!childId) {
      const timestamp = new Date().toISOString();
      const childRef = db.collection(`users/${parent.uid}/children`).doc();
      childId = childRef.id;
      childrenByKey.set(key, childId);
      stats.childrenCreated++;
      console.log(
        `  [child] ${APPLY ? "CREO" : "dry-run"} ${childId} "${data.fullName}" (${data.birthDate || "senza data"})`,
      );
      if (APPLY) {
        await childRef.set({
          firstName: typeof data.firstName === "string" ? data.firstName : "",
          lastName: typeof data.lastName === "string" ? data.lastName : "",
          fullName: typeof data.fullName === "string" ? data.fullName : "",
          birthDate: typeof data.birthDate === "string" ? data.birthDate : "",
          genderRoleCategory:
            data.genderRoleCategory === "giovane_uomo" ||
            data.genderRoleCategory === "giovane_donna"
              ? data.genderRoleCategory
              : "",
          unitId: typeof data.unitId === "string" ? data.unitId : "",
          unitName:
            typeof data.unitNameSnapshot === "string" ? data.unitNameSnapshot : "",
          stakeId: typeof data.stakeId === "string" ? data.stakeId : "",
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
    }

    stats.linked++;
    console.log(
      `  [reg] ${APPLY ? "LINK" : "dry-run"} ${doc.ref.path} -> parentUid=${parent.uid} childId=${childId}`,
    );
    if (APPLY) {
      await doc.ref.update({
        parentUid: parent.uid,
        childId,
        updatedAt: new Date().toISOString(),
      });
    }
  }
}

async function main() {
  console.log(`Link iscrizioni -> genitori — modalità: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  const parents = await loadParents();
  stats.parents = parents.length;

  if (parents.length === 0) {
    console.log("Nessun account genitore trovato (role == 'parent').");
    return;
  }

  for (const parent of parents) {
    await processParent(parent);
  }

  console.log("\nRiepilogo:");
  console.log(`  genitori analizzati:   ${stats.parents}`);
  console.log(`  iscrizioni abbinate:   ${stats.matched}`);
  console.log(`  profili figli creati:  ${stats.childrenCreated}`);
  console.log(`  iscrizioni collegate:  ${stats.linked}${APPLY ? "" : " (dry-run)"}`);
}

main().catch((error) => {
  console.error("Script fallito:", error);
  process.exitCode = 1;
});
