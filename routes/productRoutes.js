const express = require('express');
const router = express.Router();
const { upload } = require('../config/cloudinary');
const pool = require('../db');
const { protect, authorize } = require('../middleware/authMiddleware');

// 1. 🚀 ADD PRODUCT
router.post('/add', protect, authorize('vendor'), upload.array('images', 5), async (req, res) => {
    try {
        const { name, price, description, stock_count, category } = req.body;
        if (!req.files || req.files.length === 0) return res.status(400).json({ message: "Image required" });
        
        const imageUrls = req.files.map(file => file.path); 
        const mainImage = imageUrls[0];
        const galleryImages = JSON.stringify(imageUrls);

        const newProduct = await pool.query(
            `INSERT INTO products (name, price, description, vendor_id, image_url, stock_count, category, gallery) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [name, price, description, req.user.id, mainImage, stock_count || 0, category || 'Others', galleryImages]
        );
        res.status(201).json({ message: 'Product added!', product: newProduct.rows[0] });
    } catch (err) { 
        res.status(500).json({ error: 'Database insert failed' }); 
    }
});

// 2. 📋 GET ALL PRODUCTS (Marketplace)
router.get('/all', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.*, COUNT(r.id)::INT AS total_reviews, ROUND(COALESCE(AVG(r.rating), 0), 1)::FLOAT AS average_rating
            FROM products p LEFT JOIN reviews r ON p.id = r.product_id
            GROUP BY p.id ORDER BY p.created_at DESC`);
        res.json({ products: result.rows });
    } catch (err) { res.status(500).json({ error: "Fetch failed" }); }
});

// 3. 📦 VENDOR: GET MY INVENTORY
router.get('/my-products', protect, authorize('vendor'), async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT p.*, COALESCE(AVG(r.rating), 0)::NUMERIC(10,1) AS average_rating, COUNT(r.id)::INTEGER AS total_reviews
             FROM products p LEFT JOIN reviews r ON p.id = r.product_id
             WHERE p.vendor_id = $1 GROUP BY p.id ORDER BY p.id DESC`, 
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: "Inventory fetch failed" }); }
});

// 4. 💰 VENDOR: GET DASHBOARD STATS (Merged & Fixed)
router.get('/vendor/stats', protect, authorize('vendor'), async (req, res) => {
    try {
        // Query 1: Revenue from ALL successful orders (Check if your DB uses 'paid' or 'Delivered')
        const statsRes = await pool.query(
            `SELECT SUM(total_price) as revenue, COUNT(*) as orders 
             FROM orders 
             WHERE vendor_id = $1 AND (status = 'paid' OR status = 'Delivered')`, 
            [req.user.id]
        );

        // Query 2: Total products listed by this vendor
        const pCountRes = await pool.query(
            'SELECT COUNT(*) FROM products WHERE vendor_id = $1', 
            [req.user.id]
        );

        res.json({ 
            revenue: statsRes.rows[0].revenue || 0, 
            orders: statsRes.rows[0].orders || 0, 
            products: pCountRes.rows[0].count || 0 
        });
    } catch (err) { 
        console.error("Stats Error:", err.message);
        res.status(500).json({ message: "Error loading statistics" }); 
    }
});

// 5. 🔍 GET SINGLE PRODUCT
router.get('/:id', async (req, res) => {
    try {
        const product = await pool.query(
            `SELECT p.*, u.username as vendor_name FROM products p 
             JOIN users u ON p.vendor_id = u.id WHERE p.id = $1`, [req.params.id]
        );
        res.json(product.rows[0]);
    } catch (err) { res.status(500).json({ message: "Product fetch error" }); }
});

// 6. 🔄 UPDATE & DELETE
router.put('/update/:id', protect, authorize('vendor'), async (req, res) => {
    const { name, price, description, stock_count, category } = req.body;
    try {
        const updated = await pool.query(
            `UPDATE products SET name = $1, price = $2, description = $3, stock_count = $4, category = $5 
             WHERE id = $6 AND vendor_id = $7 RETURNING *`,
            [name, price, description, stock_count, category, req.params.id, req.user.id]
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