# Security & Privacy

GUGD Italia processes personal data, including data of minors. The platform is operated by Paolo Celestini (sole maintainer).

## Reporting a vulnerability

Please email **privacy@gugditalia.it**. Disclosure is welcomed and will be credited if the reporter wishes. Acknowledgement target: 3 business days. Remediation timeline: 14 days.

## Data handling at a glance

| Item | Status |
|---|---|
| Storage region | EU multi-region (`eur3`: Belgium + Netherlands), Cloud Firestore + Cloud Storage |
| Authentication | Firebase Authentication; admin Google account uses MFA |
| Authorization | Firestore Security Rules + Storage Security Rules — default deny, RBAC, key-allow-listed write payloads |
| Sub-processors | Google (Firebase) only; SCCs in place via Google Cloud DPA |
| Cookies / trackers | Technical session only; no analytics, no advertising, no profiling |
| Privacy notice | Live at https://gugditalia.it/privacy |

## Governance documentation

A full security and privacy review of this codebase exists separately (audit findings, light DPIA, audit-log design, mapping to the *Principles for Church Use of Artificial Intelligence*). It was produced in April 2026 and lives outside this repository to keep concerns separate.

If you are reviewing this repository as part of a recruiting or partnership conversation and want to read the governance pack, contact privacy@gugditalia.it.

## Public Firebase identifiers

`src/services/firebase/config.ts` and the VAPID public key in `functions/index.js` contain Firebase project identifiers (web API key, app ID, sender ID, public push key). These values are public by design — they identify the Firebase project to the SDK and **do not authenticate** the caller. Authorization is enforced server-side by Firestore Rules and Storage Rules. See [Firebase docs](https://firebase.google.com/docs/projects/api-keys) for context.

The Web Push **private** key is held as a Firebase secret (`WEB_PUSH_PRIVATE_KEY`), referenced via `firebase-functions/params.defineSecret`, and never appears in the source tree.

## Last reviewed

2026-04-27.
