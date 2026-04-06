const express = require('express'); // 1. Import Express
const router = express.Router();    // 2. Create the Router instance
const pool = require('../db');      // 3. Import your DB connection
const { protect } = require('../middleware/authmiddleware'); // 4. Import Auth Middleware

// --- NOW your existing code will work ---
router.post('/add', protect, async (req, res) => {
    const { productId, quantity } = req.body;
    try {
        const newItem = await pool.query(
            'INSERT INTO cart (user_id, product_id, quantity) VALUES ($1, $2, $3) RETURNING *',
            [req.user.id, productId, quantity]
        );
        res.status(201).json(newItem.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send("Server Error");
    }
});

// 🛡️ CRITICAL: Don't forget to export it at the bottom!
module.exports = router;