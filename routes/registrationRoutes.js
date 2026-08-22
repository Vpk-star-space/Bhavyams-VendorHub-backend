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
// 🚨 SMART SECURITY: ILLEGAL & BAD WORD SCANNER
// =====================================================================
const ILLEGAL_WORDS = ['weapon', 'gun', 'drugs', 'fake', 'scam', 'illegal', 'murder', 'blood', 'sex', 'porn', 'abuse']; 

const containsBadWords = (text) => {
    if (!text) return false;
    const lowerText = text.toLowerCase();
    // Returns true if any illegal word is found in the text
    return ILLEGAL_WORDS.some(word => lowerText.includes(word));
};

// =====================================================================
// 📝 1. REGISTER A NEW SHOP (SECURE UPLOADS)
// =====================================================================
router.post('/register-interest', protect, (req, res, next) => {
    console.log("⏱️ [Step 1] Incoming request reached /register-interest route.");
    
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
        return res.status(500).json({ message: "Server configuration error: Cloudinary keys are missing." });
    }

    // 🟢 FIX: We now tell Multer to accept our new optional files!
    const uploadMiddleware = upload.fields([
        { name: 'idFront', maxCount: 1 }, 
        { name: 'idBack', maxCount: 1 },
        { name: 'shopPhoto', maxCount: 1 },   // New Image
        { name: 'certificate', maxCount: 1 }  // New Doc/Image
    ]);
    
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

        // 🟢 Get all the new smart fields from React
        const { name, phone, businessName, products, shop_type, work_mode, location, email } = req.body;

        // 🚨 SECURITY CHECK: If they typed bad words, block them immediately!
        if (containsBadWords(businessName) || containsBadWords(products)) {
            console.log("⚠️ SECURITY ALERT: Vendor tried to register illegal keywords.");
            return res.status(403).json({ message: "SECURITY ALERT: Illegal or prohibited words detected. Your registration is blocked." });
        }

        if (!name || !phone || !businessName || !location) {
            return res.status(400).json({ message: "Missing required text fields." });
        }

        // 🟢 SAFELY EXTRACT FILES (Some might be missing if they work from home)
        if (!req.files || !req.files.idFront || !req.files.idBack) {
            return res.status(400).json({ message: "ID Front and Back files are required." });
        }
        

        const idFrontUrl = req.files.idFront[0].path;
        const idBackUrl = req.files.idBack[0].path;
        // If shop photo exists, grab it. Otherwise, null.
        const shopPhotoUrl = req.files.shopPhoto ? req.files.shopPhoto[0].path : null;
        // If certificate exists, grab it. Otherwise, null.
        const certificateUrl = req.files.certificate ? req.files.certificate[0].path : null;

        const existing = await pool.query('SELECT id FROM vendor_profiles WHERE user_id = $1', [req.user.id]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ message: "You already have a shop application pending or approved." });
        }

        console.log("⏱️ [Step 4] Inserting shop into database...");
        
        // 🟢 UPDATE DATABASE TO SAVE ALL THE NEW DATA
     await pool.query(
    `INSERT INTO vendor_profiles 
    (user_id, business_name, category, shop_type, work_mode, location, email, id_front_url, id_back_url, shop_image, business_certificate, is_approved) 
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false)`,
    [req.user.id, businessName, products, shop_type, work_mode, location, email, idFrontUrl, idBackUrl, shopPhotoUrl, certificateUrl]
);
        console.log("✅ [Step 4] Successfully saved shop to Database!");
        

        res.status(200).json({ message: "Registration successful! Admin is reviewing your details." });

        if (API_KEY && SENDER_EMAIL) {
            axios.post(BREVO_API_URL, {
                sender: { name: "Subhams Hub System", email: SENDER_EMAIL },
                to: [{ email: "pavanvenkat63@gmail.com", name: "Venkata Pavan Kumar" }],
                subject: `🔔 NEW SHOP REGISTRATION: ${businessName}`,
                htmlContent: `<p>A new shop has registered and requires Admin Approval.</p>
                              <p><b>Name:</b> ${businessName}</p>
                              <p><b>Type:</b> ${shop_type} (${work_mode})</p>`
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
// 🏪 GET MY SHOP & PRODUCTS (Dashboard Gateway)
// =====================================================================
router.get('/my-shop', protect, async (req, res) => {
    try {
        // 🟢 FIX: Ensure we explicitly select ALL columns, including status_note and location
        const shopQuery = await pool.query(
            'SELECT id, user_id, business_name, category, shop_type, work_mode, location, email, is_approved, status_note FROM vendor_profiles WHERE user_id = $1',
            [req.user.id]
        );

        if (shopQuery.rows.length === 0) {
            return res.json({ hasShop: false }); 
        }

        const shop = shopQuery.rows[0];

        if (!shop.is_approved) {
            // Send the pending shop details (WITH THE ADMIN MESSAGE) back to the user
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

// =====================================================================
// 📝 1.5 UPDATE PENDING SHOP REGISTRATION
// =====================================================================
router.put('/update-registration', protect, (req, res, next) => {
    const uploadMiddleware = upload.fields([
        { name: 'idFront', maxCount: 1 }, 
        { name: 'idBack', maxCount: 1 },
        { name: 'shopPhoto', maxCount: 1 },
        { name: 'certificate', maxCount: 1 }
    ]);
    
    uploadMiddleware(req, res, (err) => {
        if (err) return res.status(400).json({ message: "Upload Error" });
        next();
    });
}, async (req, res) => {
    try {
        const { businessName, products, shop_type, work_mode } = req.body;
        
        const existing = await pool.query('SELECT * FROM vendor_profiles WHERE user_id = $1', [req.user.id]);
        if (existing.rows.length === 0) return res.status(404).json({ message: "No application found to update." });
        
        const shop = existing.rows[0];

        // Keep the old images if the user didn't upload new ones
        const idFrontUrl = req.files.idFront ? req.files.idFront[0].path : shop.id_front_url;
        const idBackUrl = req.files.idBack ? req.files.idBack[0].path : shop.id_back_url;
        const shopPhotoUrl = req.files.shopPhoto ? req.files.shopPhoto[0].path : shop.shop_image;
        const certificateUrl = req.files.certificate ? req.files.certificate[0].path : shop.business_certificate;
await pool.query(
    `UPDATE vendor_profiles 
     SET business_name = $1, category = $2, shop_type = $3, work_mode = $4, location = $5, email = $6,
         id_front_url = $7, id_back_url = $8, shop_image = $9, business_certificate = $10 
     WHERE user_id = $11`,
    [businessName, products, shop_type, work_mode, location, email, idFrontUrl, idBackUrl, shopPhotoUrl, certificateUrl, req.user.id]
);

        res.status(200).json({ message: "Application updated successfully!" });
    } catch (error) {
        console.error("Update Error:", error.message);
        res.status(500).json({ message: "Database error during update." });
    }
});

module.exports = router;