import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from "@firebase/rules-unit-testing";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rulesPath = path.join(__dirname, "..", "..", "firestore.rules");

let testEnv;

before(async () => {
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
  const [host, portRaw] = emulatorHost.split(":");
  const port = Number(portRaw) || 8080;

  testEnv = await initializeTestEnvironment({
    projectId: "luma-events-test",
    firestore: {
      rules: fs.readFileSync(rulesPath, "utf8"),
      host,
      port
    }
  });
});

after(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

test("signed-in users can read system settings", async () => {
  const db = testEnv.authenticatedContext("user-1").firestore();
  await assertSucceeds(db.doc("systemSettings/production").get());
});

test("unauthenticated users cannot read system settings", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(db.doc("systemSettings/production").get());
});

test("only admins can write system settings", async () => {
  const adminUid = "admin-1";
  const userUid = "user-2";

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc(`lumaAdmins/${adminUid}`).set({ role: "super_admin" });
  });

  const adminDb = testEnv.authenticatedContext(adminUid).firestore();
  const userDb = testEnv.authenticatedContext(userUid).firestore();

  await assertSucceeds(
    adminDb.doc("systemSettings/production").set({ maintenanceMode: true })
  );
  await assertFails(
    userDb.doc("systemSettings/production").set({ maintenanceMode: true })
  );
});

test("signed-in users can create orders", async () => {
  const db = testEnv.authenticatedContext("order-user").firestore();
  await assertSucceeds(
    db.doc("events/event-9/orders/order-1").set({ total: 100 })
  );
});

test("unauthenticated users cannot create orders", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(
    db.doc("events/event-9/orders/order-2").set({ total: 100 })
  );
});

test("event owners can update vendor status", async () => {
  const ownerUid = "owner-1";

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc("events/event-1").set({ ownerUserId: ownerUid });
    await context.firestore().doc("events/event-1/vendors/vendor-1").set({ status: "pending" });
  });

  const ownerDb = testEnv.authenticatedContext(ownerUid).firestore();
  await assertSucceeds(
    ownerDb.doc("events/event-1/vendors/vendor-1").update({ status: "approved" })
  );
});

test("non-owners cannot update vendor status", async () => {
  const ownerUid = "owner-2";
  const otherUid = "user-4";

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc("events/event-2").set({ ownerUserId: ownerUid });
    await context.firestore().doc("events/event-2/vendors/vendor-2").set({ status: "pending" });
  });

  const otherDb = testEnv.authenticatedContext(otherUid).firestore();
  await assertFails(
    otherDb.doc("events/event-2/vendors/vendor-2").update({ status: "approved" })
  );
});
