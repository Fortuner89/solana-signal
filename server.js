// ===========================================================
// 🔥 Solana Signal Watcher v5.3.4 — Multi-source Dex fix
// Strategy: DexPairs ➜ DexSearch ➜ BirdEye (stable on Render)
// ===========================================================

import express from "express";
import fetch from "node-fetch";
import admin from "firebase-admin";
import { fileURLToPath } from "url";
import path from "path";

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
  activeSource: "DexPairs",
  backupUsed: false,
};
let isPolling = false;

// ---------------- Helpers ----------------
async function safeFetch(url, label, opts = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      // Some providers check UA; sending a generic JSON UA helps:
      headers: { "accept": "application/json", ...(opts.headers || {}) },
      ...opts,
    });
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
// 1) Preferred — fast & complete
const DS_PAIRS = "https://api.dexscreener.com/latest/dex/pairs/solana";
// 2) Backup path — returns pairs of recent SOL-related searches
const DS_SEARCH = "https://api.dexscreener.com/latest/dex/search?q=SOL";
// 3) BirdEye — stable backup
const BIRDEYE_SOLANA =
  "https://public-api.birdeye.so/defi/market_overview?chain=solana&sort_by=volume_24h&sort_type=desc&offset=0&limit=50";
const BIRD_HEADER = {
  headers: { "X-API-KEY": "public_bird_key_9eac43b09ab54192b" },
};

// Optional Orca
const ORCA_SOURCE = "https://api.mainnet.orca.so/allPools";

// ---------------- Poll logic ----------------
async function pollOnce() {
  if (isPolling) return;
  isPolling = true;

  console.log("🔁 Polling DEX sources...");
  let activeSource = "";
  let totalTokens = 0;

  // --- Try DexPairs first ---
  const dexPairs = await safeFetch(DS_PAIRS, "DexPairs", {}, 6000);
  if (dexPairs.ok) {
    const count = Array.isArray(dexPairs.data?.pairs)
      ? dexPairs.data.pairs.length
      : 0;
    if (count > 0) {
      totalTokens = count;
      activeSource = "DexPairs";
    }
  }

  // --- If empty/fail, try DexSearch ---
  if (!activeSource) {
    const dexSearch = await safeFetch(DS_SEARCH, "DexSearch", {}, 6000);
    if (dexSearch.ok) {
      const count = Array.isArray(dexSearch.data?.pairs)
        ? dexSearch.data.pairs.length
        : 0;
      if (count > 0) {
        totalTokens = count;
        activeSource = "DexSearch";
      }
    }
  }

  // --- If still nothing, fallback to BirdEye ---
  if (!activeSource) {
    const bird = await safeFetch(BIRDEYE_SOLANA, "BirdEye", BIRD_HEADER, 6000);
    if (bird.ok) {
      totalTokens = bird.data?.data?.length || 0;
      activeSource = "BirdEye";
    }
  }

  // Optional: merge Orca count
  const orca = await safeFetch(ORCA_SOURCE, "Orca", {}, 5000);
  const orcaCount = Array.isArray(orca.data) ? orca.data.length : 0;

  CACHE = {
    tokenCount: totalTokens + orcaCount,
    lastPoll: new Date().toISOString(),
    activeSource: activeSource || "All failed",
    backupUsed: activeSource === "BirdEye" || activeSource === "DexSearch",
  };

  console.log(
    `📊 Poll complete | Tokens: ${CACHE.tokenCount} | Source: ${CACHE.activeSource}`
  );

  isPolling = false;
}

// First poll and schedule
pollOnce();
setInterval(pollOnce, 1000 * 60 * 5);

// ---------------- Routes ----------------
app.get("/", (_, res) =>
  res.json({
    ok: true,
    msg: "🔥 Solana Signal Watcher v5.3.4",
    cache: CACHE,
  })
);

// Full JSON view
app.get("/liquidity-check", (_, res) =>
  res.json({
    ok: true,
    msg: "Liquidity summary",
    source: CACHE.activeSource,
    tokens: CACHE.tokenCount,
    lastPoll: CACHE.lastPoll,
  })
);

// ✅ Compact mobile status
app.get("/status", (_, res) => {
  const ageMins = CACHE.lastPoll
    ? Math.floor((Date.now() - new Date(CACHE.lastPoll)) / 60000)
    : "N/A";
  const src =
    CACHE.activeSource === "DexPairs"
      ? "DexPairs"
      : CACHE.activeSource === "DexSearch"
      ? "DexSearch"
      : CACHE.activeSource;
  res.send(`✅ v5.3.4 | ${src} | ${CACHE.tokenCount} tokens | ${ageMins} min ago`);
});

// Start
app.listen(port, () => {
  console.log(`🚀 Port ${port} ready`);
  console.log("🔥 Solana Signal Watcher v5.3.4 — Multi-source Dex ✅");
});
