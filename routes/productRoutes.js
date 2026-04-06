const express = require('express');
const router = express.Router();
const { upload } = require('../config/cloudinary');
const pool = require('../db');
const { protect, authorize } = require('../middleware/authMiddleware');
const { default: orders } = require('razorpay/dist/types/orders');

// 1. 🚀 ADD PRODUCT (With Multiple Images & Gallery Support)
router.post('/add', protect, authorize('vendor'), upload.array('images', 5), async (req, res) => {
    try {
        const { name, price, description, stock_count, category } = req.body;
        
        // Check if images exist
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ message: "At least one product image is required" });
        }
        
        // Cloudinary returns an array of files. We extract the 'path' (URL)
        const imageUrls = req.files.map(file => file.path); 
        const mainImage = imageUrls[0]; // First image is the thumbnail
        const galleryImages = JSON.stringify(imageUrls); // Store all as JSON string

        const newProduct = await pool.query(
            `INSERT INTO products (name, price, description, vendor_id, image_url, stock_count, category, gallery) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [name, price, description, req.user.id, mainImage, stock_count || 0, category || 'Others', galleryImages]
        );

        res.status(201).json({ 
            message: 'Product successfully added to Bhavyams Hub!', 
            product: newProduct.rows[0] 
        });
    } catch (err) { 
        console.error("Upload Error:", err);
        res.status(500).json({ error: 'Cloudinary upload or Database insert failed' }); 
    }
});

// 2. 📋 GET ALL PRODUCTS (Public - With Ratings & Pagination)
router.get('/all', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 12; 
        const offset = (page - 1) * limit;

        const result = await pool.query(
            `SELECT p.*, COUNT(r.id)::INT AS total_reviews, ROUND(COALESCE(AVG(r.rating), 0), 1)::FLOAT AS average_rating
             FROM products p LEFT JOIN reviews r ON p.id = r.product_id
             GROUP BY p.id ORDER BY p.created_at DESC LIMIT $1 OFFSET $2`, 
            [limit, offset]
        );
        res.status(200).json({ products: result.rows });
    } catch (err) { 
        res.status(500).json({ error: "Could not fetch marketplace products" }); 
    }
});

// 3. 🔍 GET SINGLE PRODUCT BY ID
router.get('/:id', async (req, res) => {
    try {
        const product = await pool.query(
            `SELECT p.*, u.username as vendor_name 
             FROM products p JOIN users u ON p.vendor_id = u.id 
             WHERE p.id = $1`, 
            [req.params.id]
        );

        if (product.rows.length === 0) return res.status(404).json({ message: "Product not found" });
        res.json(product.rows[0]);
    } catch (err) { 
        res.status(500).json({ message: "Server error fetching product details" }); 
    }
});

// 4. 📦 VENDOR: GET MY PRODUCTS
router.get('/my-products', protect, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT p.*, COALESCE(AVG(r.rating), 0)::NUMERIC(10,1) AS average_rating, COUNT(r.id)::INTEGER AS total_reviews
             FROM products p LEFT JOIN reviews r ON p.id = r.product_id
             WHERE p.vendor_id = $1 GROUP BY p.id ORDER BY p.id DESC`, 
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) { 
        res.status(500).json({ error: "Database error fetching vendor inventory" }); 
    }
});

// 5. 💰 VENDOR: GET DASHBOARD STATS (Revenue & Orders)
router.get('/vendor/stats', protect, async (req, res) => {
    try {
        const stats = await pool.query(
            `SELECT SUM(total_price) as revenue, COUNT(*) as orders 
             FROM orders 
             WHERE status = 'paid' AND product_id IN (SELECT id FROM products WHERE vendor_id = $1)`, 
            [req.user.id]
        );

        const pCount = await pool.query('SELECT COUNT(*) FROM products WHERE vendor_id = $1', [req.user.id]);

        res.json({ 
            revenue: stats.rows[0].revenue || 0, 
            orders: stats.rows[0].orders || 0, 
            products: pCount.rows[0].count || 0 
        });
    } catch (err) { 
        console.error("Stats Error:", err);
        res.status(500).json({ message: "Error loading vendor dashboard statistics" }); 
    }
});

// 6. 🚚 VENDOR: VIEW MY PAID ORDERS
router.get('/vendor/my-orders', protect, async (req, res) => {
    try {
        const myOrders = await pool.query(
            `SELECT o.*, p.name as product_name, p.price, u.username as customer_name 
             FROM orders o
             JOIN products p ON o.product_id = p.id 
             JOIN users u ON o.user_id = u.id
             WHERE p.vendor_id = $1 AND o.status = $2`, 
            [req.user.id, 'paid']
        );
        res.json(myOrders.rows);
    } catch (err) { 
        res.status(500).send("Server Error fetching vendor orders"); 
    }
});

// 7. 🔄 UPDATE PRODUCT
router.put('/update/:id', protect, async (req, res) => {
    const { id } = req.params;
    const { name, price, description, stock_count, category } = req.body;
    try {
        const updatedProduct = await pool.query(
            `UPDATE products SET name = $1, price = $2, description = $3, stock_count = $4, category = $5 
             WHERE id = $6 AND vendor_id = $7 RETURNING *`,
            [name, price, description, stock_count, category, id, req.user.id]
        );

        if (updatedProduct.rows.length === 0) {
            return res.status(403).json({ message: "You don't have permission to edit this product" });
        }
        res.status(200).json({ message: "Product Updated!", product: updatedProduct.rows[0] });
    } catch (err) { 
        res.status(500).send('Server Error during product update'); 
    }
});

// 8. 🗑️ DELETE PRODUCT (Atomic Transaction)
router.delete('/delete/:id', protect, async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect(); 
    try {
        await client.query('BEGIN');
        
        // 1. Delete associated reviews first
        await client.query('DELETE FROM reviews WHERE product_id = $1', [id]);
        
        // 2. Delete associated cart items
        await client.query('DELETE FROM cart WHERE product_id = $1', [id]);

        // 3. Delete the product (Only if it belongs to the vendor)
        const deleteRes = await client.query(
            'DELETE FROM products WHERE id = $1 AND vendor_id = $2 RETURNING *', 
            [id, req.user.id]
        );

        if (deleteRes.rows.length === 0) throw new Error("Product not found or unauthorized");

        await client.query('COMMIT');
        res.status(200).json({ message: "Product and associated data permanently deleted!" });
    } catch (err) { 
        if (client) await client.query('ROLLBACK'); 
        res.status(400).json({ message: err.message }); 
    } finally { 
        client.release(); 
    }
});

// 9. ⭐ ADD PRODUCT REVIEW
router.post('/:id/reviews', protect, async (req, res) => {
    const { rating, comment } = req.body;
    try {
        await pool.query(
            "INSERT INTO reviews (user_id, product_id, rating, comment) VALUES ($1, $2, $3, $4)", 
            [req.user.id, req.params.id, rating, comment]
        );
        res.json({ message: "Review added successfully!" });
    } catch (err) { 
        res.status(500).send("Error submitting review"); 
    }
});


// 🚀 BACKEND CHECK: routes/productRoutes.js
router.get('/vendor/stats', protect, async (req, res) => {
    try {
        // Count products for THIS vendor
        const productRes = await pool.query(
            'SELECT COUNT(*) FROM products WHERE vendor_id = $1', 
            [req.user.id]
        );

        // Calculate revenue for THIS vendor
        const revenueRes = await pool.query(
            'SELECT SUM(total_price) as total FROM orders WHERE vendor_id = $1 AND status = $2', 
            [req.user.id, 'Delivered']
        );

        res.json({
            revenue: revenueRes.rows[0].total || 0,
            orders: orders.rows[0].total || 0,
            products: productRes.rows[0].count || 0
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

module.exports = router;