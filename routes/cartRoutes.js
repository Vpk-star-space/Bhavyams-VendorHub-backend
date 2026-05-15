const express = require('express'); // 1. Import Express
const router = express.Router();    // 2. Create the Router instance
const pool = require('../db');      // 3. Import your DB connection
const { protect } = require('../middleware/authMiddleware'); // 4. Import Auth Middleware

// 1. ADD TO CART (or increase quantity if it already exists)
router.post('/add', protect, async (req, res) => {
    const { productId, quantity } = req.body;
    try {
        // Check if item is already in the cart for this user
        const existingItem = await pool.query(
            'SELECT * FROM cart WHERE user_id = $1 AND product_id = $2',
            [req.user.id, productId]
        );

        if (existingItem.rows.length > 0) {
            // If it exists, update the quantity
            const updatedItem = await pool.query(
                'UPDATE cart SET quantity = quantity + $1 WHERE user_id = $2 AND product_id = $3 RETURNING *',
                [quantity, req.user.id, productId]
            );
            return res.status(200).json(updatedItem.rows[0]);
        } else {
            // If it is new, insert it
            const newItem = await pool.query(
                'INSERT INTO cart (user_id, product_id, quantity) VALUES ($1, $2, $3) RETURNING *',
                [req.user.id, productId, quantity]
            );
            return res.status(201).json(newItem.rows[0]);
        }
    } catch (err) {
        console.error(err);
        res.status(500).send("Server Error");
    }
});

// 2. GET CART ITEMS (When the user logs in)
router.get('/', protect, async (req, res) => {
    try {
        // This gets the cart items AND joins the product details (name, price, image) so your React app can display them
        const cartItems = await pool.query(
            `SELECT c.quantity, p.* FROM cart c 
             JOIN products p ON c.product_id = p.id 
             WHERE c.user_id = $1`,
            [req.user.id]
        );
        res.status(200).json(cartItems.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send("Server Error");
    }
});

// 3. REMOVE FROM CART
router.delete('/remove/:productId', protect, async (req, res) => {
    const { productId } = req.params;
    try {
        await pool.query(
            'DELETE FROM cart WHERE user_id = $1 AND product_id = $2',
            [req.user.id, productId]
        );
        res.status(200).json({ message: "Item removed from cart" });
    } catch (err) {
        console.error(err);
        res.status(500).send("Server Error");
    }
});

// 🛡️ CRITICAL: Don't forget to export it at the bottom!
module.exports = router;