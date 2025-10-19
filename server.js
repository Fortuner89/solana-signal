// -------------------------
// Solana Signal Backend
// Firebase + Raydium/Orca Tight Parsing (Lite Version)
// -------------------------

import express from "express";
import admin from "firebase-admin";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const port = process.env.PORT || 10000;

// File path setup for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// -------------------------
// Initialize Firebase Admin
// -------------------------
try {
  const serviceAccountPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    "/etc/secrets/solanasignal-51547-firebase-adminsdk-fbsvc-76bfa673ed.json";

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccountPath),
  });

  console.log("✅ Firebase Admin initialized (applicationDefault)");
} catch (error) {
  console.error("❌ Firebase Admin init failed:", error);
}

// -------------------------
// Default endpoint
// -------------------------
app.get("/", (req, res) => {
  res.json({
    ok: true,
    msg: "🔥 Solana Signal Watcher (Raydium/Orca tight parsing)",
  });
});

// -------------------------
// Simplified liquidity-check
// -------------------------
app.get("/liquidity-check", async (req, res) => {
  console.log("🧠 Running simplified liquidity-check...");

  try {
    // Raydium pairs only — lightweight fetch for Render free plan
    const raydiumRes = await fetch("https://api.raydium.io/pairs");
    const data = await raydiumRes.json();

    const pairCount = Object.keys(data).length;

    console.log(`✅ Retrieved ${pairCount} Raydium pairs`);
    res.json({
      ok: true,
      raydiumPairs: pairCount,
      msg: "Raydium liquidity check complete",
    });
  } catch (error) {
    console.error("❌ Error fetching Raydium pairs:", error);
    res.status(500).json({
      ok: false,
      msg: "Error fetching Raydium data",
    });
  }
});

// -------------------------
// Start server
// -------------------------
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log("🔥 Solana Signal Watcher (Raydium/Orca tight parsing)");
});
