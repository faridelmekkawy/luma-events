import admin from "firebase-admin";

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }
  return null;
}

if (!admin.apps.length) {
  const serviceAccount = loadServiceAccount();
  if (!serviceAccount) {
    throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON for Firebase Admin SDK.");
  }
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

export const db = admin.firestore();
export default admin;
