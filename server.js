// ------------------------------------------------------------
// Solana Signal Backend v4  (Memory-safe for Render Starter Tier)
// ------------------------------------------------------------
import express from "express";
import admin from "firebase-admin";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 10000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Firebase (resilient init) ---------------------------------------------
function initFirebase() {
  try {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
    console.log("✅ Firebase Admin initialized (applicationDefault)");
  } catch (e) {
    console.warn("⚠️ Firebase fallback:", e.message);
    const cred = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (cred && fs.existsSync(cred)) {
      admin.initializeApp({ credential: admin.credential.cert(cred) });
      console.log("✅ Firebase Admin initialized (service account)");
    } else {
      console.warn("⚠️ No service account found — continuing without admin");
    }
  }
}
initFirebase();

// --- Browser header helper -----------------------------------------------
const browserHeaders = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  Accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
};

// --- Stream-safe lightweight fetch ----------------------------------------
async function safeFetchSummary(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { headers: browserHeaders, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();

    // Avoid full parse; just count items roughly
    const count = (text.match(/{/g) || []).length;
    return { ok: true, count, truncated: text.length > 100000 };
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally {
    clearTimeout(t);
  }
}

// --- Root health ----------------------------------------------------------
app.get("/", (_req, res) => {
  res.json({ ok: true, msg: "🔥 Solana Signal (Memory-safe tight parsing)" });
});

// --- Liquidity-check (RAM-friendly) ---------------------------------------
app.get("/liquidity-check", async (_req, res) => {
  console.log("🧠 Running memory-safe liquidity check...");
  const [raydium, orca] = await Promise.all([
    safeFetchSummary("https://api.raydium.io/pairs"),
    safeFetchSummary("https://api.mainnet.orca.so/allPools"),
  ]);

  res.json({
    ok: true,
    msg: "Liquidity check (summary mode)",
    raydium,
    orca,
  });
});

// --- Start server ---------------------------------------------------------
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log("🔥 Solana Signal Watcher (Memory-safe v4)");
});

process.on("unhandledRejection", (r) => console.error("⚠️ Rejection:", r));
process.on("uncaughtException", (e) => console.error("⚠️ Exception:", e));
