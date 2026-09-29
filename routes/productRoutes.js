const express = require('express');
const router = express.Router();
const { upload } = require('../config/cloudinary');
const pool = require('../db');
const { protect, authorize } = require('../middleware/authMiddleware');

// =====================================================================
// 📍 1. CUSTOMER: GET HYPER-LOCAL FEED 
// =====================================================================
router.get('/feed', async (req, res) => {
    try {
        const userLat = parseFloat(req.query.lat) || 0;
        const userLng = parseFloat(req.query.lng) || 0;

        const query = `
            SELECT 
                p.*, 
                v.business_name, 
                v.animation_style, 
                v.lat as shop_lat, 
                v.lng as shop_lng,
                (6371 * acos(cos(radians($1)) * cos(radians(v.lat)) * cos(radians(v.lng) - radians($2)) + sin(radians($1)) * sin(radians(v.lat)))) AS distance_km
            FROM products p 
            JOIN vendor_profiles v ON p.vendor_id = v.user_id 
            WHERE v.is_approved = true
            ORDER BY distance_km ASC 
            LIMIT 50;
        `;

        const result = await pool.query(query, [userLat, userLng]);
        res.json({ products: result.rows });
    } catch (err) { 
        console.error("Feed Error:", err.message);
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
// 🔄 3. VENDOR & ADMIN: UPDATE ITEM 
// =====================================================================
router.put('/update/:id', protect, upload.array('item_images', 5), async (req, res) => {
    try {
        const isAdmin = req.user.email === 'pavanvenkat63@gmail.com';
        const { name, price, description, mrp, stock, unit_value, unit_type } = req.body;
        
        // 🛑 SECURITY CHECK: Ensure user owns the product OR is Master Admin
        const productCheck = await pool.query('SELECT vendor_id FROM products WHERE id = $1', [req.params.id]);
        if (productCheck.rows.length === 0) return res.status(404).json({ message: "Item not found" });
        
        if (productCheck.rows[0].vendor_id !== req.user.id && !isAdmin) {
            return res.status(403).json({ message: "Unauthorized to edit this item." });
        }
        
        if (req.files && req.files.length > 0) {
            const imageUrls = req.files.map(file => file.path); 
            const mainImage = imageUrls[0]; 
            const galleryImages = JSON.stringify(imageUrls);
            
            await pool.query(
                `UPDATE products 
                 SET name = $1, price = $2, description = $3, mrp = $4, stock_count = $5, unit_value = $6, unit_type = $7, image_url = $8, gallery = $9
                 WHERE id = $10`,
                [name, price, description, mrp || null, stock || 0, unit_value, unit_type, mainImage, galleryImages, req.params.id]
            );
        } else {
            await pool.query(
                `UPDATE products 
                 SET name = $1, price = $2, description = $3, mrp = $4, stock_count = $5, unit_value = $6, unit_type = $7
                 WHERE id = $8`,
                [name, price, description, mrp || null, stock || 0, unit_value, unit_type, req.params.id]
            );
        }

        res.json({ message: "Item Updated Successfully!" });
    } catch (err) { 
        console.error("Update Error:", err);
        res.status(500).json({ message: "Update failed" }); 
    }
});

// =====================================================================
// 🚀 4. VENDOR & ADMIN: ADD PRODUCT OR SERVICE
// =====================================================================
router.post('/add', protect, upload.array('item_images', 5), async (req, res) => {
    try {
        const isAdmin = req.user.email === 'pavanvenkat63@gmail.com';
        const { vendor_id, name, description, mrp, price, stock, unit_value, unit_type } = req.body;
        
        // 🛑 SECURITY CHECK: Grab shop info
        const vendorCheck = await pool.query('SELECT is_approved, user_id FROM vendor_profiles WHERE id = $1', [vendor_id]);
        
        if (vendorCheck.rows.length === 0) {
            return res.status(404).json({ message: "Shop not found." });
        }

        if (!vendorCheck.rows[0].is_approved && !isAdmin) {
            return res.status(403).json({ message: "Your shop is still pending Admin approval." });
        }

        if (vendorCheck.rows[0].user_id !== req.user.id && !isAdmin) {
            return res.status(403).json({ message: "Unauthorized to add items to this shop." });
        }

        // The actual owner of the shop, regardless of who is editing it
        const realVendorUserId = vendorCheck.rows[0].user_id;

        // Handle Multiple Images
        let image_url = null;
        let galleryImages = '[]'; 
        
        if (req.files && req.files.length > 0) {
            const imageUrls = req.files.map(file => file.path); 
            image_url = imageUrls[0]; 
            galleryImages = JSON.stringify(imageUrls);
        }

        const newProduct = await pool.query(
            `INSERT INTO products 
            (vendor_id, name, description, mrp, price, stock_count, unit_value, unit_type, image_url, gallery) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
            RETURNING *`,
            [
                realVendorUserId,   // 🟢 SAFE: Injects the product under the correct owner's ID
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

        res.status(201).json({ message: 'Item added to catalog!', product: newProduct.rows[0] });
    } catch (err) { 
        console.error("Add Product Error:", err);
        res.status(500).json({ error: 'Database insert failed' }); 
    }
});

// =====================================================================
// 🔍 5. PUBLIC: GET SINGLE ITEM DETAILS
// =====================================================================
router.get('/detail/:itemId', async (req, res) => {
    try {
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


// =====================================================================
// 🗑️ 6. VENDOR & ADMIN: DELETE A PRODUCT
// =====================================================================
router.delete('/:id', protect, async (req, res) => {
    try {
        const isAdmin = req.user.email === 'pavanvenkat63@gmail.com';
        const productId = req.params.id;

        // 1. Check if product exists & check ownership
        const productCheck = await pool.query('SELECT * FROM products WHERE id = $1', [productId]);
        if (productCheck.rows.length === 0) {
            return res.status(404).json({ message: "Product not found." });
        }

        if (productCheck.rows[0].vendor_id !== req.user.id && !isAdmin) {
            return res.status(403).json({ message: "Unauthorized to delete this item." });
        }

        // 2. Safely delete cart associations first
        await pool.query('DELETE FROM cart WHERE product_id = $1', [productId]);

        // 3. Safely delete the product
        await pool.query('DELETE FROM products WHERE id = $1', [productId]);

        console.log(`🗑️ Product ${productId} deleted successfully.`);
        res.status(200).json({ message: "Product deleted successfully." });
    } catch (err) {
        console.error("❌ Delete Product Error:", err.message);
        res.status(500).json({ message: "Server error while deleting product." });
    }
});

module.exports = router;