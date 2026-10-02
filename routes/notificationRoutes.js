const express = require('express');
const router = express.Router();
const webpush = require('web-push');
const admin = require('firebase-admin');
const pool = require('../db');
const fs = require('fs');
const path = require('path');
const { protect } = require('../middleware/authMiddleware');

// 🟢 1. BULLETPROOF FIREBASE INITIALIZATION
if (!admin.apps || admin.apps.length === 0) {
    try {
        if (process.env.FIREBASE_CREDENTIALS) {
            admin.initializeApp({
                credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_CREDENTIALS))
            });
        } else {
            const keyPath = path.join(__dirname, '../serviceAccountKey.json');
            if (fs.existsSync(keyPath)) {
                admin.initializeApp({
                    credential: admin.credential.cert(require(keyPath))
                });
            }
        }
    } catch (e) {
        console.error("Firebase Init Error:", e.message);
    }
}

// 🟢 2. WEBPUSH INITIALIZATION
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        process.env.VAPID_EMAIL || 'mailto:pavanvenkat63@gmail.com',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
}

// 🟢 3. DATABASE INITIALIZATION
const initPushDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                endpoint TEXT UNIQUE NOT NULL,
                p256dh TEXT NOT NULL,
                auth TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS fcm_tokens (
                user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                token TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
    } catch (err) { console.error("Push DB Init Note:", err.message); }
};
initPushDB();

// 🟢 4. STANDARD ROUTES
router.get('/vapid-key', (req, res) => res.json({ publicKey: process.env.VAPID_PUBLIC_KEY }));

router.post('/subscribe', protect, async (req, res) => {
    try {
        const { endpoint, keys } = req.body;
        if (!endpoint || !keys?.p256dh || !keys?.auth) return res.status(400).json({ message: "Invalid payload." });

        await pool.query(`
            INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)
            ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4
        `, [req.user.id, endpoint, keys.p256dh, keys.auth]);

        res.json({ success: true });
    } catch (err) { res.status(500).json({ message: "Failed." }); }
});

router.post('/register-fcm', protect, async (req, res) => {
    try {
        const { fcmToken } = req.body;
        if (!fcmToken) return res.status(400).json({ message: "FCM token is required." });

        await pool.query(`
            INSERT INTO fcm_tokens (user_id, token) VALUES ($1, $2)
            ON CONFLICT (user_id) DO UPDATE SET token = $2, updated_at = CURRENT_TIMESTAMP
        `, [req.user.id, fcmToken]);

        res.json({ success: true });
    } catch (err) { res.status(500).json({ message: "Failed." }); }
});

// 🟢 5. DISPATCH HELPERS
const sendPushToUser = async (userId, payload) => {
    try {
        const subs = await pool.query('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1', [userId]);
        if (subs.rows.length === 0) return 0;

        const stringifiedPayload = JSON.stringify(payload);
        let deliveredCount = 0;

        for (const sub of subs.rows) {
            try {
                await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, stringifiedPayload, { urgency: 'high', TTL: 3600 });
                deliveredCount++;
            } catch (error) {
                if (error.statusCode === 410 || error.statusCode === 404) {
                    await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint]);
                }
            }
        }
        return deliveredCount;
    } catch (err) { return 0; }
};

const sendTruecallerAlert = async (userId, callDetails) => {
    try {
        if (!admin.apps || admin.apps.length === 0) return false;

        const result = await pool.query('SELECT token FROM fcm_tokens WHERE user_id = $1', [userId]);
        if (result.rows.length === 0) return false;

        const message = {
            token: result.rows[0].token,
            android: {
                priority: 'high',
                notification: {
                    channelId: 'subhams-urgent-alerts',
                    title: callDetails.callerName || 'Subhams Hub Alert',
                    body: callDetails.type === 'voice_call' ? '📞 Incoming order call... Tap to answer.' : '💬 New urgent message received.',
                    visibility: 'public',
                    defaultVibrateTimings: true,
                    defaultSound: true
                }
            },
            data: {
                action: 'INCOMING_CALL',
                roomId: String(callDetails.roomId || ''),
                callerName: String(callDetails.callerName || ''),
                type: String(callDetails.type || 'alert')
            }
        };

        await admin.messaging().send(message);
        return true;
    } catch (err) { return false; }
};

// 🟢 GUARANTEED TEST ROUTE (Modern Firebase Modular Syntax)
router.post('/test-trigger-alert', async (req, res) => {
    try {
        const { fcmToken } = req.body;
        if (!fcmToken) return res.status(400).json({ message: "No token provided." });

        // 1. USE MODERN V12+ MODULAR FIREBASE IMPORTS
        const { initializeApp, cert, getApps } = require('firebase-admin/app');
        const { getMessaging } = require('firebase-admin/messaging');

        const serviceAccount = {
            "project_id": "bhavyams-vendorhub",
            "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDTgAgt4XGDmmgn\nhi0tQ2s7N00XYwrYpwzyPmT8+GmpiRzO+F1lzksPdBdW23admDMGwnz9G6Q1NpgN\njurNqo7YIZZRj4sGkeY0bWO6ToKmOtXvi8/WOQjZRZiWB7lU2xCeNz5f7OJYAmiD\nbexN1ri7iKpPWmYR+XRub1UIwPvW66zNGHsfP+FHfF8BsN2RbOIIg3TWYcNoEFyF\nFUQxsIgHJ0wC+n4sNFI1K/WdIsvfCb37ASE95yK5swUUmqVt2D2E5+eh1tkEBLKV\ngHWu6FfW3WGNBzNhTofPJG3SZ9V5HVpzu376veKMFpaOh45Zd4CDguNxY9Qyi0d5\nWxh5U6CzAgMBAAECggEAJdMBY3csjl0oYF0qKiyi+kGfG14em/VwJsiK1gT1HJlF\nWixnw6O7n8ViwSlZksCb64sPwFJXsR6U3ePf0S0+A6AqGmcB9YhVM64WhkSxL9pY\n1VDbOBQWJYlBSx+RgP/2fl0h3hTmu9eealbXymnqursrvipME83ZiUCG5BxjTaGf\n8P5K/h0PX7lUuaTAunms/aMW20N0Hn3I+ICSJD8GBo98Kq7cGJ3fBUE4oSEV1WLb\n3PFutBjiRZyIbpJu+Bq+crDje1Ae8Q16OoIA70b7fq414DvvwK84WxCnrcbcBIM8\nYS4m0D/rd41ZVmdh7nSc5WjS7iq8JGiokAZ3CDRn6QKBgQD3WnBWgwFDKh2N4LCs\nxkM3FWsiWkDyDgEvBLIigMrei8IyaQoc3mxvdAwbh8rdRaM8r3rtgGnfOLTJUxXx\nS/hcm7s1yZ+LALh943AZqFEHDaVmrHuhLOmiys1/yGwfLhS1K/NX9UITDN5drfAV\nbM3Z00MA5We8HJcPmXp4TvHeCQKBgQDa5L5mf71S4moF45TRWYVDY7YC3OG9jZvR\n1cGNPs/3iGbSEJs7zS+yuI6ayc8U0s7fOGJVj97HzSkhW4TSp+HESckftLAKykUR\neb0ycXdVNJnJnRF2msS8mlb6p38biK1vfDaK2k7Ed6IuM7IqvorNbMZLK6hYRsZ+\nFPP8xbD32wKBgQDZTIRAHBqxzH/mMixDvHE0JQbXSP6hJxh3G+L6WLbgR1s1Of3+\nWpBcYVB5pxPay+CZ4XdWymc4CPMZono2Xw0zHkSa/iPA08NAJNxITgvQ7HYP+xso\n/vHJZ+ycg5Ao3Cyo9JF1Bisj3TxEhBfUWp+E6wmD8gTtxxgWRjjHFGN7MQKBgDG+\n9n543V/u0MWR2QpS2/Ravsybwjm/6v+fIqOk+MJ6n1NyLrVChmqJgu8umf9TgWw9\ndiuXzLt/pq9MCz2MpcRkOG8aMz/ghB3amuLR4prcn26wYX2g4sEyGj5QvpRVVYUW\np5aa0nfX8GWrnfwU3Zqd89q1i0a0nvuca26wxu0tAoGAY5P+cn+Jo0QlseRsf94+\nl00Pfe8NspcBMdhfDn0Qm56uvjhvQ+8PjIXJKrLODJ3+9KVEUoZTBGyP/WzFFB/n\nWf+YKOcy24ktdDH3aTJOSoyVP5yjjAMQB5QsNqAA7V+zZE6+vtCvF2Z9P6Uvlhn/\nwwmWZcz9bmLQ668ej4xPDRI=\n-----END PRIVATE KEY-----\n",
            "client_email": "firebase-adminsdk-fbsvc@bhavyams-vendorhub.iam.gserviceaccount.com"
        };

        // 2. INIT FIREBASE IF NOT ALREADY DONE
        let app;
        if (getApps().length === 0) {
            app = initializeApp({ credential: cert(serviceAccount) });
        } else {
            app = getApps()[0];
        }

        // 3. SEND THE TRUECALLER ALERT
        const message = {
            token: fcmToken,
            android: {
                priority: 'high',
                notification: {
                    channelId: 'subhams-urgent-alerts',
                    title: "Subhams Hub Urgent Alert",
                    body: "📞 Incoming order call... Tap to answer.",
                    visibility: 'public',
                    defaultVibrateTimings: true,
                    defaultSound: true
                }
            },
            data: {
                action: 'INCOMING_CALL',
                roomId: "test-123",
                callerName: "System Test",
                type: "voice_call"
            }
        };

        await getMessaging(app).send(message);
        res.json({ success: true, message: "Pinged phone directly!" });
    } catch (err) {
        console.error("Test failure:", err);
        res.status(500).json({ message: "Test failed", error: err.message });
    }
});
module.exports = { router, sendPushToUser, sendTruecallerAlert };