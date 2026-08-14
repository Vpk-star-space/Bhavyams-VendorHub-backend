const express = require('express');
const router = express.Router();
const { upload } = require('../config/cloudinary');
const pool = require('../db');
const { protect, authorize } = require('../middleware/authMiddleware');

// =====================================================================
// 📍 1. CUSTOMER: GET HYPER-LOCAL FEED (The "Konanki" Magic)
// =====================================================================
router.get('/feed', async (req, res) => {
    try {
        // Customer's coordinates sent from the frontend (Defaults to 0 if not provided)
        const userLat = parseFloat(req.query.lat) || 0;
        const userLng = parseFloat(req.query.lng) || 0;

        // 🧠 THE HAVERSINE FORMULA: Calculates exact distance in Kilometers!
        const query = `
            SELECT 
                p.*, 
                v.business_name, 
                v.animation_style, 
                v.latitude as shop_lat, 
                v.longitude as shop_lng,
                (6371 * acos(cos(radians($1)) * cos(radians(v.latitude)) * cos(radians(v.longitude) - radians($2)) + sin(radians($1)) * sin(radians(v.latitude)))) AS distance_km
            FROM products p 
            JOIN vendor_profiles v ON p.vendor_id = v.user_id 
            WHERE v.is_approved = true
            ORDER BY distance_km ASC 
            LIMIT 50;
        `;

        const result = await pool.query(query, [userLat, userLng]);
        res.json({ products: result.rows });
    } catch (err) { 
        console.error("Feed Error:", err);
        res.status(500).json({ error: "Failed to load local feed" }); 
    }
});

// =====================================================================
// 📦 2. VENDOR: GET MY INVENTORY
// =====================================================================
router.get('/my-products', protect, authorize('vendor'), async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products WHERE vendor_id = $1 ORDER BY id DESC', [req.user.id]);
        res.json(result.rows);
    } catch (err) { 
        res.status(500).json({ error: "Inventory fetch failed" }); 
    }
});

// =====================================================================
// 🔄 3. VENDOR: UPDATE ITEM (WITH STOCK & UNITS)
// =====================================================================
router.put('/update/:id', protect, upload.array('item_images', 5), async (req, res) => {
    try {
        const { name, price, description, mrp, stock, unit_value, unit_type } = req.body;
        
        if (req.files && req.files.length > 0) {
            // If the vendor uploaded new images during edit
            const imageUrls = req.files.map(file => file.path); 
            const mainImage = imageUrls[0]; 
            const galleryImages = JSON.stringify(imageUrls);
            
            await pool.query(
                `UPDATE products 
                 SET name = $1, price = $2, description = $3, mrp = $4, stock_count = $5, unit_value = $6, unit_type = $7, image_url = $10, gallery = $11
                 WHERE id = $8 AND vendor_id = $9`,
                [name, price, description, mrp || null, stock || 0, unit_value, unit_type, req.params.id, req.user.id, mainImage, galleryImages]
            );
        } else {
            // If the vendor just changed text/price (no new images)
            await pool.query(
                `UPDATE products 
                 SET name = $1, price = $2, description = $3, mrp = $4, stock_count = $5, unit_value = $6, unit_type = $7
                 WHERE id = $8 AND vendor_id = $9`,
                [name, price, description, mrp || null, stock || 0, unit_value, unit_type, req.params.id, req.user.id]
            );
        }

        res.json({ message: "Item Updated Successfully!" });
    } catch (err) { 
        console.error("Update Error:", err);
        res.status(500).json({ message: "Update failed" }); 
    }
});

// =====================================================================
// 🚀 4. VENDOR: ADD PRODUCT OR SERVICE (FIXED FOREIGN KEY)
// =====================================================================
router.post('/add', protect, upload.array('item_images', 5), async (req, res) => {
    try {
        // vendor_id here is actually the Shop ID coming from the frontend URL
        const { vendor_id, name, description, mrp, price, stock, unit_value, unit_type } = req.body;
        
        // 🛑 SECURITY CHECK: Grab shop info
        const vendorCheck = await pool.query('SELECT is_approved, user_id FROM vendor_profiles WHERE id = $1', [vendor_id]);
        
        if (vendorCheck.rows.length === 0 || !vendorCheck.rows[0].is_approved) {
            return res.status(403).json({ message: "Your shop is still pending Admin approval." });
        }

        if (vendorCheck.rows[0].user_id !== req.user.id) {
            return res.status(403).json({ message: "Unauthorized to add items to this shop." });
        }

        // Handle Multiple Images
        let image_url = null;
        let galleryImages = '[]'; 
        
        if (req.files && req.files.length > 0) {
            const imageUrls = req.files.map(file => file.path); 
            image_url = imageUrls[0]; 
            galleryImages = JSON.stringify(imageUrls);
        }

        // 🟢 FIXED: We insert req.user.id as the first value ($1), NOT the shop's vendor_id!
        const newProduct = await pool.query(
            `INSERT INTO products 
            (vendor_id, name, description, mrp, price, stock_count, unit_value, unit_type, image_url, gallery) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
            RETURNING *`,
            [
                req.user.id,        // Matches the 'users' table exactly
                name, 
                description, 
                mrp || null, 
                price, 
                stock || 0, 
                unit_value, 
                unit_type, 
                image_url, 
                galleryImages
            ]
        );

        res.status(201).json({ message: 'Item added to your catalog!', product: newProduct.rows[0] });
    } catch (err) { 
        console.error("Add Product Error:", err);
        res.status(500).json({ error: 'Database insert failed' }); 
    }
});

// =====================================================================
// 🔍 5. PUBLIC: GET SINGLE ITEM DETAILS (With Shop ID Fix)
// =====================================================================
router.get('/detail/:itemId', async (req, res) => {
    try {
        // JOIN products with vendor_profiles to get the real shop_id and business_name
        const query = `
            SELECT p.*, v.id AS shop_id, v.business_name 
            FROM products p
            LEFT JOIN vendor_profiles v ON p.vendor_id = v.user_id
            WHERE p.id = $1
        `;
        const result = await pool.query(query, [req.params.itemId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Item not found" });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error("Item Fetch Error:", err);
        res.status(500).json({ error: "Failed to fetch item details" });
    }
});

module.exports = router;