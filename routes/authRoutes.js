const jwt = require('jsonwebtoken');
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../db');
const Joi = require('joi');
const { protect } = require('../middleware/authMiddleware');
const { sendOTPEmail, sendWelcomeEmail } = require('../utils/emailService');
const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// 1. 🛡️ GET LOGGED IN USER DATA (CRITICAL FOR PROFILE & PHONE UI)
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
        console.error("Me Route Error:", err.message);
        res.status(500).send("Server Error");
    }
});

// 2. 🔑 GOOGLE LOGIN (FIXED FOR NEW USERS & REDIRECTS)
router.post('/google-login', async (req, res) => {
    const { idToken, role } = req.body;
    try {
        const ticket = await client.verifyIdToken({
            idToken,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        
        const { sub, email, name } = ticket.getPayload();

        let userRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        let user = userRes.rows[0];

        if (!user) {
            // New Google User Registration
            const newUser = await pool.query(
                'INSERT INTO users (username, email, google_id, is_google_user, role, is_verified) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
                [name, email, sub, true, role || 'customer', true]
            );
            user = newUser.rows[0];
            
            // Send Welcome Email asynchronously so it doesn't slow down login
            sendWelcomeEmail(user.email, user.username, user.role).catch(e => console.error("Welcome Mail Error:", e));
        } else if (!user.google_id) {
            // Linking existing manual account to Google
            await pool.query('UPDATE users SET google_id = $1, is_google_user = $2 WHERE id = $3', [sub, true, user.id]);
        }

        const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });

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
        console.error("Google Auth Error:", err);
        res.status(400).json({ message: "Invalid Google Token" });
    }
});

// 3. 📧 SEND OTP (FIXED: Uses UTC Time to prevent Render/Vercel timezone errors)
router.post('/send-otp', async (req, res) => {
    const { email } = req.body;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    try {
        // Cleanup expired and old codes for this email
        await pool.query('DELETE FROM otp_codes WHERE email = $1 OR expires_at < NOW()', [email]);

        // Insert new OTP with 10-minute validity
        await pool.query(
            "INSERT INTO otp_codes (email, code, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes')", 
            [email, otp]
        );

        await sendOTPEmail(email, otp);
        res.status(200).json({ message: "OTP sent! Check your inbox (and spam folder)." });
    } catch (err) {
        console.error("OTP Error:", err);
        res.status(500).json({ error: "Failed to send OTP. Check Render logs." });
    }
});

// 📝 4. REGISTER WITH OTP (PRODUCTION VALIDATION)
router.post('/register-with-otp', async (req, res) => {
    const { username, email, password, role, otp } = req.body;
    try {
        // Verify OTP still exists and hasn't expired
        const otpCheck = await pool.query(
            'SELECT * FROM otp_codes WHERE email = $1 AND code = $2 AND expires_at > NOW()',
            [email, otp]
        );

        if (otpCheck.rows.length === 0) {
            return res.status(400).json({ message: "Invalid or expired OTP code!" });
        }

        // Check if user exists
        const userExists = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userExists.rows.length > 0) return res.status(400).json({ message: 'Email already registered' });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = await pool.query(
            'INSERT INTO users (username, email, password_hash, role, is_verified) VALUES ($1, $2, $3, $4, $5) RETURNING id, username, email, role',
            [username, email, hashedPassword, role || 'customer', true]
        );

        // Delete used OTP
        await pool.query('DELETE FROM otp_codes WHERE email = $1', [email]);
        
        sendWelcomeEmail(email, username, role || 'customer').catch(e => console.error(e));

        res.status(201).json({ message: 'Registration Successful!', user: newUser.rows[0] });
    } catch (err) {
        console.error("Registration Error:", err.message);
        res.status(500).send('Server Error');
    }
});

// 5. 🔓 MANUAL LOGIN
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const userRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userRes.rows.length === 0) return res.status(400).json({message: 'Invalid Email'});

        const user = userRes.rows[0];
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) return res.status(400).json({message: 'Invalid Password'});

        const accessToken = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1d'});
        
        res.status(200).json({
            message: `Welcome back, ${user.username}!`,
            accessToken,
            user: { id: user.id, username: user.username, email: user.email, role: user.role }
        });
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

// 6. 🛠️ PROFILE UPDATE (FIXED FOR PHONE/UI SYNC)
router.put('/update-profile', protect, async (req, res) => {
    const { username, address, phone } = req.body;
    try {
        const result = await pool.query(
            `UPDATE users SET username = $1, address = $2, phone = $3 WHERE id = $4 
             RETURNING id, username, email, role, address, phone, is_verified`,
            [username, address, phone, req.user.id]
        );

        if (result.rows.length === 0) return res.status(404).json({ message: "User not found" });

        res.json({ message: "Profile updated!", user: result.rows[0] });
    } catch (err) {
        res.status(500).json({ message: "Update failed", error: err.message });
    }
});

// 7. 🗑️ DELETE ACCOUNT
router.delete('/delete-account', protect, async (req, res) => {
    try {
        await pool.query('DELETE FROM users WHERE id = $1', [req.user.id]);
        res.status(200).json({ message: "Account deleted." });
    } catch (err) {
        res.status(500).send("Delete Failed");
    }
});

module.exports = router;