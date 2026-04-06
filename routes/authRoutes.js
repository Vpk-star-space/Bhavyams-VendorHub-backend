const jwt = require('jsonwebtoken');
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../db');
const Joi = require('joi');
const { protect } = require('../middleware/authmMddleware');
const { sendOTPEmail, sendWelcomeEmail } = require('../utils/emailService');
const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// 1. 👤 GET LOGGED IN USER DATA
router.get('/me', protect, async (req, res) => {
    try {
        const user = await pool.query(
            'SELECT id, username, email, role, address, phone, is_verified FROM users WHERE id = $1', 
            [req.user.id]
        );
        if (user.rows.length === 0) return res.status(404).json({ message: "User not found" });
        res.json(user.rows[0]); 
    } catch (err) {
        res.status(500).send("Server Error");
    }
});

// 2. 🔑 GOOGLE LOGIN
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
            const newUser = await pool.query(
                'INSERT INTO users (username, email, google_id, is_google_user, role, is_verified) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
                [name, email, sub, true, role || 'customer', true]
            );
            user = newUser.rows[0];
            sendWelcomeEmail(user.email, user.username, user.role).catch(e => console.error(e));
        }
        const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: user.id, username: user.username, email: user.email, role: user.role, is_google_user: true } });
    } catch (err) {
        res.status(400).json({ message: "Invalid Google Token" });
    }
});

// 3. 📧 OTP SYSTEM (Fixed for Global Timezones)
router.post('/send-otp', async (req, res) => {
    const { email } = req.body;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    try {
        await pool.query('DELETE FROM otp_codes WHERE email = $1 OR expires_at < NOW()', [email]);
        await pool.query("INSERT INTO otp_codes (email, code, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes')", [email, otp]);
        await sendOTPEmail(email, otp);
        res.status(200).json({ message: "OTP sent successfully!" });
    } catch (err) {
        res.status(500).json({ error: "Failed to send OTP" });
    }
});

// 4. 📝 REGISTER WITH OTP
router.post('/register-with-otp', async (req, res) => {
    const { username, email, password, role, otp } = req.body;
    try {
        const otpCheck = await pool.query('SELECT * FROM otp_codes WHERE email = $1 AND code = $2 AND expires_at > NOW()', [email, otp]);
        if (otpCheck.rows.length === 0) return res.status(400).json({ message: "Invalid or expired OTP" });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const newUser = await pool.query(
            'INSERT INTO users (username, email, password_hash, role, is_verified) VALUES ($1, $2, $3, $4, $5) RETURNING id, username, email, role',
            [username, email, hashedPassword, role || 'customer', true]
        );
        await pool.query('DELETE FROM otp_codes WHERE email = $1', [email]);
        sendWelcomeEmail(email, username, role || 'customer').catch(e => console.error(e));
        res.status(201).json({ message: 'Registration Successful!', user: newUser.rows[0] });
    } catch (err) {
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
        res.status(200).json({ accessToken, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

// 6. 🛠️ PROFILE UPDATE
router.put('/update-profile', protect, async (req, res) => {
    const { username, address, phone } = req.body;
    try {
        const result = await pool.query(
            'UPDATE users SET username = $1, address = $2, phone = $3 WHERE id = $4 RETURNING id, username, email, role, address, phone',
            [username, address, phone, req.user.id]
        );
        res.json({ message: "Profile updated!", user: result.rows[0] });
    } catch (err) {
        res.status(500).json({ message: "Update failed" });
    }
});

// 7. 👑 ADMIN: MANAGE USERS
router.get('/all-users', protect, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    const users = await pool.query('SELECT id, username, email, role, is_verified FROM users ORDER BY id ASC');
    res.json(users.rows);
});

router.delete('/delete-user/:id', protect, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ message: "User deleted" });
});

// 8. 🔐 FORGOT & RESET PASSWORD
router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 10 * 60000);
    const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (user.rows.length === 0) return res.status(404).json({ message: "User not found" });
    await pool.query('UPDATE users SET reset_otp = $1, otp_expiry = $2 WHERE email = $3', [otp, expiry, email]);
    await sendOTPEmail(email, otp);
    res.json({ message: "Reset code sent!" });
});

router.post('/reset-password', async (req, res) => {
    const { email, otp, newPassword } = req.body;
    const user = await pool.query('SELECT * FROM users WHERE email = $1 AND reset_otp = $2 AND otp_expiry > NOW()', [email, otp]);
    if (user.rows.length === 0) return res.status(400).json({ message: "Invalid/Expired OTP" });
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    await pool.query('UPDATE users SET password_hash = $1, reset_otp = NULL, otp_expiry = NULL WHERE email = $2', [hashedPassword, email]);
    res.json({ message: "Password reset successful!" });
});

module.exports = router;