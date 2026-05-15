const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect } = require('../middleware/authMiddleware');

// 🧠 The "Self-Aware" Chat Route
router.post('/chat', protect, async (req, res) => {
    const { message, orderId } = req.body;

    try {
        // 1. 🕵️ GET REAL-TIME DATA
        const orderRes = await pool.query(
            `SELECT o.status, o.created_at, o.delivery_minutes, p.name 
             FROM orders o 
             JOIN products p ON o.product_id = p.id 
             WHERE o.id = $1`, 
            [orderId]
        );

        if (orderRes.rows.length === 0) {
            return res.json({ reply: "I can't find that order ID in the database." });
        }

        const order = orderRes.rows[0];
        
        // 2. 🕒 CALCULATE "SIMULATION TIME"
        const orderTime = new Date(order.created_at);
        const currentTime = new Date();
        const diffMs = currentTime - orderTime;
        const minutesPassed = Math.floor(diffMs / 60000); // Minutes since order
        const expectedDelivery = order.delivery_minutes || 6;
        const isLate = minutesPassed > expectedDelivery;

        // 3. 🧠 THE BRAIN: Match User Questions to System Reality
        const lowerMsg = message.toLowerCase();
        let reply = "";

        // --- SCENARIO A: User asks about DELAY or TIME ---
        if (lowerMsg.includes("late") || lowerMsg.includes("time") || lowerMsg.includes("where") || lowerMsg.includes("wait") || lowerMsg.includes("status")) {
            if (isLate) {
                reply = `⚠️ **System Alert:** I noticed this order is **${minutesPassed - expectedDelivery} minutes overdue**.\n\n` +
                        `**Why?** Since this project runs on a **Free Render Server**, the server likely went into 'Sleep Mode' to save resources, pausing the background email timer.\n\n` +
                        `**Fix:** By chatting with me, you have woken up the server! Please check your email (and Spam folder) in 1 minute.`;
            } else {
                reply = `⏳ **Simulation Status:** You are within the ${expectedDelivery}-minute demo window.\n\n` +
                        `In a real app, this would take 3 days. In this project, we simulate delivery by sending an email in **${expectedDelivery - minutesPassed} minutes**.`;
            }
        }

        // --- SCENARIO B: User asks "IS THIS REAL?" ---
        else if (lowerMsg.includes("real") || lowerMsg.includes("fake") || lowerMsg.includes("scam") || lowerMsg.includes("money")) {
            reply = `🎓 **Developer Note:** This is a **Capstone Project** engineered by **A. Venkata Pavan Kumar**.\n\n` +
                    `No physical items are shipped. The payment gateway is in **Test Mode**, so no real money is moved (or it is auto-refunded). It demonstrates full-stack capabilities like Concurrency Handling and JWT Auth.`;
        }

        // --- SCENARIO C: User asks about EMAILS ---
        else if (lowerMsg.includes("email") || lowerMsg.includes("mail") || lowerMsg.includes("message")) {
            reply = `📨 **Mail Server Log:** The system is configured to send emails via **Brevo SMTP**.\n\n` +
                    `1. **Order Confirmation:** Sent immediately.\n` +
                    `2. **Delivery Notification:** Scheduled for T+${expectedDelivery} minutes.\n\n` +
                    `If you didn't get them, Google might have flagged the 'Test' subject line as Spam. Please check there!`;
        }

        // --- DEFAULT: Friendly Fallback ---
        else {
            reply = `I am the **System Architect AI**. I monitor the database state directly.\n\n` +
                    `Current Status of **${order.name}**: [${order.status.toUpperCase()}]\n` +
                    `Server Uptime: Active\n\n` +
                    `Ask me: *"Why is it late?"*, *"Is this real?"*, or *"Where is the email?"*`;
        }

        res.json({ reply });

    } catch (err) {
        console.error(err);
        res.status(500).json({ reply: "❌ System Error: My brain logic crashed. Please check backend logs." });
    }
});

module.exports = router;
