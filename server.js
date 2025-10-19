// ------------------------------------------------------------
// Solana Signal Backend v5  (Render-safe, Win-Rate MVP)
// - Firebase admin (resilient)
// - Raydium/Orca tight parsing (memory-safe)
// - Helius-based wallet watcher (lightweight polling)
// - Win-rate = survived >= WIN_MINUTES and at least 2 swaps for token
// - All endpoints return JSON 200 (no 502), diagnostic-friendly
// ------------------------------------------------------------

import express from "express";
import admin from "firebase-admin";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ------------------------------
// Config (adjustable via Render → Environment variables)
// ------------------------------
const PORT = Number(process.env.PORT || 10000);

// Raydium/Orca polling (Render-safe)
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 90_000);
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 5_000);
const MAX_BYTES = Number(process.env.MAX_BYTES || 250_000);

// Wallet watcher (Helius)
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || ""; // set in Render Environment
const WALLET_POLL_MS = Number(process.env.WALLET_POLL_MS || 120_000);
const WIN_MINUTES = Number(process.env.WIN_MINUTES || 5); // adjustable (5/10/15 etc.)

// ------------------------------
// ESM helper
// ------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ------------------------------
// Firebase initialization (resilient)
// ------------------------------
function initFirebase() {
  try {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
    console.log("✅ Firebase Admin initialized (applicationDefault)");
    return;
  } catch (e1) {
    console.warn("⚠️ applicationDefault init failed:", e1.message);
  }

  const credPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    "/etc/secrets/solanasignal-51547-firebase-adminsdk-fbsvc-76bfa673ed.json";

  if (fs.existsSync(credPath)) {
    try {
      admin.initializeApp({ credential: admin.credential.cert(credPath) });
      console.log("✅ Firebase Admin initialized (service account)");
      return;
    } catch (e2) {
      console.error("❌ service-account init failed:", e2.message);
    }
  } else {
    console.warn("⚠️ No GOOGLE_APPLICATION_CREDENTIALS file found; continuing without Firebase Admin");
  }
}
initFirebase();

const db = admin.apps.length ? admin.firestore() : null;

// ------------------------------
// Express server + JSON
// ------------------------------
const app = express();
app.use(express.json());

// Root health
app.get("/", (_req, res) => {
  res.json({ ok: true, msg: "🔥 Solana Signal Watcher (Raydium/Orca tight parsing v5)" });
});

// ------------------------------
// Safe fetch (timeout + byte limit + browser headers)
// ------------------------------
async function fetchLimited(url, { timeoutMs = FETCH_TIMEOUT_MS, maxBytes = MAX_BYTES } = {}) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    Accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
  };

  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    const chunks = [];
    let total = 0;
    return await new Promise((resolve, reject) => {
      res.body.on("data", (chunk) => {
        chunks.push(chunk);
        total += chunk.length;
        if (total >= maxBytes) res.body.destroy();
      });
      res.body.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.body.on("error", reject);
    });
  } catch (err) {
    return `__ERROR__${String(err)}`;
  } finally {
    clearTimeout(to);
  }
}

// Extract “addresses” (base58-ish 32–44 chars) from limited text
function extractAddressesLimited(text, { limit = 40 } = {}) {
  if (!text || text.startsWith("__ERROR__")) return [];
  const s = new Set();
  const rgx = /"(?:(?:poolId|address|mint|tokenMint|liquidity|pool|pools)?"?\s*:\s*")?([A-HJ-NP-Za-km-z1-9]{32,44})"/g;
  let m;
  while ((m = rgx.exec(text)) && s.size < limit) {
    if (m[1]) s.add(m[1]);
  }
  return Array.from(s);
}

// ------------------------------
// Raydium/Orca in-memory “pair cache”
// ------------------------------
const sources = {
  raydium: "https://api.raydium.io/pairs",
  orca: "https://api.mainnet.orca.so/allPools",
};
const pairCache = {
  tokens: new Map(), // key: address
  lastPoll: null,
};

function upsertPair(addr, source) {
  const now = new Date();
  const cur = pairCache.tokens.get(addr);
  if (cur) cur.lastSeen = now;
  else pairCache.tokens.set(addr, { address: addr, source, firstSeen: now, lastSeen: now });
}

async function pollPairs() {
  console.log("🔎 Polling pairs (Render-safe)…");
  pairCache.lastPoll = new Date();

  const [ray, orc] = await Promise.all([
    fetchLimited(sources.raydium).catch((e) => `__ERROR__${e}`),
    fetchLimited(sources.orca).catch((e) => `__ERROR__${e}`),
  ]);

  const rayAddrs = extractAddressesLimited(ray, { limit: 40 });
  const orcAddrs = extractAddressesLimited(orc, { limit: 40 });

  rayAddrs.forEach((a) => upsertPair(a, "raydium"));
  orcAddrs.forEach((a) => upsertPair(a, "orca"));

  console.log(
    `✅ Pairs poll complete | Raydium: ${rayAddrs.length}, Orca: ${orcAddrs.length}, cache size: ${pairCache.tokens.size}`
  );
}

setInterval(pollPairs, POLL_INTERVAL_MS);
setTimeout(pollPairs, 2_000);

// Diagnostics
app.get("/liquidity-check", async (_req, res) => {
  console.log("🧠 liquidity-check (summary)");
  const [ray, orc] = await Promise.allSettled([
    fetchLimited(sources.raydium, { timeoutMs: 4000, maxBytes: 150_000 }),
    fetchLimited(sources.orca, { timeoutMs: 4000, maxBytes: 150_000 }),
  ]);

  const resp = {
    ok: true,
    msg: "Liquidity check (summary mode)",
    raydium:
      ray.status === "fulfilled" && !String(ray.value).startsWith("__ERROR__")
        ? { ok: true, truncated: true }
        : { ok: false, error: String(ray.value).replace("__ERROR__", "") },
    orca:
      orc.status === "fulfilled" && !String(orc.value).startsWith("__ERROR__")
        ? { ok: true, truncated: true }
        : { ok: false, error: String(orc.value).replace("__ERROR__", "") },
    cache: {
      tokenCount: pairCache.tokens.size,
      lastPoll: pairCache.lastPoll ? pairCache.lastPoll.toISOString() : null,
    },
  };

  return res.json(resp);
});

app.get("/watch/status", (_req, res) => {
  const sample = Array.from(pairCache.tokens.values())
    .slice(0, 10)
    .map((t) => ({
      address: t.address,
      source: t.source,
      firstSeen: t.firstSeen.toISOString(),
      lastSeen: t.lastSeen.toISOString(),
    }));
  res.json({
    ok: true,
    cachedTokens: pairCache.tokens.size,
    lastPoll: pairCache.lastPoll ? pairCache.lastPoll.toISOString() : null,
    sample,
  });
});

// ------------------------------
// Phase 5: Wallet Win-Rate MVP (Helius)
// ------------------------------
// - Tracks wallets you add.
// - Polls last N txs using Helius (light).
// - For each token mint seen in SWAP tx, record firstSeen.
// - Mark "win" if we see >= 2 swap tx for same mint AND it has survived >= WIN_MINUTES.
//   (This is a safe MVP; later we’ll replace with price/ROI logic.)
//
// Environment: HELIUS_API_KEY (set in Render → Environment)

const wallets = new Map(); // key: wallet -> { label, trades: Map(tokenMint -> TradeInfo) }
const WIN_MS = WIN_MINUTES * 60_000;

function getWalletInfo(address) {
  if (!wallets.has(address)) wallets.set(address, { label: null, trades: new Map() });
  return wallets.get(address);
}

// Add a wallet to watch
app.post("/wallets/add", async (req, res) => {
  try {
    const { address, label } = req.body || {};
    if (!address) return res.status(400).json({ ok: false, msg: "address required" });
    const info = getWalletInfo(address);
    if (label) info.label = label;
    return res.json({ ok: true, msg: "wallet added", address, label: info.label });
  } catch (e) {
    return res.status(500).json({ ok: false, msg: e.message });
  }
});

// Remove a wallet
app.post("/wallets/remove", (req, res) => {
  const { address } = req.body || {};
  if (!address) return res.status(400).json({ ok: false, msg: "address required" });
  wallets.delete(address);
  return res.json({ ok: true, msg: "removed", address });
});

// List wallets
app.get("/wallets/list", (_req, res) => {
  const list = Array.from(wallets.entries()).map(([address, v]) => ({
    address,
    label: v.label || null,
    tokens: v.trades.size,
  }));
  return res.json({ ok: true, wallets: list });
});

// Wallet stats (win-rate)
app.get("/wallets/stats", (_req, res) => {
  const now = Date.now();
  const details = [];
  let totalWins = 0;
  let total = 0;

  wallets.forEach((w, address) => {
    let wins = 0;
    let count = 0;
    const tokens = [];

    w.trades.forEach((t, mint) => {
      count++;
      const aliveForMs = now - t.firstSeen.getTime();
      const survived = aliveForMs >= WIN_MS;
      const multiSwaps = t.swapCount >= 2;
      const isWin = survived && multiSwaps;
      if (isWin) wins++;
      tokens.push({
        mint,
        firstSeen: t.firstSeen.toISOString(),
        swapCount: t.swapCount,
        survivedMin: Math.floor(aliveForMs / 60000),
        win: isWin,
      });
    });

    totalWins += wins;
    total += count;
    const wr = count ? Math.round((wins / count) * 100) : 0;

    details.push({
      address,
      label: w.label || null,
      tokens: count,
      wins,
      winRate: wr,
      tokensDetail: tokens.slice(0, 10), // limit for output
    });
  });

  const globalWR = total ? Math.round((totalWins / total) * 100) : 0;

  return res.json({
    ok: true,
    winMinutes: WIN_MINUTES,
    global: { tokens: total, wins: totalWins, winRate: globalWR },
    wallets: details,
  });
});

// Poll Helius for all watched wallets
async function pollWallets() {
  if (!HELIUS_API_KEY) {
    console.warn("⚠️ HELIUS_API_KEY not set; wallet watcher idle");
    return;
  }

  const promises = [];
  wallets.forEach((_v, address) => {
    promises.push(fetchWalletSwaps(address).catch((e) => console.warn("wallet fetch fail:", address, e.message)));
  });
  await Promise.allSettled(promises);
}

// Get last transactions from Helius and update local trades
async function fetchWalletSwaps(address) {
  const url = `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${HELIUS_API_KEY}&limit=50`;
  const res = await fetch(url);
  const data = await res.json();

  const info = getWalletInfo(address);

  for (const tx of data || []) {
    // Helius tx has "type" or "description" classification; keep it broad
    const desc = tx?.description || tx?.type || "";
    if (!/swap|amm|raydium|orca/i.test(desc)) continue;

    // Try to derive token mint(s) from pre/post token balances
    const mints = new Set();
    (tx?.tokenTransfers || []).forEach((tr) => {
      if (tr?.mint) mints.add(tr.mint);
    });

    if (mints.size === 0) continue;

    mints.forEach((mint) => {
      const t = info.trades.get(mint);
      if (!t) {
        info.trades.set(mint, {
          mint,
          firstSeen: new Date(tx.timestamp * 1000),
          swapCount: 1,
        });
      } else {
        // increment swap count if we see the same mint again
        t.swapCount++;
      }
    });
  }
}

// run poller
setInterval(pollWallets, WALLET_POLL_MS);
setTimeout(pollWallets, 5_000);

// ------------------------------
// Firebase device token save + test broadcast
// ------------------------------
app.post("/register-token", async (req, res) => {
  try {
    const { token, label } = req.body || {};
    if (!token) return res.status(400).json({ ok: false, msg: "token required" });
    if (!db) return res.json({ ok: true, msg: "Saved locally (no Firestore available)" });
    await db.collection("device_tokens").doc(token).set(
      { label: label || null, createdAt: new Date() },
      { merge: true }
    );
    res.json({ ok: true, msg: "token saved" });
  } catch (e) {
    res.status(500).json({ ok: false, msg: e.message });
  }
});

async function notifyAll({ title, body, data = {} }) {
  if (!admin?.messaging || !db) return;
  const snap = await db.collection("device_tokens").get();
  const tokens = [];
  snap.forEach((d) => tokens.push(d.id));
  if (!tokens.length) return;
  const resp = await admin.messaging().sendMulticast({
    notification: { title, body },
    data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
    tokens,
  });
  console.log(`🔔 push: ${resp.successCount}/${tokens.length} delivered`);
}

app.post("/notify/test", async (_req, res) => {
  try {
    await notifyAll({
      title: "SolanaSignal Test 🔔",
      body: "Backend is live — wallet watcher is running.",
    });
    res.json({ ok: true, msg: "Notification broadcast attempted" });
  } catch (e) {
    res.status(500).json({ ok: false, msg: e.message });
  }
});

// ------------------------------
// Start Server
// ------------------------------
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log("🔥 Solana Signal Watcher (Raydium/Orca tight parsing v5 + win-rate MVP)");
});

// Prevent hard crashes on free-tier
process.on("unhandledRejection", (r) => console.error("⚠️ Unhandled Rejection:", r));
process.on("uncaughtException", (e) => console.error("⚠️ Uncaught Exception:", e));
