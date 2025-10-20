// ===========================================================
// 🔥 Solana Signal Watcher v5.4 — FCM Notification Layer
// DexPairs ➜ DexSearch ➜ BirdEye + Push Alerts
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
let lastAlertTime = 0;

// ---------------- Helpers ----------------
async function safeFetch(url, label, opts = {}, timeoutMs = 6000) {
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
const DS_PAIRS = "https://api.dexscreener.com/latest/dex/pairs/solana";
const DS_SEARCH = "https://api.dexscreener.com/latest/dex/search?q=SOL";
const BIRDEYE_SOLANA =
  "https://public-api.birdeye.so/defi/market_overview?chain=solana&sort_by=volume_24h&sort_type=desc&offset=0&limit=50";
const BIRD_HEADER = {
  headers: { "X-API-KEY": "public_bird_key_9eac43b09ab54192b" },
};
const ORCA_SOURCE = "https://api.mainnet.orca.so/allPools";

// ---------------- Poll ----------------
async function pollOnce() {
  if (isPolling) return;
  isPolling = true;

  console.log("🔁 Polling DEX sources...");
  let activeSource = "";
  let totalTokens = 0;

  // Try DexPairs
  const dexPairs = await safeFetch(DS_PAIRS, "DexPairs");
  if (dexPairs.ok) {
    const count = Array.isArray(dexPairs.data?.pairs)
      ? dexPairs.data.pairs.length
      : 0;
    if (count > 0) {
      totalTokens = count;
      activeSource = "DexPairs";
    }
  }

  // Try DexSearch
  if (!activeSource) {
    const dexSearch = await safeFetch(DS_SEARCH, "DexSearch");
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

  // BirdEye backup
  if (!activeSource) {
    const bird = await safeFetch(BIRDEYE_SOLANA, "BirdEye", BIRD_HEADER);
    if (bird.ok) {
      totalTokens = bird.data?.data?.length || 0;
      activeSource = "BirdEye";
    }
  }

  // Orca optional
  const orca = await safeFetch(ORCA_SOURCE, "Orca");
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
  await evaluateAndNotify();
  isPolling = false;
}

// ---------------- Smart Alert Logic ----------------
async function evaluateAndNotify() {
  const now = Date.now();

  // Notify on data loss or recovery
  if (CACHE.tokenCount === 0 && now - lastAlertTime > 15 * 60 * 1000) {
    await pushNotify(
      "🚨 Liquidity Alert",
      "No tokens detected for 15 minutes — check Dex APIs."
    );
    lastAlertTime = now;
  } else if (CACHE.tokenCount > 0 && now - lastAlertTime > 60 * 60 * 1000) {
    await pushNotify(
      "✅ Solana Signal Stable",
      `${CACHE.tokenCount} tokens tracked from ${CACHE.activeSource}.`
    );
    lastAlertTime = now;
  }
}

// ---------------- Firebase Push ----------------
async function pushNotify(title, body) {
  try {
    const msg = {
      notification: { title, body },
      topic: "solana-signal",
    };
    await admin.messaging().send(msg);
    console.log(`📨 Push sent: ${title}`);
  } catch (e) {
    console.log("⚠️ Push failed:", e.message);
  }
}

// ---------------- Scheduler ----------------
pollOnce();
setInterval(pollOnce, 1000 * 60 * 5);

// ---------------- Routes ----------------
app.get("/", (_, res) =>
  res.json({ ok: true, msg: "🔥 Solana Signal Watcher v5.4 (FCM Alerts)", cache: CACHE })
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
app.get("/status", (_, res) => {
  const ageMins = CACHE.lastPoll
    ? Math.floor((Date.now() - new Date(CACHE.lastPoll)) / 60000)
    : "N/A";
  res.send(
    `✅ v5.4 | ${CACHE.activeSource} | ${CACHE.tokenCount} tokens | ${ageMins} min ago`
  );
});

// ---------------- Start ----------------
app.listen(port, () => {
  console.log(`🚀 Port ${port} ready`);
  console.log("🔥 Solana Signal Watcher v5.4 — Render + FCM Alerts ✅");
});
