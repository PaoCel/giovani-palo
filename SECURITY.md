# Security & Privacy

GUGD Italia processes personal data, including data of minors. The platform is operated by Paolo Celestini (sole maintainer).

## Reporting a vulnerability

Please email **privacy@gugditalia.it**. Disclosure is welcomed and will be credited if the reporter wishes. Acknowledgement target: 3 business days. Remediation timeline: 14 days.

## Data handling at a glance

| Item | Status |
|---|---|
| Database region | Cloud Firestore, EU multi-region `eur3` (Belgium + Netherlands) |
| File storage region | New Cloud Storage bucket `giovani-palo-eu`, `europe-west1` (Belgium): signed PDFs, signatures, parent documents, gallery media. During migration, copies remain in `giovani-palo.firebasestorage.app`, `us-central1` (US), also used by older app versions; removal follows verification that the old bucket is no longer used |
| Server region | Cloud Functions, `europe-west1` (Belgium) |
| Authentication | Firebase Authentication, run by Google only from US data centers (no EU option); admin Google account uses MFA |
| Authorization | Firestore Security Rules + Storage Security Rules — default deny, RBAC, key-allow-listed write payloads |
| Sub-processors | Google LLC (Firebase, Google Cloud; Hosting served through a global CDN); Brevo / Sendinblue SAS (transactional email incl. the signed consent PDF, data hosted in the EU); browser push services (end-to-end encrypted payloads). Transfers outside the EU under SCCs, plus the EU-US Data Privacy Framework for Google |
| Cookies / trackers | Technical session only; no analytics, no advertising, no profiling |
| Privacy notice | Live at https://gugditalia.it/privacy |

## Governance documentation

A full security and privacy review of this codebase exists separately (audit findings, light DPIA, audit-log design, mapping to the *Principles for Church Use of Artificial Intelligence*). It was produced in April 2026 and lives outside this repository to keep concerns separate.

If you are reviewing this repository as part of a recruiting or partnership conversation and want to read the governance pack, contact privacy@gugditalia.it.

## Public Firebase identifiers

`src/services/firebase/config.ts` and the VAPID public key in `functions/index.js` contain Firebase project identifiers (web API key, app ID, sender ID, public push key). These values are public by design — they identify the Firebase project to the SDK and **do not authenticate** the caller. Authorization is enforced server-side by Firestore Rules and Storage Rules. See [Firebase docs](https://firebase.google.com/docs/projects/api-keys) for context.

The Web Push **private** key is held as a Firebase secret (`WEB_PUSH_PRIVATE_KEY`), referenced via `firebase-functions/params.defineSecret`, and never appears in the source tree.

## Last reviewed

2026-10-26. Bucket regions verified through the platform APIs. EU preparation is complete; the app cutover requires a separate coordinated release. US copies remain until the separately approved cleanup.
