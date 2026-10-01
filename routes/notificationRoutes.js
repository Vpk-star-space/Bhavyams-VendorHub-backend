const express = require('express');
const router = express.Router();
const webpush = require('web-push');
const pool = require('../db');
const { protect } = require('../middleware/authMiddleware');

// 🟢 Setup WebPush with VAPID Keys
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        process.env.VAPID_EMAIL || 'mailto:pavanvenkat63@gmail.com',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
}

// 🟢 Auto-create Push Subscriptions Table
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
    } catch (err) {
        console.error("Push DB Init Note:", err.message);
    }
};
initPushDB();

// 🟢 1. GET PUBLIC VAPID KEY (Frontend fetches this to register browser)
router.get('/vapid-key', (req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// 🟢 2. SAVE DEVICE SUBSCRIPTION
router.post('/subscribe', protect, async (req, res) => {
    try {
        const { endpoint, keys } = req.body;
        const userId = req.user.id;

        if (!endpoint || !keys?.p256dh || !keys?.auth) {
            return res.status(400).json({ message: "Invalid subscription payload." });
        }

        // Insert or update device subscription
        await pool.query(`
            INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (endpoint) 
            DO UPDATE SET user_id = $1, p256dh = $3, auth = $4
        `, [userId, endpoint, keys.p256dh, keys.auth]);

        res.json({ success: true, message: "Device registered for push notifications." });
    } catch (err) {
        console.error("Push Subscription Error:", err);
        res.status(500).json({ message: "Failed to register device." });
    }
});

// 🟢 3. TEST NOTIFICATION TRIGGER (Test if user's phone pops up)
router.post('/test', protect, async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await sendPushToUser(userId, {
            title: "🔔 Subhams Hub Test Alert",
            body: "Mobile background popup connection is working perfectly!",
            url: "/"
        });

        res.json({ success: true, delivered: result });
    } catch (err) {
        console.error("Push Test Error:", err);
        res.status(500).json({ message: "Failed to send notification." });
    }
});

// 🟢 REUSABLE FUNCTION: Call this from orders, chat, or admin warnings
const sendPushToUser = async (userId, payload) => {
    try {
        const subs = await pool.query(
            'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
            [userId]
        );

        if (subs.rows.length === 0) return 0;

        const stringifiedPayload = JSON.stringify(payload);
        let deliveredCount = 0;

    for (const sub of subs.rows) {
            const pushConfig = {
                endpoint: sub.endpoint,
                keys: {
                    p256dh: sub.p256dh,
                    auth: sub.auth
                }
            };

            // 🟢 YOU MISSED THIS PART: Tell Android this is an urgent alarm!
            const options = {
                urgency: 'high',
                TTL: 60 * 60 // Keep alive for 1 hour
            };

            try {
                // 🟢 Notice we pass 'options' as the third thing here!
                await webpush.sendNotification(pushConfig, stringifiedPayload, options);
                deliveredCount++;
            } catch (error) {
                // Remove expired/invalid endpoints
                if (error.statusCode === 410 || error.statusCode === 404) {
                    await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint]);
                }
            }
        }
        return deliveredCount;
    } catch (err) {
        console.error("sendPushToUser error:", err);
        return 0;
    }
};

module.exports = {
    router,
    sendPushToUser
};