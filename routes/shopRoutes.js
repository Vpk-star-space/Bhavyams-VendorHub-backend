const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect } = require('../middleware/authMiddleware');

// 🟢 1. IMPORT YOUR CLOUDINARY CONFIG
const { upload, cloudinary } = require('../config/cloudinary'); 

// 🟢 2. DATABASE AUTO-FIXER (Adds the new decoupled Address columns!)
const fixDatabase = async () => {
    try {
        await pool.query('ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT true');
        await pool.query('ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS shop_type VARCHAR(50) DEFAULT \'Products\'');
        await pool.query('ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS shop_logo TEXT');
        
        // 🟢 NEW: Separate Shop Address & GPS Coordinates
        await pool.query('ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS address VARCHAR(255)');
        await pool.query('ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS lat NUMERIC(10, 6)');
        await pool.query('ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS lng NUMERIC(10, 6)');
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
        // 🟢 FIX: Aliased u.address to user_address so it doesn't overwrite v.address
        const shopsQuery = await pool.query(`
            SELECT v.*, u.address AS user_address
            FROM vendor_profiles v
            JOIN users u ON v.user_id = u.id
            WHERE v.is_approved = true
        `);
        
        // 🟢 SMART FALLBACK: If shop doesn't have an address yet, fallback to user's address
        const processedShops = shopsQuery.rows.map(shop => ({
            ...shop,
            address: shop.address || shop.user_address || ''
        }));

        res.json({ shops: processedShops });
    } catch (err) { 
        console.error(err);
        res.status(500).json({ message: "Server error" }); 
    }
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
        // 🟢 FIX: Aliased u.address to user_address
        const shopQuery = await pool.query(`
            SELECT v.*, u.phone, u.address AS user_address, u.email as user_email, u.username as user_name
            FROM vendor_profiles v
            JOIN users u ON v.user_id = u.id
            WHERE v.id = $1
        `, [shopId]);

        if (shopQuery.rows.length === 0) return res.status(404).json({ message: "Shop not found." });
        
        const shop = shopQuery.rows[0];
        // 🟢 SMART FALLBACK
        shop.address = shop.address || shop.user_address || '';

        const productsQuery = await pool.query('SELECT * FROM products WHERE vendor_id = $1 ORDER BY created_at DESC', [shop.user_id]);
        res.json({ shop: shop, products: productsQuery.rows });
    } catch (err) { 
        res.status(500).json({ message: "Failed to load shop profile." }); 
    }
});

// =====================================================================
// ✏️ 3. UPDATE SHOP PROFILE (Now includes separate Shop Address)
// =====================================================================
router.put('/:id', protect, upload.single('shop_logo'), async (req, res) => {
    // 🟢 ADDED: 'address' extracted from req.body
    const { business_name, category, shop_type, is_online, address } = req.body;
    const shopId = req.params.id;
    
    let shop_logo_url = null;

    try {
        // IF A NEW FILE IS UPLOADED TO CLOUDINARY
        if (req.file) {
            shop_logo_url = req.file.path; 

            // AUTO-CLEANUP: Find the old image and delete it
            const oldShop = await pool.query('SELECT shop_logo FROM vendor_profiles WHERE id = $1', [shopId]);
            
            if (oldShop.rows.length > 0 && oldShop.rows[0].shop_logo) {
                const oldUrl = oldShop.rows[0].shop_logo;
                
                if (oldUrl.includes('cloudinary')) {
                    try {
                        const urlParts = oldUrl.split('/');
                        const fileNameWithExt = urlParts[urlParts.length - 1]; 
                        const folderName = urlParts[urlParts.length - 2];      
                        const publicId = `${folderName}/${fileNameWithExt.split('.')[0]}`; 
                        
                        await cloudinary.uploader.destroy(publicId);
                        console.log(`🗑️ Successfully deleted old Cloudinary image: ${publicId}`);
                    } catch (delErr) {
                        console.error("⚠️ Failed to delete old Cloudinary image:", delErr.message);
                    }
                }
            }
        }

        // 🟢 UPDATE THE DATABASE (Now saves 'address' directly to vendor_profiles)
        const updateQuery = await pool.query(`
            UPDATE vendor_profiles 
            SET business_name = COALESCE($1, business_name),
                category = COALESCE($2, category),
                shop_type = COALESCE($3, shop_type),
                is_online = COALESCE($4, is_online),
                shop_logo = COALESCE($5, shop_logo),
                address = COALESCE($6, address)
            WHERE id = $7
            RETURNING *
        `, [business_name, category, shop_type, is_online, shop_logo_url, address, shopId]);

        if (updateQuery.rows.length === 0) return res.status(404).json({ message: "Shop not found." });

        const updatedShop = updateQuery.rows[0];
        
        // Push live update to frontend via WebSockets
        const io = req.app.get('io');
        if (io) io.emit('shop_updated', updatedShop);

        res.json({ message: "Shop updated successfully!", shop: updatedShop });
    } catch (err) {
        console.error("Update Shop Error:", err);
        res.status(500).json({ message: "Failed to update shop." });
    }
});

module.exports = router;