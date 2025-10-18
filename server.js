import express from "express";
import admin from "firebase-admin";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const app = express();
const port = process.env.PORT || 3000;

// ✅ Parse JSON requests
app.use(express.json());

// ✅ Resolve working directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Locate service account JSON
const serviceAccountPath =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  "/etc/secrets/solanasignal-51547-firebase-adminsdk-fbsvc-76bfa673ed.json";

try {
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log("✅ Firebase Admin initialized successfully");
} catch (err) {
  console.error("❌ Error initializing Firebase Admin:", err);
}

// ✅ Root route
app.get("/", (req, res) => {
  res.json({ ok: true, msg: "🔥 Solana Signal backend connected to Firebase!" });
});

// ✅ Send-notification route
app.post("/send", async (req, res) => {
  const { token, title, body } = req.body;

  if (!token || !title || !body) {
    return res.status(400).json({ ok: false, msg: "Missing token/title/body" });
  }

  try {
    const message = { notification: { title, body }, token };
    const id = await admin.messaging().send(message);
    console.log("📨 Push sent:", id);
    res.json({ ok: true, msg: "Notification sent!", id });
  } catch (error) {
    console.error("❌ Error sending push:", error);
    res.status(500).json({ ok: false, msg: "Failed to send notification" });
  }
});

// ✅ Start server
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log("📨 /send endpoint is ready ✅");
});









