const express = require('express');
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState, makeInMemoryStore, fetchLatestBaileysVersion, delay } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.json());

let store = makeInMemoryStore({
    logger: pino().child({ level: 'silent', stream: 'store' })
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

let currentQRCode = null;

// Endpoint untuk memulai QR Code atau pairing
app.post('/start', async (req, res) => {
    const { method, number } = req.body;

    try {
        if (method === 'qr') {
            currentQRCode = await generateQRCode();
            res.json({ qrCode: currentQRCode });
        } else if (method === 'pair' && number) {
            const sessionId = await Leon(false, number); // Ambil session ID dari fungsi Leon
            res.json({ message: `Pairing with number: ${number}`, sessionId });
        } else {
            res.status(400).json({ error: 'Invalid method or missing number.' });
        }
    } catch (error) {
        res.status(500).json({ error: 'An error occurred.' });
    }
});

// Fungsi untuk menghasilkan QR Code
async function generateQRCode() {
    let { version } = await fetchLatestBaileysVersion();
    let { state, saveCreds } = await useMultiFileAuthState('./');
    let sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        markOnlineOnConnect: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        auth: state,
        version: version,
    });
    store.bind(sock.ev);

    sock.ev.on('connection.update', async (update) => {
        let { connection } = update;
        if (connection === 'open') {
            await delay(3000);
            let creds = fs.readFileSync('./creds.json', 'utf8');
            let session = Buffer.from(creds, 'utf8').toString('base64');
            console.log(`Session: ${session}`);
            process.exit(1);
        } else if (connection === 'close') {
            // Jika koneksi ditutup, mulai ulang QR Code
            await generateQRCode();
        }
    });

    // Menghasilkan QR Code
    sock.ev.on('connection.update', async (update) => {
        if (update.qr) {
            const qrCode = await QRCode.toDataURL(update.qr);
            currentQRCode = qrCode;

            // Set timeout untuk regenerasi QR Code setiap 30 detik
            setTimeout(() => {
                generateQRCode(); // Regenerate QR every 30 seconds
            }, 30000);
        }
    });

    return currentQRCode;
}

async function Leon(qr, number) {
    let { version } = await fetchLatestBaileysVersion();
    let { state, saveCreds } = await useMultiFileAuthState('./');
    let sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        markOnlineOnConnect: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        auth: state,
        version: version,
    });
    store.bind(sock.ev);

    if (!qr && !sock.authState.creds.registered) {
        try {
            await delay(3000);
            var code = await sock.requestPairingCode(number.replace(/\D/g, ''));
            console.log(`Pairing code for ${number}: ${code}`);
            return code; // Return pairing code
        } catch {
            console.error('Invalid WhatsApp number.');
        }
    }

    sock.ev.on('connection.update', async (update) => {
        let { connection } = update;
        if (connection === 'open') {
            await delay(3000);
            let creds = fs.readFileSync('./creds.json', 'utf8');
            let session = Buffer.from(creds, 'utf8').toString('base64');
            console.log(`Session: ${session}`);
            return session; // Mengembalikan session ID
        } else if (connection === 'close') {
            await Leon(qr, number);
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});