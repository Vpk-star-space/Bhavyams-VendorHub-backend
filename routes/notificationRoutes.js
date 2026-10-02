const express = require('express');
const router = express.Router();
const webpush = require('web-push');
const admin = require('firebase-admin');
const pool = require('../db');
const { protect } = require('../middleware/authMiddleware');

// Setup WebPush VAPID
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        process.env.VAPID_EMAIL || 'mailto:pavanvenkat63@gmail.com',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
}

// Auto-create Tables
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
    } catch (err) {
        console.error("Push DB Init Note:", err.message);
    }
};
initPushDB();

// 1. GET PUBLIC VAPID KEY (Web users)
router.get('/vapid-key', (req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// 2. SAVE WEB PUSH SUBSCRIPTION
router.post('/subscribe', protect, async (req, res) => {
    try {
        const { endpoint, keys } = req.body;
        const userId = req.user.id;

        if (!endpoint || !keys?.p256dh || !keys?.auth) {
            return res.status(400).json({ message: "Invalid subscription payload." });
        }

        await pool.query(`
            INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (endpoint) 
            DO UPDATE SET user_id = $1, p256dh = $3, auth = $4
        `, [userId, endpoint, keys.p256dh, keys.auth]);

        res.json({ success: true, message: "Web push subscription saved." });
    } catch (err) {
        console.error("Web Push Subscription Error:", err);
        res.status(500).json({ message: "Failed to register web subscription." });
    }
});

// 3. SAVE ANDROID NATIVE FCM TOKEN
router.post('/register-fcm', protect, async (req, res) => {
    try {
        const { fcmToken } = req.body;
        const userId = req.user.id;

        if (!fcmToken) return res.status(400).json({ message: "FCM token is required." });

        await pool.query(`
            INSERT INTO fcm_tokens (user_id, token) 
            VALUES ($1, $2)
            ON CONFLICT (user_id) 
            DO UPDATE SET token = $2, updated_at = CURRENT_TIMESTAMP
        `, [userId, fcmToken]);

        res.json({ success: true, message: "Android FCM Token registered." });
    } catch (err) {
        console.error("FCM Token Error:", err);
        res.status(500).json({ message: "Failed to register FCM token." });
    }
});

// Helper: Dispatch WebPush
const sendPushToUser = async (userId, payload) => {
    try {
        const subs = await pool.query('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1', [userId]);
        if (subs.rows.length === 0) return 0;

        const stringifiedPayload = JSON.stringify(payload);
        let deliveredCount = 0;

        for (const sub of subs.rows) {
            const pushConfig = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
            const options = { urgency: 'high', TTL: 60 * 60 };

            try {
                await webpush.sendNotification(pushConfig, stringifiedPayload, options);
                deliveredCount++;
            } catch (error) {
                if (error.statusCode === 410 || error.statusCode === 404) {
                    await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint]);
                }
            }
        }
        return deliveredCount;
    } catch (err) {
        return 0;
    }
};

// Helper: Dispatch Android Truecaller-Style Alert
const sendTruecallerAlert = async (userId, callDetails) => {
    try {
        if (!admin.apps.length) return false;

        const result = await pool.query('SELECT token FROM fcm_tokens WHERE user_id = $1', [userId]);
        if (result.rows.length === 0) return false;

        const fcmToken = result.rows[0].token;

        const message = {
            token: fcmToken,
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
    } catch (err) {
        return false;
    }
};
// 🟢 TEMPORARY OPEN TEST ROUTE (FIXED)
router.post('/test-trigger-alert', async (req, res) => {
    try {
        const { fcmToken } = req.body;
        if (!fcmToken) return res.status(400).json({ message: "No token provided." });

        // ❌ The broken admin.apps.length check was deleted from here!

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

        await admin.messaging().send(message);
        res.json({ success: true, message: "Pinged phone directly!" });
    } catch (err) {
        console.error("Test failure:", err);
        // This will cleanly catch any real Firebase errors and send them to your phone
        res.status(500).json({ message: "Test failed", error: err.message });
    }
});
module.exports = { router, sendPushToUser, sendTruecallerAlert };