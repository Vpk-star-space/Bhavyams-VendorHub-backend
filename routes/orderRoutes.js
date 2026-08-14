const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect } = require('../middleware/authMiddleware');

// 🟢 SAFE DATABASE CHECKER
// Only creates the table if it's completely missing. Will NOT delete your orders!
const verifyOrdersTable = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                customer_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                vendor_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                items JSONB NOT NULL,
                total_amount NUMERIC(10, 2) NOT NULL,
                status VARCHAR(50) DEFAULT 'Pending',
                order_type VARCHAR(50) DEFAULT 'Product',
                customer_name VARCHAR(100),
                customer_phone VARCHAR(20),
                customer_address TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("✅ Database verified: 'orders' table is ready and safe.");
    } catch (err) {
        console.error("DB Verify Error:", err.message);
    }
};
verifyOrdersTable(); 

// =====================================================================
// 🛒 1. CUSTOMER: PLACE A NEW ORDER / BOOKING
// =====================================================================
router.post('/place', protect, async (req, res) => {
    try {
        const { vendor_id, items, total_amount, order_type, customer_name, customer_phone, customer_address } = req.body;

        if (!vendor_id) {
            return res.status(400).json({ success: false, message: "Vendor ID is missing." });
        }

        const newOrder = await pool.query(
            `INSERT INTO orders 
            (customer_id, vendor_id, items, total_amount, order_type, customer_name, customer_phone, customer_address) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [
                req.user.id, 
                vendor_id, 
                JSON.stringify(items || []), 
                total_amount || 0, 
                order_type || 'Product', 
                customer_name || 'Customer', 
                customer_phone || '', 
                customer_address || ''
            ]
        );

        const io = req.app.get('io');
        if (io) {
            io.emit(`new_order_vendor_${vendor_id}`, newOrder.rows[0]);
        }

        res.status(201).json({ success: true, message: 'Order placed successfully!', order: newOrder.rows[0] });
    } catch (err) {
        console.error("❌ Place Order Error:", err.message); 
        res.status(500).json({ success: false, message: "Failed to place order. " + err.message });
    }
});
// =====================================================================
// 🏪 2. VENDOR: GET INCOMING ORDERS
// =====================================================================
router.get('/vendor-orders', protect, async (req, res) => {
    try {
        const orders = await pool.query(
            `SELECT * FROM orders WHERE vendor_id = $1 ORDER BY created_at DESC`,
            [req.user.id]
        );

        res.json({ success: true, orders: orders.rows });
    } catch (err) {
        console.error("Fetch Vendor Orders Error:", err.message);
        res.status(500).json({ success: false, message: "Failed to fetch orders." });
    }
});

// =====================================================================
// 🔄 3. VENDOR: UPDATE ORDER STATUS (Accept / Complete / Cancel)
// =====================================================================
router.put('/update-status/:orderId', protect, async (req, res) => {
    try {
        const { status } = req.body;
        const { orderId } = req.params;

        const updatedOrder = await pool.query(
            `UPDATE orders SET status = $1 WHERE id = $2 AND vendor_id = $3 RETURNING *`,
            [status, orderId, req.user.id]
        );

        if (updatedOrder.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Order not found or unauthorized." });
        }

        res.json({ success: true, message: `Order marked as ${status}`, order: updatedOrder.rows[0] });
    } catch (err) {
        console.error("Update Order Status Error:", err.message);
        res.status(500).json({ success: false, message: "Failed to update status." });
    }
});

// =====================================================================
// 🛒 4. CUSTOMER: GET MY PLACED ORDERS
// =====================================================================
router.get('/my-orders', protect, async (req, res) => {
    try {
        const orders = await pool.query(
            `SELECT o.*, v.business_name AS vendor_name, u.phone AS vendor_phone 
             FROM orders o
             LEFT JOIN vendor_profiles v ON o.vendor_id = v.user_id
             LEFT JOIN users u ON o.vendor_id = u.id
             WHERE o.customer_id = $1 
             ORDER BY o.created_at DESC`,
            [req.user.id]
        );

        res.json({ success: true, orders: orders.rows });
    } catch (err) {
        console.error("Fetch My Orders Error:", err.message);
        res.status(500).json({ success: false, message: "Failed to fetch your orders." });
    }
});

module.exports = router;