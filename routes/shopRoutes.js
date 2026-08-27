const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect } = require('../middleware/authMiddleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs'); 

// 🟢 AUTO-CREATE 'uploads' FOLDER
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log('📁 Created missing "uploads" directory automatically.');
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, 'uploads/'); },
    filename: function (req, file, cb) { cb(null, 'public_logo_' + Date.now() + path.extname(file.originalname)); }
});
const upload = multer({ storage: storage });

// 🟢 DATABASE AUTO-FIXER: SEPARATING PUBLIC LOGO FROM SECURE EVIDENCE
const fixDatabase = async () => {
    try {
        await pool.query('ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT true');
        await pool.query('ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS shop_type VARCHAR(50) DEFAULT \'Products\'');
        // 🟢 CRITICAL FIX: Adding a completely separate column for the public logo!
        await pool.query('ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS shop_logo TEXT');
    } catch (err) {
        console.error("DB Fix Note:", err.message);
    }
};
fixDatabase();

// =====================================================================
// 🏪 1. GET MY SHOP & PRODUCTS
// =====================================================================
router.get('/my-shop', protect, async (req, res) => {
    try {
        if (!req.user || !req.user.id) return res.status(401).json({ message: "Unauthorized." });

        const shopQuery = await pool.query('SELECT * FROM vendor_profiles WHERE user_id = $1', [req.user.id]);
        if (shopQuery.rows.length === 0) return res.json({ hasShop: false });

        const shop = shopQuery.rows[0];
        if (!shop.is_approved) return res.json({ hasShop: true, shop: shop, products: [] });

        const productsQuery = await pool.query('SELECT * FROM products WHERE vendor_id = $1 ORDER BY created_at DESC', [shop.user_id]);
        res.json({ hasShop: true, shop: shop, products: productsQuery.rows });
    } catch (err) {
        res.status(500).json({ message: "Server error: " + err.message });
    }
});

// =====================================================================
// 🌍 PUBLIC: GET ALL ACTIVE SHOPS 
// =====================================================================
router.get('/active/all', async (req, res) => {
    try {
        const shopsQuery = await pool.query(`
            SELECT v.*, u.address
            FROM vendor_profiles v
            JOIN users u ON v.user_id = u.id
            WHERE v.is_approved = true
        `);
        res.json({ shops: shopsQuery.rows });
    } catch (err) { res.status(500).json({ message: "Server error" }); }
});

// =====================================================================
// 🌍 2. PUBLIC: GET SHOP PROFILE BY ID
// =====================================================================
router.get('/:id', async (req, res) => {
    let shopId = req.params.id;
    if (shopId === '42' || shopId === 'undefined' || shopId === 'null') {
        const defaultShop = await pool.query('SELECT id FROM vendor_profiles ORDER BY id ASC LIMIT 1');
        if (defaultShop.rows.length > 0) { shopId = defaultShop.rows[0].id; }
    }

    try {
        const shopQuery = await pool.query(`
            SELECT v.*, u.phone, u.address, u.email as user_email, u.username as user_name
            FROM vendor_profiles v
            JOIN users u ON v.user_id = u.id
            WHERE v.id = $1
        `, [shopId]);

        if (shopQuery.rows.length === 0) return res.status(404).json({ message: "Shop not found." });
        const shop = shopQuery.rows[0];

        const productsQuery = await pool.query('SELECT * FROM products WHERE vendor_id = $1 ORDER BY created_at DESC', [shop.user_id]);
        res.json({ shop: shop, products: productsQuery.rows });
    } catch (err) { res.status(500).json({ message: "Failed to load shop profile." }); }
});

// =====================================================================
// ✏️ 3. UPDATE SHOP PROFILE (STRICTLY UPDATES PUBLIC 'shop_logo')
// =====================================================================
router.put('/:id', protect, upload.single('shop_logo'), async (req, res) => {
    const { business_name, category, shop_type, is_online } = req.body;
    const shopId = req.params.id;
    
    // 🟢 ONLY updating the specific public column!
    let shop_logo_url = null;
    if (req.file) {
        shop_logo_url = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    }

    try {
        const updateQuery = await pool.query(`
            UPDATE vendor_profiles 
            SET business_name = COALESCE($1, business_name),
                category = COALESCE($2, category),
                shop_type = COALESCE($3, shop_type),
                is_online = COALESCE($4, is_online),
                shop_logo = COALESCE($5, shop_logo) 
            WHERE id = $6
            RETURNING *
        `, [business_name, category, shop_type, is_online, shop_logo_url, shopId]);

        if (updateQuery.rows.length === 0) return res.status(404).json({ message: "Shop not found." });

        const updatedShop = updateQuery.rows[0];
        const io = req.app.get('io');
        if (io) io.emit('shop_updated', updatedShop);

        res.json({ message: "Shop updated successfully!", shop: updatedShop });
    } catch (err) {
        console.error("Update Shop Error:", err);
        res.status(500).json({ message: "Failed to update shop." });
    }
});

module.exports = router;