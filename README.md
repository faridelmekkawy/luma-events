# Luma Events

Full-stack layout with static front-end assets in `public/` and an Express + Firebase Admin backend in `server/`.

## Structure
- `public/` — static client HTML
- `server/` — Express API + Firebase Admin SDK

## Prerequisites
- Node.js 18+
- Firebase project with Firestore and Auth enabled
- A Firebase Admin service account JSON

## Environment
Create `server/.env` using `server/.env.example`:

```
FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"..."}'
PORT=8080
CORS_ORIGINS=http://localhost:8080
LOG_LEVEL=info
```

## Run locally
```
cd server
npm install
npm run start
```

## Run security rules tests
```
cd server
npm run test
```
This uses the Firestore emulator via `firebase emulators:exec` and requires the Firebase CLI (included as a dev dependency).

The server serves the client from `public/` and exposes:
- `GET /healthz`
- `GET /api/system-settings` (requires Firebase Auth ID token)
- `PUT /api/system-settings` (super admin)
- `GET /api/admin/overview` (super admin)
- `PUT /api/admin/event-status` (super admin)
- `PUT /api/admin/vendor-status` (super admin)

## Authentication & authorization
Admin APIs require a Firebase Auth ID token in the `Authorization` header:

```
Authorization: Bearer <ID_TOKEN>
```

Admins are identified by a Firestore document at `lumaAdmins/{uid}` with:

```
{ "role": "super_admin" }
```

## Production deployment
1. Provision a Node.js runtime (container, VM, or managed service).
2. Set the `FIREBASE_SERVICE_ACCOUNT_JSON` environment variable.
3. Configure HTTPS and a reverse proxy (NGINX, Cloud Run, etc.).
4. Set Firestore security rules (see `firestore.rules`).
5. Configure CORS and rate limits via environment variables.
6. Enable logging and alerts (e.g., Cloud Logging + Error Reporting).

## CI/CD (recommended)
- Run `npm ci` and `npm run test` in a pipeline.
- Deploy via container build or platform-native deploy.

## Firestore rules
See `firestore.rules` for a baseline starting point. You must validate and test rules before production.
