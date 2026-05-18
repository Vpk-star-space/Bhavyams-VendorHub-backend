const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect } = require('../middleware/authMiddleware');

// 🧠 Subhams Assured Support AI Route
router.post('/chat', protect, async (req, res) => {
    const { message, orderId } = req.body;
    const lowerMsg = message.toLowerCase().trim();
    let reply = "";

    try {
        // 🚀 THE EASTER EGG
        if (lowerMsg.includes("real") || lowerMsg.includes("fake") || lowerMsg.includes("project") && !lowerMsg.includes("other projects")) {
            return res.json({ reply: `🎓 **Developer Note:** This is a highly advanced, full-stack e-commerce system engineered by **A. Venkata Pavan Kumar**!\n\nWhile this interface behaves exactly like a real platform, it is currently running in test mode.` });
        }

        // 🌐 GLOBAL MODE
        if (!orderId || orderId === "Unknown") {
            const potentialId = lowerMsg.match(/\d+/);
            if (potentialId) {
                 return res.json({ reply: `Thanks! I see Order ID #${potentialId[0]}. However, for security reasons, please open that specific order from your **My Orders** dashboard to view its details.` });
            }
            if (lowerMsg.includes("hi") || lowerMsg.includes("hello")) {
                return res.json({ reply: `Hello! I am **Subhams Support AI**.\n\nDo you need help with a specific order? Please navigate to **My Orders** and click on the order to get detailed help!` });
            }
            return res.json({ reply: `I am **Subhams Support AI**. To help you best, please navigate to **My Orders** and click on the specific order you need help with!` });
        }

        // 🕵️ GET REAL-TIME DATA FROM DATABASE
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

        // 2. 🧠 THE BRAIN RESPONSES
        
        // --- TRACKING ---
        if (lowerMsg === "track order status" || lowerMsg.includes("track") || lowerMsg.includes("where is my order") || (lowerMsg.includes("order") && lowerMsg.includes("status"))) {
            const isDelivered = order.status.toLowerCase() === 'delivered';
            reply = `**Live Tracking Update:**\n\n📦 Ordered  ➔  🚚 Shipped  ➔  ${isDelivered ? '✅ **Delivered**' : '⏳ **Pending**'}\n\nCurrent Status: **[${order.status.toUpperCase()}]**\n\nOur logistics system shows everything is on track!`;
        }
        // --- INVOICE ---
        else if (lowerMsg === "where is my invoice?" || lowerMsg.includes("invoice") || lowerMsg.includes("bill") || lowerMsg.includes("price") || lowerMsg.includes("cost")) {
            reply = `Your total payment for this order was **₹${order.total_price}**.\n\n💳 **Need the official receipt?**\nYou can securely download your GST Tax Invoice by closing this chat and clicking the blue "Download Invoice" button on the main page.`;
        }
        // --- CANCEL ---
        else if (lowerMsg === "cancel this order" || lowerMsg.includes("cancel") || lowerMsg.includes("stop order")) {
            if (order.status.toLowerCase() === 'delivered') {
                reply = `**Action Denied:**\nBecause this order is already delivered, it cannot be cancelled. \n\nHowever, you are eligible for a return! Please select the Return Policy option for the next steps.`;
            } else {
                reply = `**Cancellation Policy:**\nYou are eligible to cancel this order before it leaves our warehouse. If you proceed, an automated refund of **₹${order.total_price}** will be credited to your bank account within 3-5 business days.`;
            }
        }
        // --- RETURN ---
        else if (lowerMsg === "return / replace item" || lowerMsg.includes("return") || lowerMsg.includes("refund") || lowerMsg.includes("replace") || lowerMsg.includes("damage") || lowerMsg.includes("broken")) {
            reply = `🛡️ **Bhavyams Assured Guarantee:**\n\nIf your item is damaged, defective, or incorrect, you can request a hassle-free return or replacement within **7 days** of delivery. \n\nYour refund of ₹${order.total_price} is fully secured by our system.`;
        }
        // --- DELAY ---
        else if (lowerMsg === "delivery is delayed" || lowerMsg.includes("delay") || lowerMsg.includes("late") || lowerMsg.includes("not received")) {
            if (order.status.toLowerCase() === 'delivered') {
                reply = `Our system shows this item was already handed over to you! If you haven't received it, please verify with your security desk or neighbors immediately.`;
            } else {
                reply = `I apologize for the wait! 🚚💨\n\nSometimes our delivery agents face local routing delays. I have automatically escalated Order **#${orderId}** to our high-priority dispatch queue.`;
            }
        }
        // --- CONTACT ADMIN ---
        else if (lowerMsg === "contact human admin" || lowerMsg.includes("contact") || lowerMsg.includes("admin") || lowerMsg.includes("human") || lowerMsg.includes("mail") || lowerMsg.includes("email") || lowerMsg.includes("support")) {
            reply = `I understand you need to speak with our human support team. 🎧\n\nPlease click the button below to email our administration. **Our admin team will contact you back within a few hours!**\n\n<a href="mailto:venkatapavankumar36@gmail.com?subject=Support%20Request%20for%20Order%20%23${orderId}" style="display: block; margin: 12px 0; padding: 12px 16px; background-color: #fb641b; color: #fff; text-decoration: none; border-radius: 4px; font-weight: bold; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">✉️ CLICK TO CONTACT ADMIN</a>\n\n*(Your Order ID **#${orderId}** will automatically be included in your email)*`;
        }
        // 🟢 NEW: OUR OTHER PROJECTS (With beautifully formatted links)
        else if (lowerMsg === "our other projects" || lowerMsg.includes("other projects") || lowerMsg.includes("subhams app")) {
            reply = `I'd love to show you! Check out these other amazing platforms built by **A. Venkata Pavan Kumar**:\n\n🌐 <a href="https://subhams-vpk.vercel.app/" target="_blank" style="color: #2874f0; font-weight: bold; text-decoration: underline; display: block; margin-bottom: 8px;">Subhams E-Commerce App</a>\n\n🤖 <a href="https://subhams-agent-vpk.vercel.app/" target="_blank" style="color: #2874f0; font-weight: bold; text-decoration: underline; display: block;">Subhams AI Agent</a>\n\nClick the links above to explore them in a new tab!`;
        }
        // --- VIEW MAIN MENU / GREETING ---
        else if (lowerMsg === "view main menu" || lowerMsg === "hi" || lowerMsg === "hello" || lowerMsg === "hey" || lowerMsg === "help") {
            reply = `Hello again! How else can I assist you with Order **#${orderId}** today?`;
        }
        // --- STRICT FALLBACK ---
        else {
            reply = `I'm sorry, I didn't quite catch that. As a Virtual Assistant, I am still learning! \n\nPlease select one of the specific options from the menu, or tap **Contact Human Admin** to email our human team.`;
        }

        res.json({ reply });

    } catch (err) {
        console.error("Chat Error:", err);
        res.status(500).json({ reply: "⚠️ We are experiencing heavy traffic. Please try asking your question again in a moment." });
    }
});

module.exports = router;