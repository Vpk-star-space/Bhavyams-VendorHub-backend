const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect } = require('../middleware/authMiddleware');

// 🧠 Subhams Assured Support AI Route
router.post('/chat', protect, async (req, res) => {
    const { message, orderId } = req.body;

    try {
        // 1. 🕵️ GET REAL-TIME DATA FROM DATABASE
        const orderRes = await pool.query(
            `SELECT o.status, o.created_at, o.total_price, p.name 
             FROM orders o 
             JOIN products p ON o.product_id = p.id 
             WHERE o.id = $1`, 
            [orderId]
        );

        if (orderRes.rows.length === 0) {
            return res.json({ reply: "I can't find that order ID in our secure database." });
        }

        const order = orderRes.rows[0];
        const lowerMsg = message.toLowerCase();
        let reply = "";

        // 2. 🧠 THE BRAIN: Professional Flipkart-Style Responses

        // --- GREETING ---
        if (lowerMsg === "hi" || lowerMsg === "hello" || lowerMsg === "hey") {
            reply = `Hello! I am **Subhams Support AI**.\n\nI am currently looking at your order for the **${order.name}**. How can I help you today?`;
        }
        
        // --- PRICE & INVOICE ---
        else if (lowerMsg.includes("price") || lowerMsg.includes("cost") || lowerMsg.includes("much") || lowerMsg.includes("bill") || lowerMsg.includes("invoice")) {
            reply = `The total amount paid for your **${order.name}** is **₹${order.total_price}**.\n\nYou can easily download your official Tax Invoice by clicking the 'Download Invoice' button on the right side of your screen.`;
        }

        // --- STATUS & TRACKING ---
        else if (lowerMsg.includes("status") || lowerMsg.includes("where") || lowerMsg.includes("track") || lowerMsg.includes("reach")) {
            reply = `Your current order status is: **${order.status.toUpperCase()}**.\n\n` + 
                    (order.status === 'Delivered' 
                        ? `This item has already been successfully delivered to your address! We hope you love it.` 
                        : `Our logistics partners are working hard to get this to you. Please check the green tracking timeline above for live updates!`);
        }

        // --- DELAYS & LATE DELIVERY ---
        else if (lowerMsg.includes("late") || lowerMsg.includes("delay") || lowerMsg.includes("when") || lowerMsg.includes("time")) {
            if (order.status === 'Delivered') {
                reply = `According to our records, this item has already been delivered! If you haven't received it, please check with your neighbors or security guard.`;
            } else {
                reply = `I understand you are waiting for your order. 🚚\n\nSometimes, deliveries take a little extra time due to local hub sorting. Rest assured, your **${order.name}** is safe and is being prioritized for delivery!`;
            }
        }

        // --- REFUNDS, CANCEL & RETURNS ---
        else if (lowerMsg.includes("cancel") || lowerMsg.includes("refund") || lowerMsg.includes("return") || lowerMsg.includes("exchange")) {
            if (order.status === 'Delivered') {
                reply = `**Return Policy:**\nSince this order is delivered, you have a 7-day return window.\n\nTo initiate a return, please contact the vendor directly. Once approved, the refund of **₹${order.total_price}** will be credited to your original payment method in 3-5 business days.`;
            } else {
                reply = `**Cancellation Policy:**\nYou can cancel this order before it is shipped. If cancelled, an instant refund of **₹${order.total_price}** will be initiated automatically.`;
            }
        }

        // --- WARRANTY & DAMAGE ---
        else if (lowerMsg.includes("warranty") || lowerMsg.includes("guarantee") || lowerMsg.includes("damage") || lowerMsg.includes("broken")) {
            reply = `We are sorry to hear that! 🛡️\n\nAll items sold on Bhavyams Hub are covered by our Assured Quality Guarantee. If your item is damaged or defective, please request a replacement within 7 days of delivery.`;
        }

        // --- CONTACT VENDOR / HUMAN ---
        else if (lowerMsg.includes("contact") || lowerMsg.includes("vendor") || lowerMsg.includes("seller") || lowerMsg.includes("human") || lowerMsg.includes("customer care")) {
            reply = `Need to speak to someone? 📞\n\nSeller: **Bhavyams Vendor Hub**\n\nYou can reach out to our official support team at support@bhavyamshub.com for further assistance with this order.`;
        }

        // --- DEVELOPER / PROJECT EASTER EGG ---
        else if (lowerMsg.includes("real") || lowerMsg.includes("fake") || lowerMsg.includes("project")) {
            reply = `This is a highly advanced, full-stack e-commerce system engineered by **A. Venkata Pavan Kumar**!\n\nWhile this interface behaves exactly like a real platform, it is currently running in test mode.`;
        }

        // --- DEFAULT FALLBACK ---
        else {
            reply = `I am **Subhams Support AI**. 🤖\n\nI can help you with details about your **${order.name}**. Try asking me:\n- *"What is the status?"*\n- *"How much did I pay?"*\n- *"How do I get a refund?"*`;
        }

        // Send the reply back to the frontend
        res.json({ reply });

    } catch (err) {
        console.error(err);
        res.status(500).json({ reply: "⚠️ We are experiencing heavy traffic. Please try asking your question again in a moment." });
    }
});

module.exports = router;