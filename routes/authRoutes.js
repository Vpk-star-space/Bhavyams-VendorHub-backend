const jwt = require('jsonwebtoken');
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, adminOnly, authorize } = require('../middleware/authMiddleware');
const { sendWelcomeEmail } = require('../utils/emailService');
const { OAuth2Client } = require('google-auth-library');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID); 

// ================== 1. GET CURRENT USER ==================
router.get('/me', protect, async (req, res) => {
    try {
        const userRes = await pool.query(
            'SELECT id, username, email, role, phone, address, latitude, longitude, language_pref FROM users WHERE id = $1',
            [req.user.id]
        );

        if (userRes.rows.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }
        
        let responseData = userRes.rows[0];

        // If the user is a vendor, fetch their specific shop profile and approval status!
        if (responseData.role === 'vendor') {
            const vendorRes = await pool.query(
                'SELECT id, business_name, category, is_approved, is_online FROM vendor_profiles WHERE user_id = $1',
                [req.user.id]
            );
            if (vendorRes.rows.length > 0) {
                responseData.vendor_profile = vendorRes.rows[0];
            }
        }

        res.json(responseData);
    } catch (err) {
        console.error("Get /me Error:", err);
        res.status(500).json({ message: "Server Error" });
    }
});

// =====================================================================
// 🔵 GOOGLE LOGIN ROUTE (Fixed Token Verification & Column Sync)
// =====================================================================
router.post('/google-login', async (req, res) => {
    const { idToken, language, role } = req.body;

    try {
        if (!idToken) {
            return res.status(400).json({ message: "Google ID Token is missing." });
        }

        // 🟢 Verify token securely with Google
        const ticket = await client.verifyIdToken({
            idToken: idToken,
            audience: process.env.GOOGLE_CLIENT_ID
        });
        const payload = ticket.getPayload();
        const email = payload.email;
        const username = payload.name;

        // Check if user already exists in your database
        let userQuery = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        let user;

        if (userQuery.rows.length > 0) {
            // 🟢 USER EXISTS: Preserve their phone and address from DB!
            user = userQuery.rows[0];
            
            // Update language_pref if provided
            await pool.query(
                'UPDATE users SET language_pref = COALESCE($1, language_pref) WHERE id = $2',
                [language, user.id]
            );
        } else {
            // 🟢 NEW USER: Insert with proper column names (language_pref)
            const newUserQuery = await pool.query(
                `INSERT INTO users (username, email, phone, address, role, language_pref) 
                 VALUES ($1, $2, '', '', $3, $4) 
                 RETURNING *`,
                [username, email, role || 'customer', language || 'en']
            );
            user = newUserQuery.rows[0];
        }

        // Generate JWT Token
        const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '30d' });

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                phone: user.phone || '', 
                address: user.address || '',
                role: user.role,
                language: user.language_pref
            }
        });

    } catch (err) {
        console.error("Google Auth Route Error:", err);
        res.status(500).json({ message: "Authentication server error: " + err.message });
    }
});

// ================== 3. VENDOR ONBOARDING ==================
router.post('/vendor-onboard', protect, authorize('vendor'), async (req, res) => {
    try {
        const { business_name, category, lat, lng } = req.body;

        if (!business_name || !category) {
            return res.status(400).json({ message: "Missing required business details." });
        }

        const existing = await pool.query('SELECT id FROM vendor_profiles WHERE user_id = $1', [req.user.id]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ message: "You have already submitted a vendor profile." });
        }

        const newVendor = await pool.query(
            `INSERT INTO vendor_profiles 
            (user_id, business_name, category, is_approved, is_online) 
            VALUES ($1, $2, $3, false, true) RETURNING *`,
            [req.user.id, business_name, category]
        );

        res.status(201).json({ 
            message: "Shop submitted successfully! Waiting for Admin approval.",
            profile: newVendor.rows[0]
        });

    } catch (err) {
        console.error("Vendor Onboard Error:", err);
        res.status(500).json({ message: "Server Error during vendor onboarding." });
    }
});

// ================== GOOGLE CLIENT ID ==================
router.get('/google-client-id', (req, res) => {
    try {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        if (!clientId) return res.status(500).json({ success: false, message: "Google Client ID not configured" });
        res.json({ success: true, clientId });
    } catch (err) {
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
});

// ================== 4. UPDATE PROFILE (Phone & Address) ==================
router.put('/update-profile', protect, async (req, res) => {
    try {
        const { username, address, phone } = req.body;

        const result = await pool.query(
            `UPDATE users 
             SET username = $1, address = $2, phone = $3
             WHERE id = $4
             RETURNING id, username, email, role, address, phone, latitude, longitude, language_pref`,
            [username, address, phone, req.user.id]
        );

        res.json({
            message: "Profile updated successfully!",
            user: result.rows[0]
        });

    } catch (err) {
        console.error("Update Profile Error:", err);
        res.status(500).json({ message: "Update failed" });
    }
});

module.exports = router;