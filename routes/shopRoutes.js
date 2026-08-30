const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect } = require('../middleware/authMiddleware');

// 🟢 1. IMPORT YOUR CLOUDINARY CONFIG
// Adjust this path if your cloudinary file is saved somewhere else!
const { upload, cloudinary } = require('../config/cloudinary'); 

// 🟢 2. DATABASE AUTO-FIXER
const fixDatabase = async () => {
    try {
        await pool.query('ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT true');
        await pool.query('ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS shop_type VARCHAR(50) DEFAULT \'Products\'');
        // Ensures the public logo column exists safely
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
// ✏️ 3. UPDATE SHOP PROFILE (Cloudinary Upload & Auto-Cleanup)
// =====================================================================
router.put('/:id', protect, upload.single('shop_logo'), async (req, res) => {
    const { business_name, category, shop_type, is_online } = req.body;
    const shopId = req.params.id;
    
    let shop_logo_url = null;

    try {
        // 🟢 IF A NEW FILE IS UPLOADED TO CLOUDINARY
        if (req.file) {
            shop_logo_url = req.file.path; // Cloudinary automatically provides the secure URL here!

            // 🟢 AUTO-CLEANUP: Find the old image and delete it from Cloudinary so your storage doesn't get full!
            const oldShop = await pool.query('SELECT shop_logo FROM vendor_profiles WHERE id = $1', [shopId]);
            
            if (oldShop.rows.length > 0 && oldShop.rows[0].shop_logo) {
                const oldUrl = oldShop.rows[0].shop_logo;
                
                // Make sure it's actually a Cloudinary link before trying to delete
                if (oldUrl.includes('cloudinary')) {
                    try {
                        // Extract the public_id from the Cloudinary URL
                        const urlParts = oldUrl.split('/');
                        const fileNameWithExt = urlParts[urlParts.length - 1]; // e.g. "image123.jpg"
                        const folderName = urlParts[urlParts.length - 2];      // e.g. "subhams_hub_ids"
                        const publicId = `${folderName}/${fileNameWithExt.split('.')[0]}`; // "subhams_hub_ids/image123"
                        
                        await cloudinary.uploader.destroy(publicId);
                        console.log(`🗑️ Successfully deleted old Cloudinary image: ${publicId}`);
                    } catch (delErr) {
                        console.error("⚠️ Failed to delete old Cloudinary image:", delErr.message);
                    }
                }
            }
        }

        // 🟢 UPDATE THE DATABASE
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
        
        // Push live update to frontend
        const io = req.app.get('io');
        if (io) io.emit('shop_updated', updatedShop);

        res.json({ message: "Shop updated successfully!", shop: updatedShop });
    } catch (err) {
        console.error("Update Shop Error:", err);
        res.status(500).json({ message: "Failed to update shop." });
    }
});

module.exports = router;