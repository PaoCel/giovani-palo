import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { BrevoError, sendParentAuthorizationEmail, sendSignedAuthorizationCopyEmail } = require("../lib/brevo.js");
const { BREVO_API_URL, EnvironmentConfigError } = require("../lib/config.js");
const { ENVIRONMENT_NOTICE } = require("../lib/emailPolicy.js");
const { logger } = require("firebase-functions");

// La politica email si legge da process.env a ogni invio: ogni test parte da un
// ambiente pulito, imposta solo cio' che dichiara e ripristina tutto alla fine.
const ENV_KEYS = [
  "GCLOUD_PROJECT",
  "GOOGLE_CLOUD_PROJECT",
  "FIREBASE_CONFIG",
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

/**
 * Esegue `fn` con env, fetch e logger sostituiti. `fn` riceve `calls` (le
 * richieste fatte a fetch) e `logs` (le chiamate a logger.info).
 */
async function withEnvironment(vars, fn, { response } = {}) {
  const savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  Object.assign(process.env, vars);

  const savedFetch = globalThis.fetch;
  const savedInfo = logger.info;
  const calls = [];
  const logs = [];

  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : undefined });
    return (
      response ?? {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ messageId: "<messaggio-finto@brevo>" }),
        text: async () => "",
      }
    );
  };
  logger.info = (...args) => {
    logs.push(args);
  };

  try {
    return await fn({ calls, logs });
  } finally {
    globalThis.fetch = savedFetch;
    logger.info = savedInfo;
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  }
}

const pdfBuffer = Buffer.from("%PDF-1.4 finto");

const signedCopyArgs = (overrides = {}) => ({
  apiKey: "chiave-finta",
  parentEmail: PARENT,
  parentName: "Genitore Esempio",
  participantName: "Mario Rossi",
  activityTitle: "Campo estivo",
  pdfBuffer,
  pdfFilename: "modulo.pdf",
  ...overrides,
});

const authorizationArgs = (overrides = {}) => ({
  apiKey: "chiave-finta",
  parentEmail: PARENT,
  parentName: "Genitore Esempio",
  participantName: "Mario Rossi",
  activityTitle: "Campo estivo",
  activityStartDate: "2026-07-10",
  activityEndDate: "2026-07-14",
  activityLocation: "Roma",
  authorizationUrl: "https://example.invalid/autorizza/abc",
  expiresAt: "2026-07-01T12:00:00Z",
  ...overrides,
});

const SENDERS = [
  {
    name: "sendSignedAuthorizationCopyEmail",
    send: sendSignedAuthorizationCopyEmail,
    args: signedCopyArgs,
    subject: "Modulo firmato - Campo estivo",
    hasSupportBcc: true,
  },
  {
    name: "sendParentAuthorizationEmail",
    send: sendParentAuthorizationEmail,
    args: authorizationArgs,
    subject: "Autorizzazione richiesta per Campo estivo",
    hasSupportBcc: false,
  },
];

const emails = (list) => (list ?? []).map((recipient) => recipient.email);

// ---------------------------------------------------------------------------
// Produzione: comportamento di sempre
// ---------------------------------------------------------------------------

for (const { name, send, args, subject, hasSupportBcc } of SENDERS) {
  test(`${name}: in produzione la mail parte una volta, senza prefisso ne' avviso`, async () => {
    await withEnvironment(PRODUCTION, async ({ calls }) => {
      const result = await send(args());

      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, BREVO_API_URL);
      assert.equal(calls[0].init.method, "POST");
      assert.equal(calls[0].init.headers["api-key"], "chiave-finta");

      const body = calls[0].body;
      assert.deepEqual(body.to, [{ email: PARENT, name: "Genitore Esempio" }]);
      assert.equal(body.subject, subject);
      assert.ok(!body.htmlContent.includes(ENVIRONMENT_NOTICE));
      assert.ok(!body.textContent.includes(ENVIRONMENT_NOTICE));
      assert.equal(body.sender.email, "noreply@gugditalia.it");
      assert.equal(body.replyTo.email, SUPPORT);

      if (hasSupportBcc) {
        assert.deepEqual(emails(body.bcc), [SUPPORT]);
      } else {
        assert.equal(body.bcc, undefined);
      }

      assert.equal(result.provider, "brevo");
      assert.equal(result.simulated, false);
      assert.equal(result.messageId, "<messaggio-finto@brevo>");
    });
  });

  test(`${name}: in produzione EMAIL_ALLOWLIST e EMAIL_SUBJECT_PREFIX dell'env non hanno effetto`, async () => {
    await withEnvironment(
      {
        ...PRODUCTION,
        EMAIL_ALLOWLIST: "qualcun-altro@example.invalid",
        EMAIL_SUBJECT_PREFIX: "[DEMO]",
        APP_PUBLIC_URL: "https://staging.example.com",
      },
      async ({ calls }) => {
        const result = await send(args());

        assert.equal(calls.length, 1);
        assert.deepEqual(emails(calls[0].body.to), [PARENT]);
        assert.equal(calls[0].body.subject, subject);
        assert.ok(!calls[0].body.htmlContent.includes(ENVIRONMENT_NOTICE));
        if (hasSupportBcc) assert.deepEqual(emails(calls[0].body.bcc), [SUPPORT]);
        assert.equal(result.simulated, false);
      },
    );
  });

  test(`${name}: in produzione senza apiKey lancia BrevoError e non chiama la rete`, async () => {
    await withEnvironment(PRODUCTION, async ({ calls }) => {
      for (const apiKey of [undefined, ""]) {
        await assert.rejects(() => send(args({ apiKey })), BrevoError);
      }
      assert.equal(calls.length, 0);
    });
  });

  test(`${name}: una risposta non ok di Brevo resta un BrevoError con lo status`, async () => {
    await withEnvironment(
      PRODUCTION,
      async ({ calls }) => {
        await assert.rejects(
          () => send(args()),
          (error) => error instanceof BrevoError && error.statusCode === 400,
        );
        assert.equal(calls.length, 1);
      },
      {
        response: {
          ok: false,
          status: 400,
          statusText: "Bad Request",
          json: async () => ({}),
          text: async () => "richiesta non valida",
        },
      },
    );
  });
}

test("sendSignedAuthorizationCopyEmail: in produzione il BCC al supporto non c'e' se il genitore E' il supporto", async () => {
  await withEnvironment(PRODUCTION, async ({ calls }) => {
    await sendSignedAuthorizationCopyEmail(signedCopyArgs({ parentEmail: SUPPORT }));

    assert.equal(calls.length, 1);
    assert.deepEqual(emails(calls[0].body.to), [SUPPORT]);
    assert.deepEqual(emails(calls[0].body.bcc), []);
  });
});

test("sendSignedAuthorizationCopyEmail: in produzione gli allegati partono come prima", async () => {
  await withEnvironment(PRODUCTION, async ({ calls }) => {
    const conduct = Buffer.from("%PDF-1.4 condotta");
    await sendSignedAuthorizationCopyEmail(
      signedCopyArgs({ conductPdfBuffer: conduct, conductPdfFilename: "condotta.pdf" }),
    );

    assert.deepEqual(calls[0].body.attachment, [
      { name: "modulo.pdf", content: pdfBuffer.toString("base64") },
      { name: "condotta.pdf", content: conduct.toString("base64") },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Fuori produzione: allowlist vuota o assente, niente esce
// ---------------------------------------------------------------------------

for (const { name, send, args } of SENDERS) {
  for (const [label, vars] of [
    ["EMAIL_ALLOWLIST assente", STAGING],
    ["EMAIL_ALLOWLIST vuota", { ...STAGING, EMAIL_ALLOWLIST: "" }],
    ["EMAIL_ALLOWLIST di soli separatori", { ...STAGING, EMAIL_ALLOWLIST: " , ; " }],
  ]) {
    test(`${name}: fuori produzione con ${label} la mail e' simulata e fetch non parte`, async () => {
      await withEnvironment(vars, async ({ calls }) => {
        const result = await send(args());
        assert.equal(result.simulated, true);
        assert.equal(calls.length, 0);
      });
    });
  }

  test(`${name}: una mail simulata non richiede la BREVO_API_KEY`, async () => {
    await withEnvironment(STAGING, async ({ calls }) => {
      for (const apiKey of [undefined, "", null]) {
        const result = await send(args({ apiKey }));
        assert.equal(result.simulated, true);
      }
      assert.equal(calls.length, 0);
    });
  });

  test(`${name}: il log di una mail simulata non contiene l'indirizzo intero`, async () => {
    await withEnvironment(STAGING, async ({ logs }) => {
      await send(args({ parentEmail: "zxqwv.genitore@example.invalid" }));
      assert.ok(logs.length > 0);
      const logged = JSON.stringify(logs);
      assert.ok(!logged.includes("zxqwv.genitore"), logged);
    });
  });

  test(`${name}: fuori produzione con il genitore fuori allowlist la mail e' simulata`, async () => {
    await withEnvironment({ ...STAGING, EMAIL_ALLOWLIST: "qualcun-altro@example.invalid" }, async ({ calls }) => {
      const result = await send(args());
      assert.equal(result.simulated, true);
      assert.equal(calls.length, 0);
    });
  });

  test(`${name}: un indirizzo con +tag non e' coperto dalla voce senza tag`, async () => {
    await withEnvironment({ ...STAGING, EMAIL_ALLOWLIST: PARENT }, async ({ calls }) => {
      const result = await send(args({ parentEmail: "genitore+iscritto@example.invalid" }));
      assert.equal(result.simulated, true);
      assert.equal(calls.length, 0);
    });
  });
}

test("sendSignedAuthorizationCopyEmail: con il solo BCC in allowlist non esce niente", async () => {
  await withEnvironment({ ...STAGING, EMAIL_ALLOWLIST: SUPPORT }, async ({ calls }) => {
    const result = await sendSignedAuthorizationCopyEmail(signedCopyArgs());
    assert.equal(result.simulated, true);
    assert.equal(calls.length, 0);
  });
});

test("sendSignedAuthorizationCopyEmail: con il dominio del solo BCC in allowlist non esce niente", async () => {
  await withEnvironment({ ...STAGING, EMAIL_ALLOWLIST: "@gugditalia.it" }, async ({ calls }) => {
    const result = await sendSignedAuthorizationCopyEmail(signedCopyArgs());
    assert.equal(result.simulated, true);
    assert.equal(calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Fuori produzione: genitore in allowlist
// ---------------------------------------------------------------------------

for (const { name, send, args, subject } of SENDERS) {
  test(`${name}: genitore in allowlist, la mail parte marcata come prova`, async () => {
    await withEnvironment({ ...STAGING, EMAIL_ALLOWLIST: PARENT }, async ({ calls }) => {
      const result = await send(args());

      assert.equal(calls.length, 1);
      const body = calls[0].body;
      assert.deepEqual(emails(body.to), [PARENT]);
      assert.equal(body.subject, `[TEST] ${subject}`);
      assert.ok(body.htmlContent.includes(ENVIRONMENT_NOTICE));
      assert.ok(body.textContent.includes(ENVIRONMENT_NOTICE));
      assert.equal(result.provider, "brevo");
      assert.equal(result.simulated, false);
    });
  });

  test(`${name}: il prefisso oggetto segue EMAIL_SUBJECT_PREFIX`, async () => {
    await withEnvironment(
      { ...STAGING, EMAIL_ALLOWLIST: PARENT, EMAIL_SUBJECT_PREFIX: "[DEMO]" },
      async ({ calls }) => {
        await send(args());
        assert.equal(calls[0].body.subject, `[DEMO] ${subject}`);
        assert.ok(calls[0].body.htmlContent.includes(ENVIRONMENT_NOTICE));
      },
    );
  });

  test(`${name}: il genitore puo' essere ammesso con la voce @dominio`, async () => {
    await withEnvironment({ ...STAGING, EMAIL_ALLOWLIST: "@example.invalid" }, async ({ calls }) => {
      const result = await send(args());
      assert.equal(calls.length, 1);
      assert.deepEqual(emails(calls[0].body.to), [PARENT]);
      assert.equal(result.simulated, false);
    });
  });

  test(`${name}: genitore in allowlist ma senza apiKey lancia BrevoError`, async () => {
    await withEnvironment({ ...STAGING, EMAIL_ALLOWLIST: PARENT }, async ({ calls }) => {
      for (const apiKey of [undefined, ""]) {
        await assert.rejects(() => send(args({ apiKey })), BrevoError);
      }
      assert.equal(calls.length, 0);
    });
  });

  test(`${name}: gli override di mittente e reply-to arrivano nella mail`, async () => {
    await withEnvironment(
      {
        ...STAGING,
        EMAIL_ALLOWLIST: PARENT,
        EMAIL_SENDER_ADDRESS: "invio@staging.example.invalid",
        EMAIL_REPLY_TO_ADDRESS: "risposte@staging.example.invalid",
      },
      async ({ calls }) => {
        await send(args());
        assert.equal(calls[0].body.sender.email, "invio@staging.example.invalid");
        assert.equal(calls[0].body.replyTo.email, "risposte@staging.example.invalid");
      },
    );
  });
}

test("sendSignedAuthorizationCopyEmail: fuori produzione il BCC al supporto cade se non e' in allowlist", async () => {
  await withEnvironment({ ...STAGING, EMAIL_ALLOWLIST: PARENT }, async ({ calls }) => {
    await sendSignedAuthorizationCopyEmail(signedCopyArgs());

    assert.equal(calls.length, 1);
    const body = calls[0].body;
    assert.deepEqual(emails(body.to), [PARENT]);
    assert.ok(!emails(body.bcc).includes(SUPPORT), "il supporto non e' in allowlist e non deve ricevere la copia");
    assert.deepEqual(emails(body.bcc), []);
    // Il resto della mail e' intatto.
    assert.equal(body.attachment.length, 1);
    assert.equal(body.attachment[0].name, "modulo.pdf");
  });
});

test("sendSignedAuthorizationCopyEmail: se anche il supporto e' in allowlist il BCC resta", async () => {
  await withEnvironment({ ...STAGING, EMAIL_ALLOWLIST: `${PARENT}, ${SUPPORT}` }, async ({ calls }) => {
    await sendSignedAuthorizationCopyEmail(signedCopyArgs());

    assert.equal(calls.length, 1);
    assert.deepEqual(emails(calls[0].body.to), [PARENT]);
    assert.deepEqual(emails(calls[0].body.bcc), [SUPPORT]);
  });
});

test("sendSignedAuthorizationCopyEmail: il BCC resta anche con l'intero dominio del supporto in allowlist", async () => {
  await withEnvironment({ ...STAGING, EMAIL_ALLOWLIST: `${PARENT}, @gugditalia.it` }, async ({ calls }) => {
    await sendSignedAuthorizationCopyEmail(signedCopyArgs());
    assert.deepEqual(emails(calls[0].body.bcc), [SUPPORT]);
  });
});

test("sendParentAuthorizationEmail: fuori produzione il link del genitore e' nel corpo, nessun BCC", async () => {
  await withEnvironment({ ...STAGING, EMAIL_ALLOWLIST: PARENT }, async ({ calls }) => {
    await sendParentAuthorizationEmail(authorizationArgs());
    const body = calls[0].body;
    assert.ok(body.htmlContent.includes("https://example.invalid/autorizza/abc"));
    assert.ok(body.textContent.includes("https://example.invalid/autorizza/abc"));
    assert.equal(body.bcc, undefined);
  });
});

// ---------------------------------------------------------------------------
// Progetto sconosciuto: si ferma, non si ripiega su nulla
// ---------------------------------------------------------------------------

for (const { name, send, args } of SENDERS) {
  test(`${name}: senza progetto determinabile lancia EnvironmentConfigError e non chiama la rete`, async () => {
    await withEnvironment({}, async ({ calls }) => {
      await assert.rejects(() => send(args()), (error) => error instanceof EnvironmentConfigError);
      assert.equal(calls.length, 0);
    });
  });

  test(`${name}: nemmeno con allowlist e URL presenti si indovina l'ambiente`, async () => {
    await withEnvironment(
      { EMAIL_ALLOWLIST: PARENT, APP_PUBLIC_URL: "https://staging.example.com" },
      async ({ calls }) => {
        await assert.rejects(() => send(args()), (error) => error instanceof EnvironmentConfigError);
        assert.equal(calls.length, 0);
      },
    );
  });

  test(`${name}: FIREBASE_CONFIG illeggibile e' come progetto sconosciuto`, async () => {
    await withEnvironment({ FIREBASE_CONFIG: "{non e' json" }, async ({ calls }) => {
      await assert.rejects(() => send(args()), (error) => error instanceof EnvironmentConfigError);
      assert.equal(calls.length, 0);
    });
  });
}

test("il progetto si puo' leggere anche da FIREBASE_CONFIG", async () => {
  await withEnvironment(
    { FIREBASE_CONFIG: JSON.stringify({ projectId: "giovani-palo" }) },
    async ({ calls }) => {
      const result = await sendParentAuthorizationEmail(authorizationArgs());
      assert.equal(result.simulated, false);
      assert.equal(calls.length, 1);
      assert.ok(!calls[0].body.subject.startsWith("["));
    },
  );
});

// ---------------------------------------------------------------------------
// Il parentEmail arriva dal client: un solo indirizzo, normalizzato
// ---------------------------------------------------------------------------

const MULTI_ADDRESS_PARENTS = [
  "victim@gmail.com,x@gugditalia.it",
  "victim@gmail.com x@gugditalia.it",
  "victim@gmail.com<x@gugditalia.it",
  '"victim@gmail.com"@gugditalia.it',
  "victim@gmail.com;x@gugditalia.it",
  "victim@gmail.com\r\nBcc: x@gugditalia.it",
  "victim@gmail.com@gugditalia.it",
  "a@gugditalia.it;b@gmail.com",
  "Name <x@gugditalia.it>",
];

for (const { name, send, args } of SENDERS) {
  test(`${name}: un parentEmail con piu' indirizzi non supera una voce @dominio, niente parte (regressione)`, async () => {
    await withEnvironment({ ...STAGING, EMAIL_ALLOWLIST: "@gugditalia.it" }, async ({ calls }) => {
      for (const parentEmail of MULTI_ADDRESS_PARENTS) {
        const result = await send(args({ parentEmail }));
        assert.equal(result.simulated, true, JSON.stringify(parentEmail));
      }
      assert.equal(calls.length, 0);
    });
  });

  test(`${name}: un parentEmail con piu' indirizzi non supera nemmeno una voce esatta`, async () => {
    await withEnvironment({ ...STAGING, EMAIL_ALLOWLIST: "x@gugditalia.it, victim@gmail.com" }, async ({ calls }) => {
      for (const parentEmail of MULTI_ADDRESS_PARENTS) {
        const result = await send(args({ parentEmail }));
        assert.equal(result.simulated, true, JSON.stringify(parentEmail));
      }
      assert.equal(calls.length, 0);
    });
  });

  test(`${name}: il parentEmail ammesso, con spazi e maiuscole, arriva a Brevo normalizzato (regressione)`, async () => {
    await withEnvironment({ ...STAGING, EMAIL_ALLOWLIST: "genitore@example.invalid" }, async ({ calls }) => {
      const result = await send(args({ parentEmail: "  Genitore@Example.INVALID  " }));

      assert.equal(result.simulated, false);
      assert.equal(calls.length, 1);
      const body = calls[0].body;
      assert.equal(body.to.length, 1);
      assert.equal(body.to[0].email, "genitore@example.invalid");
      assert.ok(!JSON.stringify(body.to.map((recipient) => recipient.email)).includes("Genitore@"));
    });
  });

  test(`${name}: con una voce @dominio il parentEmail in maiuscolo parte normalizzato`, async () => {
    await withEnvironment({ ...STAGING, EMAIL_ALLOWLIST: "@example.invalid" }, async ({ calls }) => {
      await send(args({ parentEmail: "GENITORE@EXAMPLE.INVALID" }));
      assert.equal(calls.length, 1);
      assert.deepEqual(emails(calls[0].body.to), ["genitore@example.invalid"]);
    });
  });

  test(`${name}: in produzione il parentEmail parte come arriva, senza normalizzazione`, async () => {
    await withEnvironment(PRODUCTION, async ({ calls }) => {
      await send(args({ parentEmail: "Genitore@Example.invalid" }));
      assert.equal(calls.length, 1);
      assert.deepEqual(emails(calls[0].body.to), ["Genitore@Example.invalid"]);
    });
  });
}

test("sendSignedAuthorizationCopyEmail: anche il BCC ammesso parte normalizzato", async () => {
  await withEnvironment(
    { ...STAGING, EMAIL_ALLOWLIST: "genitore@example.invalid, SUPPORTO@Gugditalia.IT" },
    async ({ calls }) => {
      await sendSignedAuthorizationCopyEmail(signedCopyArgs());
      assert.equal(calls.length, 1);
      assert.deepEqual(emails(calls[0].body.to), ["genitore@example.invalid"]);
      assert.deepEqual(emails(calls[0].body.bcc), ["supporto@gugditalia.it"]);
    },
  );
});

// ---------------------------------------------------------------------------
// Il corpo per Brevo contiene solo i campi che il modulo costruisce
// ---------------------------------------------------------------------------

const keysOf = (body) => Object.keys(body).sort();

const KEYS_PARENT_AUTHORIZATION = ["headers", "htmlContent", "replyTo", "sender", "subject", "tags", "textContent", "to"];
const KEYS_SIGNED_COPY_WITH_BCC = [
  "attachment",
  "bcc",
  "headers",
  "htmlContent",
  "replyTo",
  "sender",
  "subject",
  "tags",
  "textContent",
  "to",
];
const KEYS_SIGNED_COPY_NO_BCC = KEYS_SIGNED_COPY_WITH_BCC.filter((key) => key !== "bcc");

test("corpo Brevo, produzione: l'insieme esatto dei campi per entrambe le funzioni", async () => {
  await withEnvironment(PRODUCTION, async ({ calls }) => {
    await sendParentAuthorizationEmail(authorizationArgs());
    await sendSignedAuthorizationCopyEmail(signedCopyArgs());
    await sendSignedAuthorizationCopyEmail(signedCopyArgs({ parentEmail: SUPPORT }));

    assert.deepEqual(keysOf(calls[0].body), KEYS_PARENT_AUTHORIZATION);
    assert.deepEqual(keysOf(calls[1].body), KEYS_SIGNED_COPY_WITH_BCC);
    assert.deepEqual(keysOf(calls[2].body), KEYS_SIGNED_COPY_NO_BCC);
  });
});

test("corpo Brevo, non produzione: l'insieme esatto dei campi per entrambe le funzioni", async () => {
  await withEnvironment({ ...STAGING, EMAIL_ALLOWLIST: PARENT }, async ({ calls }) => {
    await sendParentAuthorizationEmail(authorizationArgs());
    await sendSignedAuthorizationCopyEmail(signedCopyArgs());
    assert.deepEqual(keysOf(calls[0].body), KEYS_PARENT_AUTHORIZATION);
    assert.deepEqual(keysOf(calls[1].body), KEYS_SIGNED_COPY_NO_BCC);
  });

  await withEnvironment({ ...STAGING, EMAIL_ALLOWLIST: `${PARENT}, ${SUPPORT}` }, async ({ calls }) => {
    await sendSignedAuthorizationCopyEmail(signedCopyArgs());
    assert.deepEqual(keysOf(calls[0].body), KEYS_SIGNED_COPY_WITH_BCC);
  });
});

// L'unico modo di avere campi in piu' nel payload passando dalle funzioni
// pubbliche e' un passaggio intermedio che li aggiunge (come potrebbe fare una
// modifica futura): si carica una copia di brevo.js il cui decorateMessage
// restituisce chiavi extra, e si controlla che non arrivino a fetch.
const brevoPath = require.resolve("../lib/brevo.js");
const emailPolicyModule = require("../lib/emailPolicy.js");

function loadBrevoWithExtraPayloadKeys(extraKeys) {
  const original = emailPolicyModule.decorateMessage;
  emailPolicyModule.decorateMessage = (...args) => ({ ...original(...args), ...extraKeys });
  delete require.cache[brevoPath];
  try {
    return require("../lib/brevo.js");
  } finally {
    emailPolicyModule.decorateMessage = original;
    delete require.cache[brevoPath];
  }
}

const EXTRA_PAYLOAD_KEYS = {
  cc: [{ email: "victim@gmail.com" }],
  messageVersions: [{ to: [{ email: "victim@gmail.com" }] }],
  templateId: 7,
  params: { a: 1 },
  scheduledAt: "2030-01-01T00:00:00Z",
  batchId: "lotto-1",
};

test("corpo Brevo: chiavi extra nel payload (cc, messageVersions...) non arrivano a fetch (regressione)", async () => {
  const brevo = loadBrevoWithExtraPayloadKeys(EXTRA_PAYLOAD_KEYS);

  // La copia caricata e' davvero un'altra istanza di brevo.js.
  assert.notEqual(brevo.sendParentAuthorizationEmail, sendParentAuthorizationEmail);

  await withEnvironment(PRODUCTION, async ({ calls }) => {
    await brevo.sendParentAuthorizationEmail(authorizationArgs());
    await brevo.sendSignedAuthorizationCopyEmail(signedCopyArgs());
    assert.deepEqual(keysOf(calls[0].body), KEYS_PARENT_AUTHORIZATION);
    assert.deepEqual(keysOf(calls[1].body), KEYS_SIGNED_COPY_WITH_BCC);
  });

  await withEnvironment({ ...STAGING, EMAIL_ALLOWLIST: PARENT }, async ({ calls }) => {
    await brevo.sendParentAuthorizationEmail(authorizationArgs());
    await brevo.sendSignedAuthorizationCopyEmail(signedCopyArgs());
    assert.deepEqual(keysOf(calls[0].body), KEYS_PARENT_AUTHORIZATION);
    assert.deepEqual(keysOf(calls[1].body), KEYS_SIGNED_COPY_NO_BCC);
    for (const call of calls) {
      assert.ok(!JSON.stringify(call.body).includes("victim@gmail.com"));
    }
  });
});

test("corpo Brevo: una copia con chiavi extra non lascia tracce nella copia originale del modulo", async () => {
  loadBrevoWithExtraPayloadKeys(EXTRA_PAYLOAD_KEYS);

  await withEnvironment(PRODUCTION, async ({ calls }) => {
    await sendParentAuthorizationEmail(authorizationArgs());
    assert.deepEqual(keysOf(calls[0].body), KEYS_PARENT_AUTHORIZATION);
  });
  assert.equal(typeof emailPolicyModule.decorateMessage, "function");
  assert.deepEqual(
    Object.keys(emailPolicyModule.decorateMessage({ isProduction: true }, { subject: "s", htmlContent: "h", textContent: "t" })),
    ["subject", "htmlContent", "textContent"],
  );
});
