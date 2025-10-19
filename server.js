// ------------------------------------------------------------
// Solana Signal Backend v4 (Render free-tier safe)
// - Firebase admin (resilient init)
// - Raydium/Orca poller with browser headers + timeouts
// - Limited streaming (first N KB) to avoid 512MB crashes
// - In-memory pool cache + status endpoints
// - FCM token registration + test push endpoint
// ------------------------------------------------------------

import express from "express";
import admin from "firebase-admin";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ------------------------------
// Basic config (tweakable)
// ------------------------------
const PORT = process.env.PORT || 10000;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 90_000); // 90s
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 5_000);   // 5s
const MAX_BYTES = Number(process.env.MAX_BYTES || 250_000);               // 250 KB per source

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
      console.log("✅ Firebase Admin initialized (service account file)");
      return;
    } catch (e2) {
      console.error("❌ Service-account init failed:", e2.message);
    }
  } else {
    console.warn("⚠️ No GOOGLE_APPLICATION_CREDENTIALS file found; continuing without Firebase Admin");
  }
}
initFirebase();

const db = admin.apps.length ? admin.firestore() : null;

// ------------------------------
// Express server
// ------------------------------
const app = express();
app.use(express.json());

// Health
app.get("/", (_req, res) => {
  res.json({ ok: true, msg: "🔥 Solana Signal Watcher (Raydium/Orca tight parsing v4)" });
});

// ------------------------------
// Memory-safe fetch (limit bytes + timeout + browser headers)
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
    // node-fetch stream (Node Readable)
    const chunks = [];
    let total = 0;

    const reader = res.body;
    return await new Promise((resolve, reject) => {
      reader.on("data", (chunk) => {
        chunks.push(chunk);
        total += chunk.length;
        if (total >= maxBytes) {
          // Stop reading more to save memory
          reader.destroy();
        }
      });
      reader.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      reader.on("error", reject);
    });
  } catch (err) {
    return `__ERROR__${String(err)}`;
  } finally {
    clearTimeout(to);
  }
}

// ------------------------------
// Quick parser: extract up to N "addresses"
// (base58-ish addresses 32-44 chars). Not perfect, but safe & light.
// ------------------------------
function extractAddressesLimited(text, { limit = 50 } = {}) {
  if (!text || text.startsWith("__ERROR__")) return [];
  const results = new Set();
  const regex = /"(?:(?:poolId|address|mint|tokenMint|liquidity|pool|pools)?"?\s*:\s*")?([A-HJ-NP-Za-km-z1-9]{32,44})"/g;
  let m;
  while ((m = regex.exec(text)) && results.size < limit) {
    const val = m[1];
    if (val && val.length >= 32 && val.length <= 44) results.add(val);
  }
  return Array.from(results);
}

// ------------------------------------------------------------
// In-memory cache of detected pools (very light)
// ------------------------------------------------------------
const state = {
  tokens: new Map(), // key: address -> { firstSeen: Date, lastSeen: Date, source: 'raydium'|'orca' }
  sources: {
    raydium: "https://api.raydium.io/pairs",
    orca: "https://api.mainnet.orca.so/allPools",
  },
  lastPoll: null,
};

function upsertToken(address, source) {
  const now = new Date();
  const t = state.tokens.get(address);
  if (t) {
    t.lastSeen = now;
  } else {
    state.tokens.set(address, { address, source, firstSeen: now, lastSeen: now });
  }
}

// ------------------------------------------------------------
// Poll both sources (memory-light). Runs on interval.
// ------------------------------------------------------------
async function pollSources() {
  console.log("🔎 Polling Raydium/Orca (summary mode)...");
  state.lastPoll = new Date();

  // Fetch limited texts
  const [rayText, orcaText] = await Promise.all([
    fetchLimited(state.sources.raydium).catch((e) => `__ERROR__${e}`),
    fetchLimited(state.sources.orca).catch((e) => `__ERROR__${e}`),
  ]);

  // Extract limited addresses
  const rayAddrs = extractAddressesLimited(rayText, { limit: 30 });
  const orcaAddrs = extractAddressesLimited(orcaText, { limit: 30 });

  rayAddrs.forEach((addr) => upsertToken(addr, "raydium"));
  orcaAddrs.forEach((addr) => upsertToken(addr, "orca"));

  console.log(
    `✅ Poll complete. Added/updated Raydium: ${rayAddrs.length}, Orca: ${orcaAddrs.length}, total cached: ${state.tokens.size}`
  );
}

// start poller
setInterval(pollSources, POLL_INTERVAL_MS);
setTimeout(pollSources, 2_000); // initial poll after boot

// ------------------------------------------------------------
// Public endpoint: liquidity-check (shows diagnostics)
// ------------------------------------------------------------
app.get("/liquidity-check", async (_req, res) => {
  console.log("🧠 Running liquidity-check (summary mode)");
  // One short fetch each, but does not block poller
  const [ray, orc] = await Promise.allSettled([
    fetchLimited(state.sources.raydium),
    fetchLimited(state.sources.orca),
  ]);

  const rayOk = ray.status === "fulfilled" && !String(ray.value).startsWith("__ERROR__");
  const orcOk = orc.status === "fulfilled" && !String(orc.value).startsWith("__ERROR__");

  res.json({
    ok: true,
    msg: "Liquidity check (summary mode)",
    raydium: rayOk ? { ok: true, truncated: true } : { ok: false, error: String(ray.value).replace("__ERROR__", "") },
    orca: orcOk ? { ok: true, truncated: true } : { ok: false, error: String(orc.value).replace("__ERROR__", "") },
    cache: {
      tokenCount: state.tokens.size,
      lastPoll: state.lastPoll ? state.lastPoll.toISOString() : null,
    },
  });
});

// ------------------------------------------------------------
// Public endpoint: watcher status (cached tokens preview)
// ------------------------------------------------------------
app.get("/watch/status", (_req, res) => {
  const sample = Array.from(state.tokens.values()).slice(0, 10).map((t) => ({
    address: t.address,
    source: t.source,
    firstSeen: t.firstSeen.toISOString(),
    lastSeen: t.lastSeen.toISOString(),
  }));

  res.json({
    ok: true,
    msg: "Watcher status",
    cachedTokens: state.tokens.size,
    lastPoll: state.lastPoll ? state.lastPoll.toISOString() : null,
    sample,
  });
});

// ------------------------------------------------------------
// FCM token registration + test push
// ------------------------------------------------------------
app.post("/register-token", async (req, res) => {
  try {
    const { token, label } = req.body || {};
    if (!token) return res.status(400).json({ ok: false, msg: "token required" });
    if (!db) return res.json({ ok: true, msg: "Saved (no Firestore available)" });

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
      body: "Backend is live — you will receive live wallet alerts here.",
    });
    res.json({ ok: true, msg: "Notification broadcast attempted" });
  } catch (e) {
    res.status(500).json({ ok: false, msg: e.message });
  }
});

// ------------------------------------------------------------
// Start server
// ------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log("🔥 Solana Signal Watcher (Raydium/Orca tight parsing v4)");
});

// Avoid hard crashes
process.on("unhandledRejection", (r) => console.error("⚠️ Unhandled Rejection:", r));
process.on("uncaughtException", (e) => console.error("⚠️ Uncaught Exception:", e));
