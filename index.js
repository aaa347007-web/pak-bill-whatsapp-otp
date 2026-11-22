const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');

const app = express();
app.use(cors());
app.use(express.json());

// Apni marzi ki secret key (isay app mein bhi likhenge taake koi aur aap ka bot use na kar sake)
const API_SECRET = process.env.OTP_SECRET || 'pakbill2026secret';

let sock = null;
let latestQrDataUrl = null;
let connectionStatus = 'starting'; // 'starting' | 'qr' | 'connected'

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_session');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    auth: state,
    browser: ['Pak Bill Manager', 'Chrome', '1.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      connectionStatus = 'qr';
      latestQrDataUrl = await QRCode.toDataURL(qr);
      console.log('New QR code generated — open browser URL to scan!');
    }

    if (connection === 'open') {
      connectionStatus = 'connected';
      latestQrDataUrl = null;
      console.log('WhatsApp Connected Successfully!');
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      connectionStatus = 'starting';
      console.log('Connection closed. Reconnecting:', shouldReconnect);
      if (shouldReconnect) {
        setTimeout(startWhatsApp, 3000);
      }
    }
  });
}

// Home Page: QR Code Scan & Status Screen
app.get('/', (req, res) => {
  if (connectionStatus === 'connected') {
    return res.send(`
      <html>
        <body style="font-family:sans-serif;text-align:center;padding:40px;background:#f0fdf4;">
          <h1 style="color:#15803d;">WhatsApp OTP Bot Connected!</h1>
          <p>Pak Bill Manager ab khud-ba-khud WhatsApp par 6-Digit OTP bhej sakta hai.</p>
        </body>
      </html>
    `);
  }

  if (connectionStatus === 'qr' && latestQrDataUrl) {
    return res.send(`
      <html>
        <head><meta http-equiv="refresh" content="15"></head>
        <body style="font-family:sans-serif;text-align:center;padding:30px;background:#f8fafc;">
          <h2>Pak Bill Manager — WhatsApp Link Karein</h2>
          <p>Apne WhatsApp mein <b>Linked Devices -> Link a Device</b> khol kar yeh QR scan karein:</p>
          <img src="${latestQrDataUrl}" style="width:280px;height:280px;border:8px solid #fff;border-radius:16px;box-shadow:0 4px 12px rgba(0,0,0,0.1);" />
          <p style="color:#64748b;font-size:13px;">Page har 15 second baad khud refresh hoga...</p>
        </body>
      </html>
    `);
  }

  return res.send(`
    <html>
      <head><meta http-equiv="refresh" content="5"></head>
      <body style="font-family:sans-serif;text-align:center;padding:40px;">
        <h3>QR Code tayyar ho raha hai, 5 second intezar karein...</h3>
      </body>
    </html>
  `);
});

// Send 6-Digit WhatsApp OTP Endpoint
app.post('/send-otp', async (req, res) => {
  try {
    const { phone, otp, secret } = req.body || {};

    if (secret !== API_SECRET) {
      return res.status(401).json({ ok: false, error: 'Unauthorized request' });
    }
    if (!phone || !otp) {
      return res.status(400).json({ ok: false, error: 'Phone aur OTP zaroori hain' });
    }
    if (connectionStatus !== 'connected' || !sock) {
      return res.status(503).json({
        ok: false,
        error: 'WhatsApp server abhi connect nahi hai. Admin pehle QR scan karein.',
      });
    }

    // Format Pakistani number 03001234567 -> 923001234567@s.whatsapp.net
    let digits = String(phone).replace(/\D/g, '');
    if (digits.startsWith('0')) digits = '92' + digits.slice(1);
    const jid = `${digits}@s.whatsapp.net`;

    // Check if number is registered on WhatsApp
    const [exists] = await sock.onWhatsApp(jid);
    if (!exists || !exists.exists) {
      return res.status(404).json({
        ok: false,
        error: 'Is mobile number par WhatsApp account maujood nahi hai.',
      });
    }

    const message =
      `*Pak Bill Manager — PIN Recovery*\n\n` +
      `Aap ka 6-hindso wala verification code yeh hai:\n\n` +
      `*${otp}*\n\n` +
      `_Yeh code 5 minute tak valid hai. Kisi ke saath share na karein._`;

    await sock.sendMessage(jid, { text: message });
    return res.json({ ok: true });
  } catch (err) {
    console.error('OTP send error:', err);
    return res.status(500).json({ ok: false, error: 'WhatsApp par code bhejne mein masla aaya.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startWhatsApp();
});
    
