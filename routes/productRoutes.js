const express = require('express');
const router = express.Router();
const { upload } = require('../config/cloudinary');
const pool = require('../db');
const { protect, authorize } = require('../middleware/authMiddleware');

// =====================================================================
// 🚀 1. VENDOR: ADD PRODUCT OR SERVICE
// =====================================================================
router.post('/add', protect, authorize('vendor'), upload.array('images', 5), async (req, res) => {
    try {
        const { name, price, description, stock_count, category, is_service } = req.body;
        if (!req.files || req.files.length === 0) return res.status(400).json({ message: "At least one image is required" });
        
        // 🛑 SECURITY CHECK: Is this vendor approved by the Admin yet?
        const vendorCheck = await pool.query('SELECT is_approved FROM vendor_profiles WHERE user_id = $1', [req.user.id]);
        if (vendorCheck.rows.length === 0 || !vendorCheck.rows[0].is_approved) {
            return res.status(403).json({ message: "Your shop is still pending Admin approval. You cannot add items yet." });
        }

        const imageUrls = req.files.map(file => file.path); 
        const mainImage = imageUrls[0];
        const galleryImages = JSON.stringify(imageUrls);

        const newItem = await pool.query(
            `INSERT INTO products (name, price, description, vendor_id, image_url, stock_count, category, gallery, is_service) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [name, price, description, req.user.id, mainImage, stock_count || 0, category || 'Others', galleryImages, is_service || false]
        );
        res.status(201).json({ message: 'Item added to your catalog!', product: newItem.rows[0] });
    } catch (err) { 
        console.error("Add Product Error:", err);
        res.status(500).json({ error: 'Database insert failed' }); 
    }
});

// =====================================================================
// 📍 2. CUSTOMER: GET HYPER-LOCAL FEED (The "Konanki" Magic)
// =====================================================================
router.get('/feed', async (req, res) => {
    try {
        // Customer's coordinates sent from the frontend (Defaults to 0 if not provided)
        const userLat = parseFloat(req.query.lat) || 0;
        const userLng = parseFloat(req.query.lng) || 0;

        // 🧠 THE HAVERSINE FORMULA: Calculates exact distance in Kilometers!
        // We JOIN products with vendor_profiles to get the animation_style and business_name.
        // We ONLY show products where v.is_approved = true.
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
// 📦 3. VENDOR: GET MY INVENTORY
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
// 🔄 4. VENDOR: UPDATE & DELETE
// =====================================================================
router.put('/update/:id', protect, authorize('vendor'), async (req, res) => {
    const { name, price, description, stock_count, category, is_service } = req.body;
    try {
        const updated = await pool.query(
            `UPDATE products SET name = $1, price = $2, description = $3, stock_count = $4, category = $5, is_service = $6
             WHERE id = $7 AND vendor_id = $8 RETURNING *`,
            [name, price, description, stock_count, category, is_service, req.params.id, req.user.id]
        );
        res.json({ message: "Updated!", product: updated.rows[0] });
    } catch (err) { res.status(500).send('Update failed'); }
});

router.delete('/delete/:id', protect, authorize('vendor'), async (req, res) => {
    try {
        await pool.query('DELETE FROM products WHERE id = $1 AND vendor_id = $2', [req.params.id, req.user.id]);
        res.json({ message: "Deleted!" });
    } catch (err) { res.status(500).json({ message: "Delete failed" }); }
});

module.exports = router;