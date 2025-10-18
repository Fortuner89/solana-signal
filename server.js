// server.js
import express from "express";
import admin from "firebase-admin";
import { readFileSync } from "fs";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ✅ Load the Firebase Admin SDK key from Render’s secret file
const serviceAccountPath = "/etc/secrets/solanasignal-51547-firebase-adminsdk-fbsvc-76bfa673ed.json";

let serviceAccount;
try {
  const fileContent = readFileSync(serviceAccountPath, "utf8");
  serviceAccount = JSON.parse(fileContent);
  console.log("✅ Firebase key loaded successfully");
} catch (err) {
  console.error("❌ Error reading Firebase key file:", err.message);
}

// ✅ Initialize Firebase Admin
try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log("🔥 Firebase Admin initialized successfully");
} catch (err) {
  console.error("❌ Firebase initialization failed:", err.message);
}

// ✅ Default route to confirm server is working
app.get("/", (req, res) => {
  res.json({ ok: true, msg: "🔥 Solana Signal backend connected to Firebase!" });
});

// ✅ Endpoint to send push notifications
app.post("/send", async (req, res) => {
  try {
    const { token, title, body } = req.body;

    if (!token || !title || !body) {
      return res.status(400).json({
        ok: false,
        msg: "Missing required fields: token, title, or body",
      });
    }

    const message = {
      notification: { title, body },
      token,
    };

    const response = await admin.messaging().send(message);
    res.json({ ok: true, msg: "Notification sent!", id: response });
  } catch (err) {
    console.error("❌ FCM send error:", err);
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// ✅ Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});


