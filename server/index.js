import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pino from "pino";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import admin, { db, FieldValue } from "./firebaseAdmin.js";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");

const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(helmet());
app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : true
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDir));
app.use(
  pinoHttp({
    logger
  })
);

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false
  })
);

function getAuthToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length);
  }
  return null;
}

async function requireAuth(req, res, next) {
  try {
    const token = getAuthToken(req);
    if (!token) {
      return res.status(401).json({ error: "Missing Authorization token" });
    }
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    return next();
  } catch (err) {
    console.error("Auth verification failed:", err);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

async function requireAdmin(req, res, next) {
  try {
    const { uid } = req.user || {};
    if (!uid) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const adminSnap = await db.doc(`lumaAdmins/${uid}`).get();
    const adminData = adminSnap.exists ? adminSnap.data() : null;
    const isSuperAdmin = adminData?.role === "super_admin" || adminData?.isSuperAdmin;
    if (!isSuperAdmin) {
      return res.status(403).json({ error: "Forbidden" });
    }
    req.adminProfile = adminData;
    return next();
  } catch (err) {
    console.error("Admin check failed:", err);
    return res.status(500).json({ error: "Failed to authorize admin" });
  }
}

async function logAdminAction({ action, actorUid, metadata }) {
  try {
    await db.collection("auditLogs").add({
      action,
      actorUid,
      metadata: metadata || {},
      createdAt: FieldValue.serverTimestamp()
    });
  } catch (err) {
    logger.error({ err }, "Failed to write audit log");
  }
}

app.get("/api/system-settings", requireAuth, async (_req, res) => {
  try {
    const snap = await db.doc("systemSettings/production").get();
    return res.json(snap.exists ? snap.data() : {});
  } catch (err) {
    logger.error({ err }, "Failed to fetch system settings");
    return res.status(500).json({ error: "Failed to fetch system settings" });
  }
});

app.put("/api/system-settings", requireAuth, requireAdmin, async (req, res) => {
  try {
    const payload = {
      maintenanceMode: !!req.body.maintenanceMode,
      maintenanceMessage: req.body.maintenanceMessage || "",
      ownerSignupDisabled: !!req.body.ownerSignupDisabled,
      brandSignupDisabled: !!req.body.brandSignupDisabled,
      vendorSignupDisabled: !!req.body.vendorSignupDisabled,
      posLoginDisabled: !!req.body.posLoginDisabled,
      updatedAt: new Date().toISOString()
    };
    await db.doc("systemSettings/production").set(payload, { merge: true });
    await logAdminAction({
      action: "system_settings_updated",
      actorUid: req.user.uid,
      metadata: payload
    });
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to update system settings");
    return res.status(500).json({ error: "Failed to update system settings" });
  }
});

app.get("/api/admin/overview", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [eventsSnap, vendorsSnap, ordersSnap] = await Promise.all([
      db.collection("events").get(),
      db.collectionGroup("vendors").get(),
      db.collectionGroup("orders").get()
    ]);

    let totalRevenue = 0;
    ordersSnap.forEach((doc) => {
      const data = doc.data();
      const total = Number(data.total) || 0;
      totalRevenue += data.isReturn ? -Math.abs(total) : total;
    });

    return res.json({
      totalEvents: eventsSnap.size,
      totalVendors: vendorsSnap.size,
      totalOrders: ordersSnap.size,
      totalRevenue
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch admin overview");
    return res.status(500).json({ error: "Failed to fetch admin overview" });
  }
});

app.put("/api/admin/event-status", requireAuth, requireAdmin, async (req, res) => {
  const { eventId, status } = req.body || {};
  const allowedStatuses = new Set(["active", "suspended"]);
  if (!eventId || !status) {
    return res.status(400).json({ error: "eventId and status are required" });
  }
  if (!allowedStatuses.has(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  try {
    await db.doc(`events/${eventId}`).update({ status });
    await logAdminAction({
      action: "event_status_updated",
      actorUid: req.user.uid,
      metadata: { eventId, status }
    });
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to update event status");
    return res.status(500).json({ error: "Failed to update event status" });
  }
});

app.put("/api/admin/vendor-status", requireAuth, requireAdmin, async (req, res) => {
  const { eventId, vendorId, status, rejectionReason } = req.body || {};
  const allowedStatuses = new Set(["pending", "approved", "rejected", "suspended"]);
  if (!eventId || !vendorId || !status) {
    return res.status(400).json({ error: "eventId, vendorId, and status are required" });
  }
  if (!allowedStatuses.has(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  try {
    const updates = { status };
    if (status === "rejected") {
      updates.rejectionReason = rejectionReason || "No reason provided";
    }
    const vendorRef = db.doc(`events/${eventId}/vendors/${vendorId}`);
    const vendorSnap = await vendorRef.get();
    if (!vendorSnap.exists) {
      return res.status(404).json({ error: "Vendor not found" });
    }
    await vendorRef.update(updates);

    const vendorData = vendorSnap.data();
    if (vendorData?.brandId) {
      let brandStatus = "active";
      if (status === "pending") brandStatus = "pending";
      if (status === "approved") brandStatus = "active";
      if (status === "suspended") brandStatus = "suspended";
      if (status === "rejected") brandStatus = "suspended";
      await db.doc(`brands/${vendorData.brandId}`).update({ status: brandStatus });
    }
    await logAdminAction({
      action: "vendor_status_updated",
      actorUid: req.user.uid,
      metadata: { eventId, vendorId, status, rejectionReason }
    });
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to update vendor status");
    return res.status(500).json({ error: "Failed to update vendor status" });
  }
});

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.use((err, _req, res, _next) => {
  logger.error({ err }, "Unhandled server error");
  res.status(500).json({ error: "Internal server error" });
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  logger.info({ port }, "Luma Events server listening");
});
