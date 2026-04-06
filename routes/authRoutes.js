const jwt = require('jsonwebtoken');
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { protect } = require('../middleware/authMiddleware');
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
                [name, email, sub, true, role ||'customer', true] // ✅ FIXED ROLE
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

        await sendOTPEmail(email, otp);

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

        // check existing
        const existing = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ message: "Email already exists" });
        }

        // check otp
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

        sendWelcomeEmail(email, username,user.role)
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

        // 🔥 FIX: Google users
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
router.get('/all-users', protect, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: "Admin only" });
        }

        const users = await pool.query(
            'SELECT id, username, email, role, is_verified FROM users ORDER BY id ASC'
        );

        res.json(users.rows);

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server Error" });
    }
});

router.delete('/delete-user/:id', protect, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: "Admin only" });
        }

        await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);

        res.json({ message: "User deleted" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server Error" });
    }
});

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

        // ✅ FIX: Prevent crash if email fails
        try {
            await sendOTPEmail(email, otp);
        } catch (emailErr) {
            console.error("Email Error:", emailErr);
            console.log("OTP (fallback):", otp); // 🔥 VERY IMPORTANT FOR DEBUG
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

// ================== 10. GOOGLE CLIENT ID ==================
router.get('/google-client-id', (req, res) => {
    if (!process.env.GOOGLE_CLIENT_ID) {
        return res.status(500).json({ message: "Google Client ID not set" });
    }

    res.json({ clientId: process.env.GOOGLE_CLIENT_ID });


});



module.exports = router;