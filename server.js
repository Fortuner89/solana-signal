// ------------------------------------------------------------
// Solana Signal Backend v2
// Firebase + Raydium/Orca Tight Parsing (Browser Header Spoof)
// ------------------------------------------------------------

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

// ------------------------------------------------------------
// Initialize Firebase Admin
// ------------------------------------------------------------
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

// ------------------------------------------------------------
// Default root endpoint
// ------------------------------------------------------------
app.get("/", (req, res) => {
  res.json({
    ok: true,
    msg: "🔥 Solana Signal Watcher (Raydium/Orca tight parsing)",
  });
});

// ------------------------------------------------------------
// Liquidity-check with browser-style headers
// ------------------------------------------------------------
app.get("/liquidity-check", async (req, res) => {
  console.log("🧠 Running browser-header liquidity-check...");

  try {
    // Browser-style headers (bypass Cloudflare / API restrictions)
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "application/json",
    };

    // Parallel fetch from both Raydium and Orca
    const [raydiumRes, orcaRes] = await Promise.allSettled([
      fetch("https://api.raydium.io/pairs", { headers }),
      fetch("https://api.mainnet.orca.so/allPools", { headers }),
    ]);

    let raydiumPairs = 0;
    let orcaPools = 0;

    if (raydiumRes.status === "fulfilled") {
      try {
        const rayJson = await raydiumRes.value.json();
        raydiumPairs = Object.keys(rayJson || {}).length;
      } catch (err) {
        console.warn("⚠️ Raydium JSON parse error");
      }
    } else {
      console.warn("⚠️ Raydium fetch failed");
    }

    if (orcaRes.status === "fulfilled") {
      try {
        const orcaJson = await orcaRes.value.json();
        orcaPools = orcaJson?.pools
          ? Object.keys(orcaJson.pools).length
          : Object.keys(orcaJson || {}).length;
      } catch (err) {
        console.warn("⚠️ Orca JSON parse error");
      }
    } else {
      console.warn("⚠️ Orca fetch failed");
    }

    console.log(`✅ Raydium: ${raydiumPairs} pairs | Orca: ${orcaPools} pools`);

    res.json({
      ok: true,
      raydiumPairs,
      orcaPools,
      msg: "Browser-header liquidity check successful",
    });
  } catch (error) {
    console.error("❌ Liquidity-check failed:", error);
    res.status(500).json({
      ok: false,
      msg: "Error fetching liquidity data",
    });
  }
});

// ------------------------------------------------------------
// Start Express server
// ------------------------------------------------------------
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log("🔥 Solana Signal Watcher (Raydium/Orca tight parsing v2)");
});
