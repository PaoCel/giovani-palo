// Mail sui consensi foto e social (functions/lib/brevo.js), senza emulatori:
//  - testo della richiesta di completamento personalizzato su cosa manca;
//  - il link di gestione delle scelte nella copia del modulo firmato esce solo
//    verso il genitore, mai in un messaggio con BCC o con un altro destinatario.
// fetch è sostituito, nessuna richiesta esce davvero.
// Rilancio dalla radice del repository:
//   node --test functions/tests/consentMail.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildConsentCompletionContent,
  sendConsentCompletionEmail,
  sendSignedAuthorizationCopyEmail,
} = require("../lib/brevo.js");
const { logger } = require("firebase-functions");

const ENV_KEYS = [
  "GCLOUD_PROJECT",
  "GOOGLE_CLOUD_PROJECT",
  "FIREBASE_CONFIG",
  "FUNCTIONS_EMULATOR",
  "EMAIL_ALLOWLIST",
  "EMAIL_SUBJECT_PREFIX",
  "EMAIL_SENDER_ADDRESS",
  "EMAIL_REPLY_TO_ADDRESS",
  "APP_PUBLIC_URL",
];
const PARENT = "genitore@example.invalid";
const SUPPORT = "supporto@gugditalia.it";
const PRODUCTION = { GCLOUD_PROJECT: "giovani-palo" };
const STAGING = { GCLOUD_PROJECT: "giovani-palo-staging" };
const LINK = "https://example.invalid/parent-consent/TOKEN-SEGRETO-0123456789";
const TOKEN = "TOKEN-SEGRETO-0123456789";

/** Esegue `fn` con env pulito, fetch finto e logger.info/error muti; ripristina tutto. */
async function withEnvironment(vars, fn, { respond } = {}) {
  const savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  Object.assign(process.env, vars);
  const savedFetch = globalThis.fetch;
  const savedInfo = logger.info;
  const savedError = logger.error;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const call = { url, body: JSON.parse(init.body) };
    calls.push(call);
    if (respond) return respond(calls.length, call);
    return { ok: true, status: 200, statusText: "OK", json: async () => ({ messageId: `<m${calls.length}@brevo>` }), text: async () => "" };
  };
  logger.info = () => {};
  logger.error = () => {};
  try {
    return await fn({ calls });
  } finally {
    globalThis.fetch = savedFetch;
    logger.info = savedInfo;
    logger.error = savedError;
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  }
}

const emails = (list) => (list ?? []).map((recipient) => recipient.email);
const signedArgs = (overrides = {}) => ({
  apiKey: "chiave-finta",
  parentEmail: PARENT,
  parentName: "Genitore Esempio",
  participantName: "Mario Rossi",
  activityTitle: "Campo estivo",
  pdfBuffer: Buffer.from("%PDF-1.4 finto"),
  pdfFilename: "modulo.pdf",
  photoConsent: "accepted",
  socialPublicationConsent: "refused",
  ...overrides,
});
const leaksLink = (body) =>
  [body.htmlContent, body.textContent].some((text) => text.includes(TOKEN) || text.includes("parent-consent/"));

// ---------------------------------------------------------------------------
// Richiesta di completamento: il testo dice solo ciò che manca
// ---------------------------------------------------------------------------

const content = (missing) =>
  buildConsentCompletionContent({
    parentName: "Genitore Esempio",
    participantName: "Mario Rossi",
    activityTitle: "Campo estivo",
    consentUrl: LINK,
    missing,
  });
const body = (missing) => content(missing).paragraphs.join("\n");

test("manca solo il social: nessuna promessa sull'album, si parla dei social", () => {
  const text = body(["social"]);
  assert.doesNotMatch(text, /album/i);
  assert.match(text, /social/i);
  assert.match(text, /la scelta sui social/);
  assert.match(text, /non pubblicheremo foto/);
  assert.doesNotMatch(text, /le scelte su foto e social/);
});

test("manca solo la foto: nessuna promessa sui social, si parla dell'album", () => {
  const text = body(["photo"]);
  assert.doesNotMatch(text, /social/i);
  assert.match(text, /album dell'attività/);
  assert.match(text, /la scelta sulle foto/);
});

test("mancano entrambe: il testo copre foto e social", () => {
  for (const missing of [["photo", "social"], ["social", "photo"], undefined]) {
    const text = body(missing);
    assert.match(text, /le scelte su foto e social/);
    assert.match(text, /album dell'attività/);
    assert.match(text, /per i social/);
  }
});

test("singolare/plurale: 'non erano obbligatorie' solo per foto e social insieme", () => {
  const both = body(["photo", "social"]);
  assert.match(both, /le scelte su foto e social non erano obbligatorie e non hai indicato una risposta/);
  const photo = body(["photo"]);
  assert.match(photo, /la scelta sulle foto non era obbligatoria e non hai indicato una risposta/);
  assert.doesNotMatch(photo, /non erano obbligatorie/);
  const social = body(["social"]);
  assert.match(social, /la scelta sui social non era obbligatoria e non hai indicato una risposta/);
  assert.doesNotMatch(social, /non erano obbligatorie/);
  // Senza `missing` vale il caso completo, al plurale.
  assert.match(body(undefined), /non erano obbligatorie/);
});

test("i tre testi sono diversi tra loro e citano partecipante e attività", () => {
  const texts = [body(["photo"]), body(["social"]), body(["photo", "social"])];
  assert.equal(new Set(texts).size, 3);
  for (const text of texts) {
    assert.match(text, /Mario Rossi/);
    assert.match(text, /Campo estivo/);
    assert.match(text, /nessun consenso/);
    assert.match(text, /non devi firmare di nuovo/);
  }
});

test("il contenuto porta link e pulsante, saluto e nessuna scelta preimpostata", () => {
  for (const missing of [["photo"], ["social"], ["photo", "social"]]) {
    const result = content(missing);
    assert.equal(result.ctaUrl, LINK);
    assert.equal(result.choices, null);
    assert.match(result.greeting, /Genitore Esempio/);
  }
  assert.equal(
    buildConsentCompletionContent({ participantName: "M", activityTitle: "A", consentUrl: null, missing: ["photo"] }).ctaUrl,
    null,
    "nell'anteprima del dry-run il link non c'è",
  );
});

test("la mail inviata usa il testo di ciò che manca", async () => {
  await withEnvironment(PRODUCTION, async ({ calls }) => {
    await sendConsentCompletionEmail({
      apiKey: "chiave-finta",
      parentEmail: PARENT,
      parentName: "Genitore Esempio",
      participantName: "Mario Rossi",
      activityTitle: "Campo estivo",
      consentUrl: LINK,
      missing: ["social"],
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(emails(calls[0].body.to), [PARENT]);
    assert.equal(calls[0].body.bcc, undefined);
    assert.doesNotMatch(calls[0].body.htmlContent, /album/i);
    assert.doesNotMatch(calls[0].body.textContent, /album/i);
    assert.match(calls[0].body.textContent, /la scelta sui social/);
    assert.ok(calls[0].body.textContent.includes(LINK));
  });
});

// ---------------------------------------------------------------------------
// Copia del modulo firmato: il link solo al genitore
// ---------------------------------------------------------------------------

test("in produzione con il link escono DUE messaggi: genitore col link senza bcc, supporto senza link", async () => {
  await withEnvironment(PRODUCTION, async ({ calls }) => {
    const result = await sendSignedAuthorizationCopyEmail(signedArgs({ consentUrl: LINK }));
    assert.equal(calls.length, 2);

    const [toParent, toSupport] = calls.map((call) => call.body);
    assert.deepEqual(emails(toParent.to), [PARENT]);
    assert.equal(toParent.bcc, undefined, "il messaggio col link non ha bcc");
    assert.ok(toParent.htmlContent.includes(LINK));
    assert.ok(toParent.textContent.includes(LINK));
    assert.equal(toParent.replyTo.email, SUPPORT);
    assert.equal(toParent.subject, "Modulo firmato - Campo estivo");

    assert.deepEqual(emails(toSupport.to), [SUPPORT]);
    assert.equal(toSupport.bcc, undefined);
    assert.equal(leaksLink(toSupport), false, "nessun link nel messaggio al supporto");
    assert.equal(toSupport.replyTo.email, SUPPORT);
    assert.equal(toSupport.subject, "Modulo firmato - Campo estivo");
    assert.match(toSupport.textContent, /foto acconsento|foto non acconsento/i, "il supporto vede comunque le scelte");
    assert.equal(toSupport.attachment[0].name, "modulo.pdf", "e il modulo firmato");

    // Il risultato è quello della consegna al genitore.
    assert.equal(result.messageId, "<m1@brevo>");
  });
});

test("invariante: un messaggio con il link ha come unico destinatario il genitore e nessun bcc", async () => {
  for (const [vars, label] of [
    [PRODUCTION, "produzione"],
    [{ ...STAGING, EMAIL_ALLOWLIST: `${PARENT}, ${SUPPORT}` }, "staging con entrambi in allowlist"],
    [{ ...STAGING, EMAIL_ALLOWLIST: "@example.invalid, @gugditalia.it" }, "staging con domini"],
  ]) {
    await withEnvironment(vars, async ({ calls }) => {
      await sendSignedAuthorizationCopyEmail(signedArgs({ consentUrl: LINK }));
      assert.ok(calls.length >= 1, label);
      for (const { body: payload } of calls) {
        if (leaksLink(payload)) {
          assert.deepEqual(emails(payload.to), [PARENT], `${label}: destinatari`);
          assert.equal(payload.bcc, undefined, `${label}: bcc`);
        }
      }
      assert.equal(calls.filter(({ body: payload }) => leaksLink(payload)).length, 1, `${label}: un solo messaggio col link`);
    });
  }
});

test("senza link resta un solo messaggio con il bcc al supporto, come prima", async () => {
  await withEnvironment(PRODUCTION, async ({ calls }) => {
    await sendSignedAuthorizationCopyEmail(signedArgs());
    assert.equal(calls.length, 1);
    assert.deepEqual(emails(calls[0].body.to), [PARENT]);
    assert.deepEqual(emails(calls[0].body.bcc), [SUPPORT]);
    assert.equal(leaksLink(calls[0].body), false);

    const empty = await sendSignedAuthorizationCopyEmail(signedArgs({ consentUrl: null }));
    assert.equal(calls.length, 2);
    assert.deepEqual(emails(calls[1].body.bcc), [SUPPORT]);
    assert.ok(empty.messageId);
  });
});

test("se il genitore è l'indirizzo di supporto parte un solo messaggio, senza bcc né copia", async () => {
  await withEnvironment(PRODUCTION, async ({ calls }) => {
    await sendSignedAuthorizationCopyEmail(signedArgs({ parentEmail: SUPPORT, consentUrl: LINK }));
    assert.equal(calls.length, 1);
    assert.deepEqual(emails(calls[0].body.to), [SUPPORT]);
    assert.equal(calls[0].body.bcc, undefined);
  });
});

test("fuori produzione con il solo genitore in allowlist: esce solo il messaggio col link, la copia al supporto è soppressa", async () => {
  await withEnvironment({ ...STAGING, EMAIL_ALLOWLIST: PARENT }, async ({ calls }) => {
    await sendSignedAuthorizationCopyEmail(signedArgs({ consentUrl: LINK }));
    assert.equal(calls.length, 1);
    assert.deepEqual(emails(calls[0].body.to), [PARENT]);
    assert.equal(calls[0].body.bcc, undefined);
    assert.ok(calls[0].body.textContent.includes(LINK));
  });
});

test("fuori produzione con il solo supporto in allowlist non esce il messaggio col link", async () => {
  await withEnvironment({ ...STAGING, EMAIL_ALLOWLIST: SUPPORT }, async ({ calls }) => {
    const result = await sendSignedAuthorizationCopyEmail(signedArgs({ consentUrl: LINK }));
    assert.equal(result.simulated, true, "il risultato è quello del genitore");
    for (const { body: payload } of calls) {
      assert.equal(leaksLink(payload), false);
      assert.deepEqual(emails(payload.to), [SUPPORT]);
    }
  });
});

test("fuori produzione senza allowlist non esce niente, link compreso", async () => {
  await withEnvironment(STAGING, async ({ calls }) => {
    const result = await sendSignedAuthorizationCopyEmail(signedArgs({ consentUrl: LINK }));
    assert.equal(result.simulated, true);
    assert.equal(calls.length, 0);
  });
});

test("un errore sulla copia al supporto non fa fallire la consegna al genitore", async () => {
  await withEnvironment(
    PRODUCTION,
    async ({ calls }) => {
      const result = await sendSignedAuthorizationCopyEmail(signedArgs({ consentUrl: LINK }));
      assert.equal(calls.length, 2);
      assert.equal(result.messageId, "<m1@brevo>");
    },
    {
      respond: (n) =>
        n === 1
          ? { ok: true, status: 200, statusText: "OK", json: async () => ({ messageId: "<m1@brevo>" }), text: async () => "" }
          : { ok: false, status: 500, statusText: "Server Error", json: async () => ({}), text: async () => "boom" },
    },
  );
});

test("un errore sulla consegna al genitore si propaga e la copia al supporto non parte", async () => {
  await withEnvironment(
    PRODUCTION,
    async ({ calls }) => {
      await assert.rejects(sendSignedAuthorizationCopyEmail(signedArgs({ consentUrl: LINK })));
      assert.equal(calls.length, 1, "nessuna copia al supporto se il genitore non ha ricevuto");
    },
    { respond: () => ({ ok: false, status: 500, statusText: "Server Error", json: async () => ({}), text: async () => "boom" }) },
  );
});
