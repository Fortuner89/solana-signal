// -----------------------------
// ✅ SOLANA SIGNAL BACKEND
// -----------------------------
import express from "express";
import admin from "firebase-admin";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse JSON
app.use(express.json());

// This converts ES module URL to file path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Firebase secret path on Render
const serviceAccountPath =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  "/etc/secrets/solanasignal-51547-firebase-adminsdk-fbsvc-76bfa673ed.json";

// ✅ Initialize Firebase Admin
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

// ✅ Default root endpoint
app.get("/", (req, res) => {
  res.json({ ok: true, msg: "🔥 Solana Signal backend connected to Firebase!" });
});

// ✅ POST /send endpoint
app.post("/send", async (req, res) => {
  try {
    const { token, title, body } = req.body;
    if (!token || !title || !body) {
      return res
        .status(400)
        .json({ ok: false, msg: "Missing token, title, or body" });
    }

    const message = {
      token,
      notification: {
        title,
        body,
      },
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





