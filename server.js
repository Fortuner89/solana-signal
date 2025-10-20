// ===========================================================
// 🔥 Solana Signal Watcher v5.3.1 — Stable Mode
// Render-safe polling + tighter memory + fast port bind
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
  activeSource: "Raydium",
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
const RAYDIUM_SOURCES = [
  "https://api.dexscreener.io/latest/dex/search?q=SOL",
  "https://public-api.birdeye.so/public/market/overview?sort_by=volume_24h&sort_type=desc&offset=0&limit=50",
];
const ORCA_SOURCE = "https://api.mainnet.orca.so/allPools";
const BIRD_HEADER = {
  headers: { "X-API-KEY": "public_bird_key_9eac43b09ab54192b" },
};

// ---------------- Poll Logic ----------------
async function pollOnce() {
  if (isPolling) return; // prevent overlap
  isPolling = true;

  console.log("🔁 Polling DEX sources...");
  let result = null;
  let src = "";

  for (const url of RAYDIUM_SOURCES) {
    const isBird = url.includes("birdeye");
    const r = await safeFetch(url, url, isBird ? BIRD_HEADER : {});
    if (r.ok && r.data) {
      result = r;
      src = url;
      break;
    }
  }

  const orca = await safeFetch(ORCA_SOURCE, "Orca");
  const count =
    (result?.data?.length || 0) + (orca?.data?.length || 0);

  CACHE = {
    tokenCount: count,
    lastPoll: new Date().toISOString(),
    activeSource: src || "All failed",
    backupUsed: src !== RAYDIUM_SOURCES[0],
  };

  console.log(
    `📊 Poll complete | Tokens: ${count} | Source: ${CACHE.activeSource}`
  );

  isPolling = false;
}

// ---------------- Scheduler ----------------
pollOnce();
setInterval(pollOnce, 1000 * 60 * 5); // every 5 min

// ---------------- Routes ----------------
app.get("/", (_, res) =>
  res.json({
    ok: true,
    msg: "🔥 Solana Signal Watcher v5.3.1 (Stable Mode)",
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

app.listen(port, () => {
  console.log(`🚀 Port ${port} ready`);
  console.log("🔥 Solana Signal Watcher v5.3.1 — Render Stable");
});
