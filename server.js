// server.js — Solana Signal Watcher (tight Raydium/Orca parsing + webpush ready)
import express from "express";
import bodyParser from "body-parser";
import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/* --------------------------- BASIC CONFIG --------------------------- */
const PORT = process.env.PORT || 10000;
const DEFAULT_MIN_LIFETIME_MINUTES = Number(process.env.MIN_LIFETIME_MINUTES || 5);
const DEFAULT_WINRATE_THRESHOLD = Number(process.env.DEFAULT_WINRATE_THRESHOLD || 0.95);
const PRICE_EPSILON_PCT = Number(process.env.PRICE_EPSILON_PCT || 0.0);

/* -------------------------- FIREBASE ADMIN -------------------------- */
function initFirebaseAdmin() {
  try {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
    console.log("✅ Firebase Admin initialized (applicationDefault)");
  } catch (e1) {
    console.error("⚠️ applicationDefault init failed:", e1.message);
    try {
      const credPath = process.env.FIREBASE_CREDENTIALS_PATH;
      const raw = fs.readFileSync(credPath, "utf8");
      const serviceAccount = JSON.parse(raw);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      console.log("✅ Firebase Admin initialized (cert file)");
    } catch (e2) {
      console.error("❌ Firebase Admin init failed:", e2.message);
      process.exit(1);
    }
  }
}
initFirebaseAdmin();
const db = admin.firestore();

/* ----------------------------- EXPRESS ------------------------------ */
const app = express();
app.use(bodyParser.json({ limit: "16mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use("/public", express.static(path.join(__dirname, "public")));

app.get("/", (_req, res) => res.json({ ok: true, msg: "🔥 Solana Signal Watcher (Raydium/Orca tight parsing)" }));

/* -------------------------- UTILITY HELPERS ------------------------- */
const nowTs = () => admin.firestore.Timestamp.now();
const short = s => (s && s.length > 10 ? `${s.slice(0,4)}…${s.slice(-4)}`: s);
const pct = x => (x == null ? "-" : `${(x*100).toFixed(0)}%`);
const humanDuration = s => s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s/60)}m` : `${Math.floor(s/3600)}h`;

/* --------------------------- NOTIFICATIONS -------------------------- */
async function notifyAll({ title, body, data = {} }) {
  try {
    const snap = await db.collection("device_tokens").get();
    const tokens = [];
    snap.forEach(d => tokens.push(d.id));
    if (!tokens.length) return;

    const resp = await admin.messaging().sendMulticast({
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k,v])=>[k,String(v)])),
      tokens
    });
    console.log(`🔔 Sent ${resp.successCount}/${tokens.length} notifications`);
  } catch (e) { console.error("notifyAll:", e.message); }
}

/* ----------------------------- ENDPOINTS ---------------------------- */
app.post("/register-token", async (req,res)=>{
  try{
    const {token,label}=req.body;
    if(!token) return res.status(400).json({ok:false,msg:"token required"});
    await db.collection("device_tokens").doc(token).set({label:label||null,createdAt:nowTs()},{merge:true});
    res.json({ok:true,msg:"token saved"});
  }catch(e){res.status(500).json({ok:false,msg:e.message});}
});

app.post("/watch-wallet", async (req,res)=>{
  try{
    const {wallet,label,minLifetimeMinutes,winrateThreshold,minCoins}=req.body;
    if(!wallet) return res.status(400).json({ok:false,msg:"wallet required"});
    await db.collection("watched_wallets").doc(wallet).set({
      wallet,label:label||null,
      minLifetimeMinutes:Number(minLifetimeMinutes)||DEFAULT_MIN_LIFETIME_MINUTES,
      winrateThreshold:Number(winrateThreshold)||DEFAULT_WINRATE_THRESHOLD,
      minCoins:Number(minCoins)||20,
      updatedAt:nowTs()
    },{merge:true});
    res.json({ok:true,msg:"wallet saved"});
  }catch(e){res.status(500).json({ok:false,msg:e.message});}
});

app.get("/wallet-stats/:wallet", async (req,res)=>{
  try{
    const doc=await db.collection("wallet_stats").doc(req.params.wallet).get();
    res.json(doc.exists?doc.data():{wallet:req.params.wallet,totalTokens:0});
  }catch(e){res.status(500).json({ok:false,msg:e.message});}
});

app.post("/helius-webhook", async (req,res)=>{
  try{
    const p=req.body;
    await db.collection("helius_events").add({ts:nowTs(),payload:p});
    console.log("📬 Helius event received");
    res.json({ok:true});
  }catch(e){res.status(500).json({ok:false,msg:e.message});}
});

/* ----------------------------- STARTUP ------------------------------ */
app.listen(PORT, ()=> console.log(`🚀 Server live on port ${PORT}`));
