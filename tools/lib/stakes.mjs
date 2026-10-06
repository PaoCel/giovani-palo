// Creazione di un palo: documento stake, unita' e (facoltativo) primo admin.
// Unica implementazione, usata da `tools/create-stake.mjs` e da
// `tools/seed-demo.mjs`: nessuna UI crea pali, primi admin o dirigenti.
//
// Mirror dei default di `buildDefaultStakeDocument` in
// src/services/firestore/stakesService.ts: se cambiano la' (campi o testi),
// cambiano anche qui.

const STAKE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,39}$/;

export function slugify(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Id unita' unico fra pali: lo slug del nome da solo collide fra due pali. */
export function unitIdFor(stakeId, unitName) {
  return `${stakeId}-${slugify(unitName)}`;
}

export function buildStakeDocument({ name, slug, supportContact, now }) {
  return {
    name,
    slug,
    isActive: true,
    publicHomeTitle: "Attività giovanili",
    publicHomeSubtitle:
      "Informazioni chiare, iscrizioni veloci e una gestione più ordinata delle attività del palo.",
    accountHelpText:
      "Crea un account per salvare i tuoi dati principali e ritrovare più facilmente le iscrizioni future.",
    codeRecoveryHelpText:
      "Se ti iscrivi senza account, conserva il codice di recupero e il PDF riepilogativo.",
    // Mai vuoto: i campi vuoti ricadono sul profilo legacy di roma-est.
    supportContact: supportContact || "supporto@gugditalia.it",
    guestRegistrationHint:
      "Se non fai il login, i tuoi dati verranno salvati solo per questa attività.",
    minorConsentExampleImageUrl: "",
    minorConsentExampleImagePath: "",
    youngMenPresident: "",
    youngMenCounselors: [],
    youngWomenPresident: "",
    youngWomenCounselors: [],
    registrationDefaults: {
      allowGuestRegistration: true,
      requireLoginForEdit: true,
      enabledStandardFields: ["birthDate", "genderRoleCategory", "phone", "unitName"],
      fieldOverrides: {},
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function buildUnitDocument({ name, type = "rione", now }) {
  return { name, type, isActive: true, createdAt: now, updatedAt: now };
}

/** Profilo `users/{uid}` valido per `validUserPayload` (nessuna chiave in piu'). */
export function buildUserDocument({
  firstName,
  lastName,
  email = null,
  role,
  stake,
  unit = null,
  genderRoleCategory = "",
  birthDate = "",
  city,
  phone,
  now,
}) {
  return {
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`.trim(),
    email,
    ...(phone ? { phone } : {}),
    role,
    ...(city ? { city } : {}),
    birthDate,
    genderRoleCategory,
    unitId: unit?.id ?? "",
    unitName: unit?.name ?? "",
    stakeId: stake.id,
    stakeSlug: stake.slug,
    stakeName: stake.name,
    mustChangePassword: false,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  };
}

/**
 * @param {object} ctx { db, auth } Admin SDK gia' puntati sul bersaglio validato.
 * @param {object} input
 *   stakeId, name, slug?, supportContact?, units?: [{name, type?}],
 *   admin?: {email, firstName, lastName, uid?, password?},
 *   now?: ISO string, apply: boolean
 * @returns piano (apply=false) o esito (apply=true)
 */
export async function createStake({ db, auth }, input) {
  const { stakeId, name, apply = false } = input;
  if (!STAKE_ID_PATTERN.test(stakeId || "")) {
    throw new Error(`Id palo non valido "${stakeId}": 3-40 caratteri, minuscole, cifre e trattini.`);
  }
  if (!name || !name.trim()) throw new Error("Nome del palo mancante.");

  const now = input.now || new Date().toISOString();
  const stakeRef = db.doc(`stakes/${stakeId}`);
  if ((await stakeRef.get()).exists) {
    throw new Error(`stakes/${stakeId} esiste gia': nessuna sovrascrittura.`);
  }

  const stake = { id: stakeId, name: name.trim(), slug: input.slug || slugify(name) || stakeId };
  const units = (input.units || []).map((unit) => ({
    id: unitIdFor(stakeId, unit.name),
    name: unit.name.trim(),
    type: unit.type === "ramo" ? "ramo" : "rione",
  }));
  if (new Set(units.map((unit) => unit.id)).size !== units.length) {
    throw new Error("Unita' con lo stesso nome.");
  }

  let admin = null;
  let adminUnit = null;
  if (input.admin) {
    const { email, firstName, lastName } = input.admin;
    if (!email || !firstName || !lastName) throw new Error("Admin: servono email, nome e cognome.");
    // Un admin non puo' cambiare unita' da solo (canUpdateOwnUser) e il
    // completamento profilo la richiede: senza unita' resta bloccato al primo accesso.
    if (units.length === 0) throw new Error("Admin: serve almeno un'unita' (--unit) a cui assegnarlo.");
    const wanted = input.admin.unit ? unitIdFor(stakeId, input.admin.unit) : units[0].id;
    adminUnit = units.find((unit) => unit.id === wanted);
    if (!adminUnit) throw new Error(`Admin: l'unita' "${input.admin.unit}" non e' fra quelle del palo.`);
    // `admin.uid` e' l'uid DESIDERATO per un account nuovo, non la prova che esista:
    // si cerca per uid se indicato, altrimenti per email.
    let existingUid = null;
    try {
      const found = input.admin.uid ? await auth.getUser(input.admin.uid) : await auth.getUserByEmail(email);
      if ((found.email || "").toLowerCase() !== email.toLowerCase()) {
        throw new Error(`L'account ${found.uid} ha un'email diversa da ${email}: non lo uso.`);
      }
      existingUid = found.uid;
    } catch (error) {
      if (error.code !== "auth/user-not-found") throw error;
    }
    if (existingUid) {
      const profile = await db.doc(`users/${existingUid}`).get();
      if (profile.exists && profile.data().stakeId !== stakeId) {
        throw new Error(
          `L'account ${email} ha gia' un profilo nel palo "${profile.data().stakeId}": non lo sposto.`,
        );
      }
    }
    admin = { ...input.admin, existingUid, adminUnit };
  }

  const plan = {
    stake: stakeRef.path,
    units: units.map((unit) => `stakes/${stakeId}/units/${unit.id}`),
    admin: admin
      ? { email: admin.email, authUser: admin.existingUid ? "esistente" : "da creare" }
      : null,
  };
  if (!apply) return { applied: false, plan };

  let adminUid = null;
  let passwordResetLink = null;
  if (admin) {
    adminUid = admin.existingUid;
    if (!adminUid) {
      const created = await auth.createUser({
        ...(admin.uid ? { uid: admin.uid } : {}),
        email: admin.email,
        emailVerified: true,
        displayName: `${admin.firstName} ${admin.lastName}`,
        ...(admin.password ? { password: admin.password } : {}),
      });
      adminUid = created.uid;
    }
    if (!admin.password) {
      passwordResetLink = await auth.generatePasswordResetLink(admin.email);
    }
  }

  const batch = db.batch();
  batch.set(
    stakeRef,
    buildStakeDocument({ name: stake.name, slug: stake.slug, supportContact: input.supportContact, now }),
  );
  for (const unit of units) {
    batch.set(db.doc(`stakes/${stakeId}/units/${unit.id}`), buildUnitDocument({ ...unit, now }));
  }
  if (admin) {
    batch.set(
      db.doc(`users/${adminUid}`),
      buildUserDocument({
        firstName: admin.firstName,
        lastName: admin.lastName,
        email: admin.email,
        role: "admin",
        stake,
        unit: admin.adminUnit,
        genderRoleCategory: "dirigente",
        // Segnaposto: senza data di nascita il completamento profilo blocca
        // l'accesso; l'admin la corregge da /me.
        birthDate: admin.birthDate || "1980-01-01",
        now,
      }),
    );
  }
  await batch.commit();

  return { applied: true, plan, stake, units, adminUid, passwordResetLink };
}
