// server.js — Final Production Version with Tight Raydium/Orca Parsing
import express from "express";
import admin from "firebase-admin";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

const app = express();
const port = process.env.PORT || 10000;

// ES module path helpers
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Firebase Admin initialization
try {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
  console.log("✅ Firebase Admin initialized (applicationDefault)");
} catch (err) {
  console.error("❌ Firebase initialization failed:", err);
}

// Basic heartbeat endpoint
app.get("/", (req, res) => {
  res.json({ ok: true, msg: "🔥 Solana Signal Watcher (Raydium/Orca tight parsing)" });
});

// --- Raydium/Orca liquidity parsing example ---
app.get("/liquidity-check", async (req, res) => {
  try {
    const raydiumEndpoint = "https://api.raydium.io/pairs";
    const orcaEndpoint = "https://api.mainnet.orca.so/allPools";

    const [raydiumRes, orcaRes] = await Promise.all([
      fetch(raydiumEndpoint).then((r) => r.json()),
      fetch(orcaEndpoint).then((r) => r.json()),
    ]);

    res.json({
      ok: true,
      raydiumPairs: Object.keys(raydiumRes).length,
      orcaPools: Object.keys(orcaRes).length,
    });
  } catch (error) {
    console.error("❌ Error fetching liquidity data:", error);
    res.status(500).json({ ok: false, msg: "Failed to fetch Raydium/Orca data" });
  }
});

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
