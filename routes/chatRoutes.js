const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect } = require('../middleware/authMiddleware');

// 🟢 DATABASE AUTO-FIXER: Chat Tables
const fixChatDatabase = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS shop_conversations (
                id SERIAL PRIMARY KEY,
                shop_id INTEGER REFERENCES vendor_profiles(id) ON DELETE CASCADE,
                customer_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                last_message TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(shop_id, customer_id)
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                conversation_id INTEGER REFERENCES shop_conversations(id) ON DELETE CASCADE,
                sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                message_text TEXT NOT NULL,
                is_read BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
    } catch (err) {
        console.error("Chat DB Fix Note:", err.message);
    }
};
fixChatDatabase();

// 🟢 1. GET ALL CONVERSATIONS
router.get('/my-chats', protect, async (req, res) => {
    try {
        const userId = req.user.id;
        const isVendor = req.user.role === 'vendor';
        let query = '';
        let params = [userId];

        if (isVendor) {
            query = `
                SELECT c.id as conversation_id, c.last_message, c.updated_at, 
                       u.id as other_user_id, u.username as other_name, 'customer' as other_type
                FROM shop_conversations c
                JOIN vendor_profiles v ON c.shop_id = v.id
                JOIN users u ON c.customer_id = u.id
                WHERE v.user_id = $1
                ORDER BY c.updated_at DESC
            `;
        } else {
            query = `
                SELECT c.id as conversation_id, c.last_message, c.updated_at, 
                       v.id as other_user_id, v.business_name as other_name, v.shop_logo as other_avatar, 'shop' as other_type
                FROM shop_conversations c
                JOIN vendor_profiles v ON c.shop_id = v.id
                WHERE c.customer_id = $1
                ORDER BY c.updated_at DESC
            `;
        }

        const chats = await pool.query(query, params);
        res.json(chats.rows);
    } catch (err) {
        res.status(500).json({ message: "Failed to load chats." });
    }
});

// 🟢 2. GET OR CREATE A CONVERSATION
router.post('/initiate/:shopId', protect, async (req, res) => {
    try {
        const shopId = req.params.shopId;
        const customerId = req.user.id;

        // FIXED: Removed the "cannot chat with own shop" restriction to allow Admin testing!

        let convo = await pool.query('SELECT id FROM shop_conversations WHERE shop_id = $1 AND customer_id = $2', [shopId, customerId]);
        
        if (convo.rows.length === 0) {
            convo = await pool.query(
                'INSERT INTO shop_conversations (shop_id, customer_id) VALUES ($1, $2) RETURNING id',
                [shopId, customerId]
            );
        }

        res.json({ conversation_id: convo.rows[0].id });
    } catch (err) {
        res.status(500).json({ message: "Failed to initiate chat." });
    }
});

// 🟢 3. GET MESSAGES FOR A CONVERSATION
router.get('/:conversationId/messages', protect, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const messages = await pool.query(`
            SELECT id, sender_id, message_text, created_at, is_read
            FROM chat_messages 
            WHERE conversation_id = $1 
            ORDER BY created_at ASC
        `, [conversationId]);
        res.json(messages.rows);
    } catch (err) {
        res.status(500).json({ message: "Failed to load messages." });
    }
});

module.exports = router;