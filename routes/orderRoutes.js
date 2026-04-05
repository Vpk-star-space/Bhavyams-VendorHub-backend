const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect } = require('../middleware/authMiddleware');
const Razorpay = require('razorpay');
const crypto = require('crypto');
// 🛡️ IMPORT BOTH EMAIL FUNCTIONS (Required for your mails to work)
const { sendOrderEmail, sendDeliveryEmail } = require('../utils/emailService'); 

require('dotenv').config(); 

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// 🔑 ROUTE 1: Provide Public Key ID to Frontend
router.get('/get-razorpay-key', (req, res) => {
    res.json({ key: process.env.RAZORPAY_KEY_ID });
});

// 🛒 ROUTE 2: CHECKOUT (Create Razorpay Order ID)
router.post('/checkout', protect, async (req, res) => {
    const { cartItems } = req.body; 
    try {
        let totalCartPrice = 0;
        for (let item of cartItems) {
            totalCartPrice += Number(item.price) * item.quantity;
        }

        const options = {
            amount: Math.round(totalCartPrice * 100), // Amount in paise
            currency: "INR",
            receipt: `receipt_${Date.now()}`
        };

        const rzpOrder = await razorpay.orders.create(options);
        res.status(201).json({ razorpayOrder: rzpOrder });

    } catch (err) {
        console.error("Checkout Error:", err.message);
        res.status(400).json({ message: err.message }); 
    }
});

// ✅ ROUTE 3: VERIFY PAYMENT
router.post('/verify-payment', protect, async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, cartItems } = req.body;
    const shasum = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET);
    shasum.update(`${razorpay_order_id}|${razorpay_payment_id}`);
    const digest = shasum.digest('hex');

    if (digest !== razorpay_signature) return res.status(400).json({ message: "Invalid Signature!" });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const userRes = await client.query('SELECT email, address FROM users WHERE id = $1', [req.user.id]);
        const userEmail = userRes.rows[0]?.email;
        const deliveryAddress = userRes.rows[0]?.address || "No Address Found";

        for (let item of cartItems) {
            // 🛡️ SYSTEM FIX 1: Added 'image_url' to the SELECT query for the new emails
            const productRes = await client.query("SELECT vendor_id, delivery_minutes, name, image_url FROM products WHERE id = $1", [item.id]);
            const prod = productRes.rows[0];
            
            // 🛡️ Get the correct vendor from the product
            const vendorId = prod?.vendor_id || 1; 
            const waitTimeMins = prod?.delivery_minutes || 6;

            const orderRes = await client.query(
                `INSERT INTO orders (user_id, vendor_id, product_id, quantity, total_price, status, delivery_address, payment_id, delivery_minutes) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
                [req.user.id, vendorId, item.id, item.quantity, (item.price * item.quantity), 'Confirmed', deliveryAddress, razorpay_payment_id, waitTimeMins]
            );
            
            const orderId = orderRes.rows[0].id;

            // 🛡️ SYSTEM FIX 2: Create the payload exactly as your new emailService expects
            const orderPayload = {
                order_id: orderId,
                product_name: prod.name,
                total_price: (item.price * item.quantity),
                image_url: prod.image_url
            };

            // 📧 Send Order Confirmation Email with Image
            await sendOrderEmail(userEmail, orderPayload);

            setTimeout(async () => {
                try {
                    await pool.query("UPDATE orders SET status = 'Delivered' WHERE id = $1", [orderId]);
                    // 📧 Send Delivery Email with Image
                    if (sendDeliveryEmail) await sendDeliveryEmail(userEmail, orderPayload);
                } catch (err) { console.error("Timer Error:", err.message); }
            }, waitTimeMins * 60 * 1000);
        }
        await client.query('COMMIT');
        res.json({ status: "success" });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ message: err.message });
    } finally { client.release(); }
});
// 📈 VENDOR SALES
router.get('/my-sales', protect, async (req, res) => {
    try {
        const sales = await pool.query(
            `SELECT o.id AS order_id, o.quantity, o.total_price, o.created_at, o.status, 
                    p.name AS product_name, p.image_url
             FROM orders o
             JOIN products p ON o.product_id = p.id
             WHERE o.vendor_id = $1 ORDER BY o.created_at DESC`,
            [req.user.id]
        );
        res.status(200).json(sales.rows);
    } catch (err) { res.status(500).json({ message: "Error fetching sales" }); }
});

// 📦 ROUTE 5: Manual Create Order (Backup)
router.post('/create-order', protect, async (req, res) => {
    const { productId, address } = req.body;
    try {
        // 🛡️ SYSTEM FIX 2: Must select 'vendor_id' from products
        const productRes = await pool.query("SELECT vendor_id, delivery_minutes, price, email FROM products WHERE id = $1", [productId]);
        const deliveryMinutes = productRes.rows[0].delivery_minutes || 6;
        
        const newOrder = await pool.query(
            "INSERT INTO orders (user_id, vendor_id, product_id, status, delivery_address, delivery_minutes, total_price) VALUES ($1, $2, $3, 'Confirmed', $4, $5, $6) RETURNING *",
            [req.user.id, productRes.rows[0].vendor_id, productId, address, deliveryMinutes, productRes.rows[0].price]
        );
        const orderId = newOrder.rows[0].id;

        res.json({ message: "Order Confirmed!", orderId });

        setTimeout(async () => {
            try {
                await pool.query("UPDATE orders SET status = 'Delivered' WHERE id = $1", [orderId]);
                if (sendDeliveryEmail) await sendDeliveryEmail(req.user.email, orderId);
            } catch (err) { console.error("Auto-delivery failed"); }
        }, deliveryMinutes * 60 * 1000);

    } catch (err) {
        res.status(500).send("Order placement failed");
    }
});

// 🚚 CUSTOMER ORDERS 
router.get('/my-orders', protect, async (req, res) => {
    try {
        const orders = await pool.query(
            `SELECT o.*, p.name AS product_name, p.image_url,
                    r.rating AS existing_rating, r.comment AS existing_comment
             FROM orders o
             JOIN products p ON o.product_id = p.id
             LEFT JOIN reviews r ON o.id = r.order_id
             WHERE o.user_id = $1 
             ORDER BY o.created_at DESC`, 
            [req.user.id]
        );
        res.json(orders.rows);
    } catch (err) { res.status(500).send("Server Error"); }
});

router.post('/add-review', protect, async (req, res) => {
    const { orderId, productId, rating, comment } = req.body;
    try {
        await pool.query(
            `INSERT INTO reviews (user_id, product_id, order_id, rating, comment) VALUES ($1, $2, $3, $4, $5)`,
            [req.user.id, productId, orderId, parseInt(rating), comment]
        );
        res.json({ status: "success", message: "Review saved!" });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// 🛡️ ADMIN: ALL ORDERS
router.get('/admin-all', protect, async (req, res) => {
    try {
        if (req.user.role.toLowerCase() !== 'admin') return res.status(403).json({ message: "Denied" });
        const allOrders = await pool.query(
            `SELECT o.*, p.name as product_name, p.image_url, u.username as customer_name 
             FROM orders o 
             JOIN products p ON o.product_id = p.id 
             JOIN users u ON o.user_id = u.id 
             ORDER BY o.created_at DESC`
        );
        res.json(allOrders.rows);
    } catch (err) { res.status(500).send("Admin Error"); }
});

module.exports = router;