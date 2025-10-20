// ===========================================================
// 🔥 Solana Signal Watcher v5.3.2 — Working API Patch
// DexScreener + BirdEye updated endpoints (Oct 2025)
// ===========================================================

import express from "express";
import fetch from "node-fetch";
import admin from "firebase-admin";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const port = process.env.PORT || 10000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------- Firebase ----------------
try {
  const keyPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    "/etc/secrets/solanasignal-51547-firebase-adminsdk-fbsvc-76bfa673ed.json";

  admin.initializeApp({ credential: admin.credential.cert(keyPath) });
  console.log("✅ Firebase Admin initialized (applicationDefault)");
} catch (err) {
  console.log("⚠️ Firebase init failed:", err.message);
}

// ---------------- Cache ----------------
let CACHE = {
  tokenCount: 0,
  lastPoll: null,
  activeSource: "DexScreener",
  backupUsed: false,
};
let isPolling = false;

// ---------------- Fetch Helper ----------------
async function safeFetch(url, label, opts = {}, timeoutMs = 4000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, ...opts });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`${label} → ${res.status}`);
    const data = await res.json();
    return { ok: true, data };
  } catch (e) {
    console.log(`⚠️ ${label} failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// ---------------- Sources ----------------
// DexScreener (official unified endpoint for Solana)
const DEXSCREENER_SOLANA =
  "https://api.dexscreener.com/latest/dex/tokens/solana";

// BirdEye (current public Solana markets endpoint)
const BIRDEYE_SOLANA =
  "https://public-api.birdeye.so/defi/market_overview?chain=solana&sort_by=volume_24h&sort_type=desc&offset=0&limit=50";

const BIRD_HEADER = {
  headers: { "X-API-KEY": "public_bird_key_9eac43b09ab54192b" },
};

// Orca remains same
const ORCA_SOURCE = "https://api.mainnet.orca.so/allPools";

// ---------------- Poll Logic ----------------
async function pollOnce() {
  if (isPolling) return;
  isPolling = true;

  console.log("🔁 Polling DEX sources...");
  let activeSource = "";
  let totalTokens = 0;

  // DexScreener primary
  const dex = await safeFetch(DEXSCREENER_SOLANA, "DexScreener SOL", {}, 5000);
  if (dex.ok) {
    totalTokens = Array.isArray(dex.data.pairs) ? dex.data.pairs.length : 0;
    activeSource = DEXSCREENER_SOLANA;
  } else {
    // BirdEye backup
    const bird = await safeFetch(BIRDEYE_SOLANA, "BirdEye SOL", BIRD_HEADER, 5000);
    if (bird.ok) {
      totalTokens = bird.data?.data?.length || 0;
      activeSource = BIRDEYE_SOLANA;
    }
  }

  // Orca optional
  const orca = await safeFetch(ORCA_SOURCE, "Orca", {}, 5000);

  CACHE = {
    tokenCount: totalTokens + (orca.data?.length || 0),
    lastPoll: new Date().toISOString(),
    activeSource: activeSource || "All failed",
    backupUsed: activeSource.includes("birdeye"),
  };

  console.log(`📊 Poll complete | Tokens: ${CACHE.tokenCount} | Source: ${CACHE.activeSource}`);
  isPolling = false;
}

// ---------------- Scheduler ----------------
pollOnce();
setInterval(pollOnce, 1000 * 60 * 5); // every 5 minutes

// ---------------- Routes ----------------
app.get("/", (_, res) =>
  res.json({
    ok: true,
    msg: "🔥 Solana Signal Watcher v5.3.2 (DexScreener + BirdEye patch)",
    cache: CACHE,
  })
);

app.get("/liquidity-check", (_, res) =>
  res.json({
    ok: true,
    msg: "Liquidity summary",
    source: CACHE.activeSource,
    tokens: CACHE.tokenCount,
    lastPoll: CACHE.lastPoll,
  })
);

// ---------------- Start ----------------
app.listen(port, () => {
  console.log(`🚀 Port ${port} ready`);
  console.log("🔥 Solana Signal Watcher v5.3.2 — Working APIs ✅");
});
