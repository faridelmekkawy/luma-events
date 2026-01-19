import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "./firebaseAdmin.js";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDir));

function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"];
  if (!process.env.ADMIN_API_TOKEN || token !== process.env.ADMIN_API_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return next();
}

app.get("/api/system-settings", async (_req, res) => {
  try {
    const snap = await db.doc("systemSettings/production").get();
    return res.json(snap.exists ? snap.data() : {});
  } catch (err) {
    console.error("Failed to fetch system settings:", err);
    return res.status(500).json({ error: "Failed to fetch system settings" });
  }
});

app.put("/api/system-settings", requireAdmin, async (req, res) => {
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
    return res.json({ ok: true });
  } catch (err) {
    console.error("Failed to update system settings:", err);
    return res.status(500).json({ error: "Failed to update system settings" });
  }
});

app.get("/api/admin/overview", requireAdmin, async (_req, res) => {
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
    console.error("Failed to fetch admin overview:", err);
    return res.status(500).json({ error: "Failed to fetch admin overview" });
  }
});

app.get("/healthz", (_req, res) => res.json({ ok: true }));

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Luma Events server listening on ${port}`);
});
