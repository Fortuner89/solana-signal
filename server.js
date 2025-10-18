// --- server.js ---
// ✅ Imports
import express from "express";
import admin from "firebase-admin";
import path from "path";
import { fileURLToPath } from "url";

// ✅ Setup
const app = express();
app.use(express.json());
const port = process.env.PORT || 3000;

// ✅ Resolve file paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Load Firebase credentials
const serviceAccountPath =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  "/etc/secrets/solanasignal-51547-firebase-adminsdk-fbsvc-76bfa673ed.json";

// ✅ Initialize Firebase Admin (universal version)
import fs from "fs";

try {
  const rawData = fs.readFileSync(serviceAccountPath, "utf8");
  const serviceAccount = JSON.parse(rawData);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  console.log("✅ Firebase Admin initialized successfully");
} catch (error) {
  console.error("❌ Error initializing Firebase Admin:", error);
}

// ✅ Root test route
app.get("/", (req, res) => {
  res.json({ ok: true, msg: "🔥 Solana Signal backend connected to Firebase!" });
});

// ✅ Send notification route
app.post("/send", async (req, res) => {
  try {
    const { token, title, body } = req.body;
    if (!token || !title || !body) {
      return res.status(400).json({
        ok: false,
        msg: "Missing required fields: token, title, body",
      });
    }

    const message = {
      notification: { title, body },
      token,
    };

    const response = await admin.messaging().send(message);
    console.log("📨 Message sent:", response);

    res.json({ ok: true, msg: "Notification sent!", id: response });
  } catch (error) {
    console.error("❌ Error sending message:", error);
    res.status(500).json({ ok: false, msg: error.message });
  }
});

// ✅ Start server
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});




