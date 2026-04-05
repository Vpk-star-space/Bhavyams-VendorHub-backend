const express = require('express');
const router = express.Router();
const { upload } = require('../config/cloudinary');
const pool = require('../db');
const { protect } = require('../middleware/authMiddleware');

// 🚀 ADD PRODUCT
router.post('/add', protect, upload.array('images', 5), async (req, res) => {
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
        res.status(201).json({ message: 'Product Added!', product: newProduct.rows[0] });
    } catch (err) { res.status(500).json({ error: 'Upload failed' }); }
});
// 📦 2. GET: Vendor Products (My Products)
router.get('/my-products', protect, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT p.*, COALESCE(AVG(r.rating), 0)::NUMERIC(10,1) AS average_rating, COUNT(r.id)::INTEGER AS total_reviews
             FROM products p LEFT JOIN reviews r ON p.id = r.product_id
             WHERE p.vendor_id = $1 GROUP BY p.id ORDER BY p.id DESC`, [req.user.id]
        );
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: "Server Error" }); }
});

// 🌐 3. GET: All Products (with Pagination)
router.get('/all', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 8; 
        const offset = (page - 1) * limit;
        const result = await pool.query(
            `SELECT p.*, COUNT(r.id)::INT AS total_reviews, ROUND(COALESCE(AVG(r.rating), 0), 1)::FLOAT AS average_rating
             FROM products p LEFT JOIN reviews r ON p.id = r.product_id
             GROUP BY p.id ORDER BY p.created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]
        );
        res.status(200).json({ products: result.rows });
    } catch (err) { res.status(500).json({error: "Could not fetch products"}); }
});

// 🔄 4. PUT: Update Product
router.put('/update/:id', protect, async (req, res) => {
    const { id } = req.params;
    const { name, price, description, stock_count, category } = req.body;
    try {
        const updatedProduct = await pool.query(
            'UPDATE products SET name = $1, price = $2, description = $3, stock_count = $4, category = $5 WHERE id = $6 AND vendor_id = $7 RETURNING *',
            [name, price, description, stock_count, category, id, req.user.id]
        );
        res.status(200).json({ message: "Product Updated!", product: updatedProduct.rows[0] });
    } catch (err) { res.status(500).send('Server Error'); }
});

// 🗑️ 5. DELETE: Remove Product Safely
router.delete('/delete/:id', protect, async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect(); 
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM orders WHERE product_id = $1', [id]);
        await client.query('DELETE FROM products WHERE id = $1 AND vendor_id = $2', [id, req.user.id]);
        await client.query('COMMIT');
        res.status(200).json({ message: "Product permanently deleted!" });
    } catch (err) { if (client) await client.query('ROLLBACK'); res.status(400).json({ message: err.message }); } finally { client.release(); }
});

// 🚚 6. GET: Vendor Orders
router.get('/vendor/my-orders', protect, async (req, res) => {
    try {
        const myOrders = await pool.query(
            `SELECT o.*, p.name as product_name, p.price FROM orders o
             JOIN products p ON o.product_id = p.id WHERE p.vendor_id = $1 AND o.status = $2`, [req.user.id, 'paid']
        );
        res.json(myOrders.rows);
    } catch (err) { res.status(500).send("Server Error"); }
});

// 💰 7. GET: Vendor Stats
router.get('/vendor/stats', protect, async (req, res) => {
    try {
        const stats = await pool.query(`SELECT SUM(total_price) as total_revenue, COUNT(*) as total_orders FROM orders WHERE status = 'paid' AND product_id IN (SELECT id FROM products WHERE vendor_id = $1)`, [req.user.id]);
        const pCount = await pool.query('SELECT COUNT(*) FROM products WHERE vendor_id = $1', [req.user.id]);
        res.json({ revenue: stats.rows[0].total_revenue || 0, orders: stats.rows[0].total_orders || 0, products: pCount.rows[0].count || 0 });
    } catch (err) { res.status(500).json({ message: "Error loading stats" }); }
});

// ⭐ 8. POST: Add Review
router.post('/:id/reviews', protect, async (req, res) => {
    const { rating, comment } = req.body;
    try {
        await pool.query("INSERT INTO reviews (user_id, product_id, rating, comment) VALUES ($1, $2, $3, $4)", [req.user.id, req.params.id, rating, comment]);
        res.json({ message: "Review added!" });
    } catch (err) { res.status(500).send("Error adding review"); }
});

// 📊 9. GET: With Ratings
router.get('/with-ratings', async (req, res) => {
    try {
        const result = await pool.query(`SELECT p.*, COUNT(r.id)::INT AS total_reviews, ROUND(COALESCE(AVG(r.rating), 0), 1)::FLOAT AS average_rating FROM products p LEFT JOIN reviews r ON p.id = r.product_id GROUP BY p.id ORDER BY p.id DESC`);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: "Server Error" }); }
});

// 🔍 10. GET: Single Product (By ID)
router.get('/:id', async (req, res) => {
    try {
        const product = await pool.query(`SELECT p.*, u.username as vendor_name FROM products p JOIN users u ON p.vendor_id = u.id WHERE p.id = $1`, [req.params.id]);
        if (product.rows.length === 0) return res.status(404).json({ message: "Product not found" });
        res.json(product.rows[0]);
    } catch (err) { res.status(500).json({ message: "Server error" }); }
});

module.exports = router;