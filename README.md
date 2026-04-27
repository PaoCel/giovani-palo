# GUGD Italia — `giovani-palo`

End-to-end coordination platform for a non-profit youth-organization stake. Live at **[gugditalia.it](https://gugditalia.it)**.

100+ active accounts across admins, local unit leaders, and end users. Activity registration, hierarchical role-based access, parental-consent capture for minors, leader visibility, usage statistics, multi-stake scalability.

Built solo by [Paolo Celestini](https://celestini.eu).

---

## Why this repo is public

This codebase is published as a portfolio piece. It is read-only for casual visitors: the live deployment serves a real community at gugditalia.it, and changes go through the maintainer. If you want to discuss reuse, please open an issue.

## Tech stack

| Layer | Component |
|---|---|
| Frontend | Vite 7 + React 19 + TypeScript + react-router-dom 7 |
| Auth | Firebase Authentication (email/password, Google, anonymous-guest) |
| Database | Cloud Firestore (region `eur3`, Belgium + Netherlands) |
| File storage | Firebase Storage (parental-consent images, public banners) |
| Backend | Firebase Cloud Functions v2 (Node 22), region `europe-west1` |
| Hosting | Firebase Hosting + PWA (service worker, web push notifications) |
| PDF / spreadsheet | jsPDF for recovery PDFs, xlsx for admin exports |

## Architecture at a glance

```
   Browser / installed PWA
            │
            │ HTTPS
            ▼
  Firebase Hosting (CDN)  ──►  static assets (Vite-bundled)
            │
            │ Firebase JS SDK
            ▼
  Firebase Authentication  ──►  identity (Google / email-password / anonymous)
            │
            ▼
  Cloud Firestore (eur3)
   ├── users/{uid}
   ├── stakes/{stakeId}/
   │     ├── units/{unitId}
   │     ├── activities/{activityId}/
   │     │     ├── config/form
   │     │     ├── formFields/{fieldId}
   │     │     ├── registrations/{registrationId}
   │     │     └── transportNotes/{noteId}
   │     ├── registrationAttempts/{attemptId}    (best-effort flow log)
   │     ├── adminAlerts/{alertId}
   │     └── adminPushDevices/{deviceId}
   ├── anonymousRegistrationTokens/{tokenId}     (guest recovery)
   ├── settings/organization                     (org-wide overrides)
   └── events/{eventId}                          (legacy; pre-`activities` migration)
            │
            ▼
  Cloud Storage
   ├── public/stakes/{stakeId}/...               (banners, public assets)
   └── protected/stakes/{stakeId}/activities/{activityId}/parent-consents/{regId}/...
            │
            ▼
  Cloud Functions (europe-west1)
   ├── propagateUnitNameChange      (Firestore-trigger)
   └── sendAdminPushForNewRegistration (Firestore-trigger + Web Push via VAPID)
```

## Roles

`super_admin` (cross-stake), `admin` (stake-level), `unit_leader` (single unit visibility), `participant` (own data only). Anonymous Firebase Auth users are constrained to public guest-registration paths.

Enforcement: see [`firestore.rules`](firestore.rules) and [`storage.rules`](storage.rules). Both default-deny, with type-checked, key-allow-listed write payloads.

## Repository layout

```
giovani-palo/
├── src/                          # React app
│   ├── app/                      # App shell, providers, routing
│   ├── components/               # UI components
│   ├── pages/                    # Route-level pages (admin/, me/, public/, auth/)
│   ├── layouts/                  # Layout shells (Shell, Admin, User, UnitLeader, Public)
│   ├── routes/                   # router + route guards
│   ├── services/
│   │   ├── auth/                 # Firebase Auth wrappers
│   │   ├── firebase/             # init + debug helpers + storage
│   │   ├── firestore/            # one service per top-level collection
│   │   └── push/                 # admin push subscription management
│   ├── hooks/                    # useAsyncData, useAuth
│   ├── types/                    # models, auth, indexed exports
│   ├── utils/                    # formatters, slug, profile, age, roles, ...
│   ├── config/                   # app-level constants + city options
│   └── styles/                   # base CSS
├── functions/                    # Cloud Functions (Node 22, JS, v2 SDK)
│   └── index.js
├── firestore.rules               # Firestore Security Rules
├── storage.rules                 # Storage Security Rules
├── firebase.json                 # Firebase project config
├── .firebaserc                   # Firebase project alias (giovani-palo)
├── public/                       # static PWA assets, manifest, sw bootstrap
├── package.json
├── tsconfig*.json
├── vite.config.ts
├── README.md
├── SECURITY.md
└── LICENSE
```

## Local development

Prerequisites: Node 22+, npm, Firebase CLI (`npm i -g firebase-tools`), an account with read access to the Firebase project (or your own clone of the project).

```bash
git clone https://github.com/paocel/giovani-palo.git
cd giovani-palo
npm install
npm run dev          # starts Vite dev server on http://localhost:5173
```

The app talks to the live Firebase project by default (`src/services/firebase/config.ts`). To use an emulator suite:

```bash
cd functions && npm install && cd ..
firebase emulators:start
```

## Build + deploy

```bash
npm run build                                  # tsc --noEmit + vite build → dist/
firebase deploy --only hosting                 # ship dist/ to Firebase Hosting
firebase deploy --only firestore:rules         # ship rules
firebase deploy --only functions               # ship Cloud Functions (Blaze plan)
```

## Privacy notice and security

- Public privacy notice: https://gugditalia.it/privacy (covers data collected, legal basis, retention, GDPR rights, sub-processors, EU residency).
- Maintainer / privacy contact: **privacy@gugditalia.it**.
- Operational support: **supporto@gugditalia.it**.
- See [`SECURITY.md`](SECURITY.md) for vulnerability disclosure.

A formal governance pack (audit findings, light DPIA, audit-log design, mapping to the *Principles for Church Use of Artificial Intelligence*) was produced in April 2026 and is available on request via the privacy contact.

## Author

[Paolo Celestini](https://celestini.eu) · paolo@celestini.eu · [LinkedIn](https://www.linkedin.com/in/paolo-celestini-186427103/)

## License

[MIT](LICENSE).
