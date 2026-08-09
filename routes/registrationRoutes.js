const express = require('express');
const router = express.Router();
const axios = require('axios');
const multer = require('multer');
const pool = require('../db'); 
const { protect } = require('../middleware/authMiddleware'); 
const { upload } = require('../config/cloudinary'); 
require('dotenv').config();

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const API_KEY = process.env.BREVO_API_KEY; 
const SENDER_EMAIL = process.env.EMAIL_USER; 

// =====================================================================
// 📝 1. REGISTER A NEW SHOP
// =====================================================================
router.post('/register-interest', protect, (req, res, next) => {
    console.log("⏱️ [Step 1] Incoming request reached /register-interest route.");
    
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
        console.error("❌ [Config Error] Cloudinary environment variables are missing!");
        return res.status(500).json({ message: "Server configuration error: Cloudinary keys are missing." });
    }

    console.log("⏱️ [Step 1.5] Handing over to Multer/Cloudinary upload stream...");
    
    const uploadMiddleware = upload.fields([{ name: 'idFront', maxCount: 1 }, { name: 'idBack', maxCount: 1 }]);
    
    uploadMiddleware(req, res, function (err) {
        if (err instanceof multer.MulterError) {
            console.error("❌ [Step 2] Multer Error:", err.message);
            return res.status(400).json({ message: `Upload Error: ${err.message}` });
        } else if (err) {
            console.error("❌ [Step 2] Cloudinary Upload Error:", err.message);
            return res.status(500).json({ message: `Cloudinary Upload Failed: ${err.message}` });
        }
        console.log("✅ [Step 2] Files successfully received and uploaded to Cloudinary!");
        next();
    });
}, async (req, res) => {
    try {
        console.log("⏱️ [Step 3] Processing text data & checking database...");
        console.log("👤 Authenticated User ID:", req.user?.id);

        const { name, phone, businessName, products, location, email } = req.body;

        if (!name || !phone || !businessName || !location) {
            return res.status(400).json({ message: "Missing required text fields." });
        }

        if (!req.files || !req.files.idFront || !req.files.idBack) {
            return res.status(400).json({ message: "ID Front and Back files are required." });
        }

        const idFrontUrl = req.files.idFront[0].path;
        const idBackUrl = req.files.idBack[0].path;

        if (!req.user?.id) {
            return res.status(401).json({ message: "Unauthorized: User ID missing from token." });
        }
        
        const existing = await pool.query('SELECT id FROM vendor_profiles WHERE user_id = $1', [req.user.id]);
        if (existing.rows.length > 0) {
            console.log("⚠️ Registration Blocked: User already has a vendor profile.");
            return res.status(400).json({ message: "You already have a shop application pending or approved." });
        }

        console.log("⏱️ [Step 4] Inserting shop into database...");
        await pool.query(
            `INSERT INTO vendor_profiles 
            (user_id, business_name, category, id_front_url, id_back_url, is_approved) 
            VALUES ($1, $2, $3, $4, $5, false)`,
            [req.user.id, businessName, products, idFrontUrl, idBackUrl]
        );
        console.log("✅ [Step 4] Successfully saved shop to Database!");

        res.status(200).json({ message: "Registration successful! Admin is reviewing your ID proof." });

        if (API_KEY && SENDER_EMAIL) {
            axios.post(BREVO_API_URL, {
                sender: { name: "Subhams Hub System", email: SENDER_EMAIL },
                to: [{ email: "pavanvenkat63@gmail.com", name: "Venkata Pavan Kumar" }],
                subject: `🔔 ID VERIFICATION REQUIRED: ${businessName}`,
                htmlContent: `<p>New shop registered: ${businessName}</p>`
            }, {
                headers: { 'accept': 'application/json', 'api-key': API_KEY, 'content-type': 'application/json' }
            }).catch(emailErr => {
                console.warn("⚠️ Background Email Warning (Ignored):", emailErr.message);
            });
        }

    } catch (error) {
        console.error("❌ [CRITICAL ERROR] Database or Server Crash:", error.message);
        if (!res.headersSent) {
            res.status(500).json({ message: error.message || "Database error during registration." });
        }
    }
});

// =====================================================================
// 🏪 2. GET MY SHOP & PRODUCTS (Dashboard Gateway)
// =====================================================================
router.get('/my-shop', protect, async (req, res) => {
    try {
        const shopQuery = await pool.query(
            'SELECT * FROM vendor_profiles WHERE user_id = $1',
            [req.user.id]
        );

        // 🟢 FIX: Return 200 OK with `hasShop: false` instead of throwing a 404 Error
        if (shopQuery.rows.length === 0) {
            return res.json({ hasShop: false }); 
        }

        const shop = shopQuery.rows[0];

        if (!shop.is_approved) {
            return res.json({ hasShop: true, shop: shop, products: [] });
        }

        const productsQuery = await pool.query(
            'SELECT * FROM products WHERE vendor_id = $1 ORDER BY created_at DESC',
            [shop.id]
        );

        res.json({
            hasShop: true,
            shop: shop,
            products: productsQuery.rows
        });

    } catch (err) {
        console.error("Fetch Shop Error:", err);
        res.status(500).json({ message: "Failed to load shop profile." });
    }
});

// =====================================================================
// 🟢 3. TOGGLE ONLINE/OFFLINE STATUS
// =====================================================================
router.put('/toggle-status', protect, async (req, res) => {
    const { is_online } = req.body;
    try {
        await pool.query(
            'UPDATE vendor_profiles SET is_online = $1 WHERE user_id = $2',
            [is_online, req.user.id]
        );
        res.json({ message: `Shop is now ${is_online ? 'Online' : 'Offline'}` });
    } catch (err) {
        console.error("Toggle Status Error:", err);
        res.status(500).json({ message: "Failed to update status." });
    }
});

module.exports = router;