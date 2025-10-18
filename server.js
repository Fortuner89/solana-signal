import express from "express";
import admin from "firebase-admin";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse JSON request bodies
app.use(express.json());

// Get correct directory path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Locate Firebase Admin SDK credentials
const serviceAccountPath =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  "/etc/secrets/solanasignal-51547-firebase-adminsdk-fbsvc-76bfa673ed.json";

// Initialize Firebase Admin
try {
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log("✅ Firebase Admin initialized successfully");
} catch (error) {
  console.error("❌ Error initializing Firebase Admin:", error);
}

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    ok: true,
    msg: "🔥 Solana Signal backend connected to Firebase!",
  });
});

// ✉️ /send endpoint to push notifications
app.post("/send", async (req, res) => {
  try {
    const { token, title, body } = req.body;

    if (!token || !title || !body) {
      return res.status(400).json({ ok: false, msg: "Missing required fields" });
    }

    const message = {
      notification: { title, body },
      token,
    };

    const response = await admin.messaging().send(message);
    console.log("✅ Notification sent:", response);

    res.json({ ok: true, msg: "Notification sent!", id: response });
  } catch (error) {
    console.error("❌ Error sending message:", error);
    res.status(500).json({ ok: false, msg: "Error sending notification" });
  }
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});








