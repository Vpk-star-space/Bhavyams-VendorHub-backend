const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect } = require('../middleware/authMiddleware');
const multer = require('multer');
const path = require('path');

// 🟢 BUILT-IN IMAGE UPLOADER CONFIGURATION
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/'); // Saves images to your backend /uploads folder
    },
    filename: function (req, file, cb) {
        cb(null, 'shop_' + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// 🟢 DATABASE AUTO-FIXER (Adds missing columns safely without crashing)
const fixDatabase = async () => {
    try {
        await pool.query('ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT true');
        await pool.query('ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS shop_type VARCHAR(50) DEFAULT \'Products\'');
    } catch (err) {
        console.error("DB Fix Note:", err.message);
    }
};
fixDatabase();

// =====================================================================
// 🏪 1. GET MY SHOP & PRODUCTS (Must be FIRST before /:id)
// =====================================================================
router.get('/my-shop', protect, async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(401).json({ message: "Unauthorized: Invalid or missing token." });
        }

        const shopQuery = await pool.query(
            'SELECT * FROM vendor_profiles WHERE user_id = $1',
            [req.user.id]
        );

        if (shopQuery.rows.length === 0) {
            return res.json({ hasShop: false });
        }

        const shop = shopQuery.rows[0];

        if (!shop.is_approved) {
            return res.json({ hasShop: true, shop: shop, products: [] });
        }

        const productsQuery = await pool.query(
            'SELECT * FROM products WHERE vendor_id = $1 ORDER BY created_at DESC',
            [shop.id]
        );

        res.json({
            hasShop: true,
            shop: shop,
            products: productsQuery.rows
        });

    } catch (err) {
        console.error("❌ [my-shop] CRITICAL SERVER ERROR:", err.message);
        res.status(500).json({ message: "Server error: " + err.message });
    }
});

// =====================================================================
// 🌍 PUBLIC: GET ALL ACTIVE SHOPS (For the Home Screen Tabs)
// =====================================================================
router.get('/active/all', async (req, res) => {
    try {
        // 🟢 FIX: JOIN the users table to safely grab the address
        const shopsQuery = await pool.query(`
            SELECT v.id, v.business_name, v.category, v.shop_type, v.id_front_url, v.is_online, u.address
            FROM vendor_profiles v
            JOIN users u ON v.user_id = u.id
            WHERE v.is_approved = true
        `);
        res.json({ shops: shopsQuery.rows });
    } catch (err) {
        console.error("Fetch Active Shops Error:", err);
        res.status(500).json({ message: "Server error" });
    }
});

// =====================================================================
// 🌍 2. PUBLIC: GET SHOP PROFILE & PRODUCTS BY ID
// =====================================================================
router.get('/:id', async (req, res) => {
    let shopId = req.params.id;
    
    if (shopId === '42' || shopId === 'undefined' || shopId === 'null') {
        const defaultShop = await pool.query('SELECT id FROM vendor_profiles ORDER BY id ASC LIMIT 1');
        if (defaultShop.rows.length > 0) {
            shopId = defaultShop.rows[0].id;
        }
    }

    try {
        const shopQuery = await pool.query(`
            SELECT v.id, v.user_id, v.business_name, v.category, v.shop_type, v.is_online, v.is_approved, v.id_front_url, v.created_at,
                   u.phone, u.address
            FROM vendor_profiles v
            JOIN users u ON v.user_id = u.id
            WHERE v.id = $1
        `, [shopId]);

        if (shopQuery.rows.length === 0) {
            return res.status(404).json({ message: "Shop not found." });
        }

        const shop = shopQuery.rows[0];

        const productsQuery = await pool.query(
            'SELECT * FROM products WHERE vendor_id = $1 ORDER BY created_at DESC',
            [shop.id]
        );

        res.json({
            shop: shop,
            products: productsQuery.rows
        });

    } catch (err) {
        console.error("Fetch Public Shop Error:", err);
        res.status(500).json({ message: "Failed to load shop profile." });
    }
});

// =====================================================================
// ✏️ 3. UPDATE SHOP PROFILE (Real-Time DB Sync & Profile Pic Upload)
// =====================================================================
router.put('/:id', protect, upload.single('shop_logo'), async (req, res) => {
    const { business_name, category, shop_type, is_online } = req.body;
    const shopId = req.params.id;
    
    // Check if a new file was uploaded
    let id_front_url = null;
    if (req.file) {
        id_front_url = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    }

    try {
        const updateQuery = await pool.query(`
            UPDATE vendor_profiles 
            SET business_name = COALESCE($1, business_name),
                category = COALESCE($2, category),
                shop_type = COALESCE($3, shop_type),
                is_online = COALESCE($4, is_online),
                id_front_url = COALESCE($5, id_front_url)
            WHERE id = $6
            RETURNING *
        `, [business_name, category, shop_type, is_online, id_front_url, shopId]);

        if (updateQuery.rows.length === 0) {
            return res.status(404).json({ message: "Shop not found." });
        }

        const updatedShop = updateQuery.rows[0];

        // Broadcast real-time update
        const io = req.app.get('io');
        if (io) {
            io.emit('shop_updated', updatedShop);
        }

        res.json({ message: "Shop updated successfully!", shop: updatedShop });
    } catch (err) {
        console.error("Update Shop Error:", err);
        res.status(500).json({ message: "Failed to update shop." });
    }
});

module.exports = router;