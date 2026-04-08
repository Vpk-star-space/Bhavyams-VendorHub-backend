const jwt = require('jsonwebtoken');
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { protect, adminOnly} = require('../middleware/authMiddleware');
const { sendOTPEmail, sendWelcomeEmail } = require('../utils/emailService');
const { OAuth2Client } = require('google-auth-library');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ================== 1. GET USER ==================
router.get('/me', protect, async (req, res) => {
    try {
        const user = await pool.query(
            'SELECT id, username, email, role, address, phone, is_verified FROM users WHERE id = $1',
            [req.user.id]
        );

        if (user.rows.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }

        res.json(user.rows[0]);

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server Error" });
    }
});

// ================== 2. GOOGLE LOGIN ==================
router.post('/google-login', async (req, res) => {
    try {
        const { idToken, role } = req.body;

        if (!idToken) {
            return res.status(400).json({ message: "Token required" });
        }

        const ticket = await client.verifyIdToken({
            idToken,
            audience: process.env.GOOGLE_CLIENT_ID,
        });

        const { sub, email, name } = ticket.getPayload();

        let userRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        let user = userRes.rows[0];

        if (!user) {
            const newUser = await pool.query(
                `INSERT INTO users 
                (username, email, google_id, is_google_user, role, is_verified)
                VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
                [name, email, sub, true, role ||'customer', true] 
            );

            user = newUser.rows[0];

            sendWelcomeEmail(user.email, user.username, user.role)
                .catch(err => console.error(err));
        }

        const token = jwt.sign(
            { id: user.id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role,
                is_google_user: true
            }
        });

    } catch (err) {
        console.error(err);
        res.status(400).json({ message: "Invalid Google Token" });
    }
});

// ================== 3. SEND OTP ==================
router.post('/send-otp', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ message: "Email required" });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        await pool.query(
            'DELETE FROM otp_codes WHERE email = $1 OR expires_at < NOW()',
            [email]
        );

        await pool.query(
            `INSERT INTO otp_codes (email, code, expires_at)
             VALUES ($1, $2, NOW() + INTERVAL '10 minutes')`,
            [email, otp]
        );

        // 🚀 FIX: Try to find user to get their name, if they don't exist yet, say "Valued Customer"
        const existingUser = await pool.query('SELECT username FROM users WHERE email = $1', [email]);
        const userName = existingUser.rows.length > 0 ? existingUser.rows[0].username : "Valued Customer";

        await sendOTPEmail(email, otp, userName);

        res.json({ message: "OTP sent successfully!" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to send OTP" });
    }
});

// ================== 4. REGISTER ==================
router.post('/register-with-otp', async (req, res) => {
    try {
        const { username, email, password, role, otp } = req.body;

        if (!username || !email || !password || !otp) {
            return res.status(400).json({ message: "All fields required" });
        }

        const existing = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ message: "Email already exists" });
        }

        const otpCheck = await pool.query(
            `SELECT * FROM otp_codes 
             WHERE email = $1 AND code = $2 AND expires_at > NOW()`,
            [email, otp]
        );

        if (otpCheck.rows.length === 0) {
            return res.status(400).json({ message: "Invalid or expired OTP" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = await pool.query(
            `INSERT INTO users 
            (username, email, password_hash, role, is_verified)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, username, email, role`,
            [username, email, hashedPassword, role ||'customer', true]
        );

        await pool.query('DELETE FROM otp_codes WHERE email = $1', [email]);

        const user = newUser.rows[0]; 

        sendWelcomeEmail(email, username, user.role)
            .catch(err => console.error(err));
        
        res.status(201).json({
            message: "Registration Successful!",
            user: newUser.rows[0]
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server Error" });
    }
});

// ================== 5. LOGIN ==================
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: "Email & Password required" });
        }

        const userRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

        if (userRes.rows.length === 0) {
            return res.status(400).json({ message: "Invalid Email" });
        }

        const user = userRes.rows[0];

        if (!user.password_hash) {
            return res.status(400).json({ message: "Use Google login" });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);

        if (!isMatch) {
            return res.status(400).json({ message: "Invalid Password" });
        }

        const token = jwt.sign(
            { id: user.id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '1d' }
        );

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server Error" });
    }
});

// ================== 6. UPDATE PROFILE ==================
router.put('/update-profile', protect, async (req, res) => {
    try {
        const { username, address, phone } = req.body;

        const result = await pool.query(
            `UPDATE users 
             SET username = $1, address = $2, phone = $3
             WHERE id = $4
             RETURNING id, username, email, role, address, phone`,
            [username, address, phone, req.user.id]
        );

        res.json({
            message: "Profile updated!",
            user: result.rows[0]
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Update failed" });
    }
});

// ================== 7. ADMIN ==================
router.get('/all-users', protect, adminOnly, async (req, res) => {
    try {
        const users = await pool.query(
            'SELECT id, username, email, role, is_verified FROM users ORDER BY id ASC'
        );
        res.json(users.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server Error" });
    }
});

// ================== ADMIN: DELETE USER ==================
router.delete('/delete-user/:id', protect, adminOnly, async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect(); 
    
    try {
        await client.query('BEGIN'); 
        await client.query('DELETE FROM cart WHERE user_id = $1', [id]);
        await client.query('DELETE FROM reviews WHERE user_id = $1', [id]);
        await client.query('DELETE FROM orders WHERE user_id = $1 OR vendor_id = $1', [id]);
        await client.query('DELETE FROM products WHERE vendor_id = $1', [id]);
        
        const result = await client.query('DELETE FROM users WHERE id = $1 RETURNING *', [id]);

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: "User not found" });
        }

        await client.query('COMMIT'); 
        res.json({ message: "User and all related data deleted successfully!" });

    } catch (err) {
        await client.query('ROLLBACK'); 
        console.error("Delete Error:", err.message);
        res.status(500).json({ message: "Server Error: Could not delete user due to linked data." });
    } finally {
        client.release();
    }
});

// ================== FORGOT PASSWORD ==================
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;

        const user = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );

        if (user.rows.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiry = new Date(Date.now() + 10 * 60000);

        await pool.query(
            'UPDATE users SET reset_otp = $1, otp_expiry = $2 WHERE email = $3',
            [otp, expiry, email]
        );

        try {
            // 🚀 FIX: Passed the username to the OTP email!
            await sendOTPEmail(email, otp, user.rows[0].username);
        } catch (emailErr) {
            console.error("Email Error:", emailErr);
            console.log("OTP (fallback):", otp); 
        }

        res.json({ message: "Reset code sent!" });

    } catch (err) {
        console.error("Forgot Password Error:", err);
        res.status(500).json({ message: "Server Error" });
    }
});

// ================== 9. RESET PASSWORD ==================
router.post('/reset-password', async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;

        const user = await pool.query(
            `SELECT * FROM users 
             WHERE email = $1 AND reset_otp = $2 AND otp_expiry > NOW()`,
            [email, otp]
        );

        if (user.rows.length === 0) {
            return res.status(400).json({ message: "Invalid/Expired OTP" });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await pool.query(
            `UPDATE users 
             SET password_hash = $1, reset_otp = NULL, otp_expiry = NULL
             WHERE email = $2`,
            [hashedPassword, email]
        );

        res.json({ message: "Password reset successful!" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server Error" });
    }
});

// ================== GOOGLE CLIENT ID ==================
router.get('/google-client-id', (req, res) => {
    try {
        const clientId = process.env.GOOGLE_CLIENT_ID;

        if (!clientId) {
            console.error("❌ GOOGLE_CLIENT_ID is missing in ENV");
            return res.status(500).json({
                success: false,
                message: "Google Client ID not configured"
            });
        }

        res.json({
            success: true,
            clientId
        });

    } catch (err) {
        console.error("🔥 Error in google-client-id route:", err);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
});
// ================== ADMIN: GET ALL PRODUCTS ==================
router.get('/admin/all-products', protect, adminOnly, async (req, res) => {
    try {
        const products = await pool.query(`
            SELECT p.*, u.username as vendor_name 
            FROM products p 
            JOIN users u ON p.vendor_id = u.id 
            ORDER BY p.id DESC
        `);
        res.json(products.rows);
    } catch (err) {
        console.error("Admin Product Fetch Error:", err.message);
        res.status(500).json({ message: "Server Error fetching global inventory" });
    }
});

// ================== ADMIN: DELETE ANY PRODUCT ==================
router.delete('/admin/delete-product/:id', protect, adminOnly, async (req, res) => {
    try {
        await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
        res.json({ message: "Product removed by Admin" });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ message: "Delete failed" });
    }
});

// ================== ADMIN: GET ALL PAYMENTS ==================
router.get('/admin/all-payments', protect, adminOnly, async (req, res) => {
    try {
        const payments = await pool.query(`
            SELECT 
                o.id, 
                o.payment_id, 
                o.total_price AS amount, 
                o.status, 
                o.created_at, 
                u.username AS customer_name
            FROM orders o
            LEFT JOIN users u ON o.user_id = u.id
            WHERE o.payment_id IS NOT NULL
            ORDER BY o.created_at DESC
        `);
        res.json(payments.rows);
    } catch (err) {
        console.error("Admin Payments Fetch Error:", err.message);
        res.status(500).json({ message: "Server Error fetching transaction logs" });
    }
});

module.exports = router;