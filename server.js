import 'dotenv/config';
import express from 'express';
import admin from 'firebase-admin';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const app = express();
app.use(express.json({ limit: '5mb' })); // Allow larger webhook payloads

// 1) Check env early
if (!process.env.HELIUS_KEY) console.warn('⚠️ HELIUS_KEY missing in .env (ok for now)');
if (!process.env.FIREBASE_SERVICE_JSON) console.warn('⚠️ FIREBASE_SERVICE_JSON missing or empty');

// 2) Firebase init (safe try)
let messaging = null;
try {
  const svc = JSON.parse(process.env.FIREBASE_SERVICE_JSON || '{}');
  if (svc.type === 'service_account') {
    admin.initializeApp({ credential: admin.credential.cert(svc) });
    messaging = admin.messaging();
    console.log('✅ Firebase admin initialized');
  } else {
    console.log('ℹ️ Skipping Firebase init (no service account JSON)');
  }
} catch (e) {
  console.log('ℹ️ Skipping Firebase init (invalid JSON). We can fix later.');
}

// 3) SQLite init
const db = await open({ filename: 'signals.db', driver: sqlite3.Database });
await db.exec(`
  CREATE TABLE IF NOT EXISTS signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet TEXT,
    token TEXT,
    tx TEXT,
    action TEXT,
    time TEXT,
    liquidity REAL,
    raw JSON
  )
`);
console.log('✅ SQLite ready');

// 4) Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    firebase: !!messaging,
    time: new Date().toISOString()
  });
});

// 5) Manual test push (only works once FCM token is set)
app.post('/test/push', async (req, res) => {
  if (!messaging)
    return res.status(400).json({ ok: false, msg: 'Firebase not initialized' });
  const token = process.env.FCM_DEVICE_TOKEN;
  if (!token)
    return res.status(400).json({ ok: false, msg: 'FCM_DEVICE_TOKEN missing' });

  await messaging.send({
    token,
    notification: {
      title: 'Test signal',
      body: 'If you see this on your phone, FCM works!'
    }
  });
  res.json({ ok: true });
});

// 6) Main Helius webhook endpoint
app.post('/hel', async (req, res) => {
  try {
    const body = req.body || {};
    console.log(`📩 Webhook received @ ${new Date().toISOString()}`);

    await db.run(
      `INSERT INTO signals(wallet, token, tx, action, time, raw)
       VALUES (?, ?, ?, ?, ?, json(?))`,
      'unknown',
      'unknown',
      'helius',
      'NEW',
      new Date().toISOString(),
      JSON.stringify(body)
    );

    console.log('✅ Webhook saved to database');
    res.sendStatus(200);
  } catch (e) {
    console.error('❌ Webhook error:', e.message);
    res.sendStatus(500);
  }
});

// 7) Catch-all fallback (useful for debugging)
app.use((req, res) => {
  res.status(404).json({ ok: false, msg: 'Endpoint not found' });
});

// 8) Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Server running and listening on http://localhost:${PORT}`)
);

