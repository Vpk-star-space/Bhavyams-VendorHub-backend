const jwt = require('jsonwebtoken');
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../db');
const Joi = require('joi');
const { protect } = require('../middleware/authMiddleware');
const crypto = require('crypto');
const { sendOTPEmail,sendWelcomeEmail } = require('../utils/emailService');
const { OAuth2Client } = require('google-auth-library');
const client= new OAuth2Client(process.env.GOOGLE_CLIENT_ID);




// 🛡️ FIX: This route provides the data when the Profile page loads
router.get('/me', protect, async (req, res) => {
    try {
        const user = await pool.query(
            'SELECT id, username, email, role, address, phone, is_verified FROM users WHERE id = $1', 
            [req.user.id]
        );

        if (user.rows.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }

        // This sends the "Konanki" data to your React app
        res.json(user.rows[0]); 
    } catch (err) {
        console.error("Error fetching user:", err.message);
        res.status(500).send("Server Error");
    }
});
router.get('/google-client-id', (req, res) => {
    res.json({ clientId: process.env.GOOGLE_CLIENT_ID });
});



    // 🛡️ Add this in your Backend routes
router.get('/google-client-id', (req, res) => {
    res.json({ clientId: process.env.GOOGLE_CLIENT_ID });
})



// 🛡️ GOOGLE LOGIN ROUTE
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
            // 1. Create new user
            const newUser = await pool.query(
                'INSERT INTO users (username, email, google_id, is_google_user, role, is_verified) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
                [name, email, sub, true, role || 'customer', true] // Default role is customer
            );
            user = newUser.rows[0];

            // 🚀 2. SEND WELCOME EMAIL HERE!
            try {
                // We pass user.email, user.username, and user.role
                await sendWelcomeEmail(user.email, user.username, user.role);
                console.log("Welcome Email sent to Google User:", user.email);
            } catch (mailErr) {
                console.error("Failed to send welcome email:", mailErr);
                // We don't crash the login even if email fails
            }

        } else if (!user.google_id) {
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
                is_google_user: user.is_google_user,
                needsPassword: user.password_hash ? false : true 
            }
        });

    } catch (err) {
        console.error("Google Auth Error:", err);
        res.status(400).json({ message: "Invalid Google Token" });
    }
});



router.post('/register-with-otp', async (req, res) => {
    // 1. Updated Joi Schema (Now includes OTP validation)
    const schema = Joi.object({
        username: Joi.string().min(3).max(30).required(),
       email: Joi.string().email({ minDomainSegments: 2, tlds: { allow: ['com', 'net', 'in', 'org'] } }).required(),
        password: Joi.string().min(6).required(),
        role: Joi.string().valid('customer', 'vendor').optional(),
        otp: Joi.string().length(6).required() // 👈 CRITICAL: Must be exactly 6 digits
    });

    const { error } = schema.validate(req.body);
    if (error) {
        return res.status(400).json({ message: error.details[0].message });
    }

    const { username, email, password, role, otp } = req.body;

    try {
        // 2. STEP 1: Verify the OTP from the 'otp_codes' table
        const otpCheck = await pool.query(
            'SELECT * FROM otp_codes WHERE email = $1 AND code = $2 AND expires_at > CURRENT_TIMESTAMP',
            [email, otp]
        );

        if (otpCheck.rows.length === 0) {
            return res.status(400).json({ message: "Invalid or expired OTP code!" });
        }

        // 3. STEP 2: Check if user already exists
        const userExists = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userExists.rows.length > 0) {
            return res.status(400).json({ message: 'User already exists with this email' });
        }

        // 4. STEP 3: Hash the password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // 5. STEP 4: Insert into PostgreSQL
        const newUser = await pool.query(
            'INSERT INTO users (username, email, password_hash, role, is_verified) VALUES ($1, $2, $3, $4, $5) RETURNING id, username, email, role',
            [username, email, hashedPassword, role || 'customer', true]
        );

        // 6. STEP 5: CLEANUP (Delete the used OTP so it can't be used again)
        await pool.query('DELETE FROM otp_codes WHERE email = $1', [email]);

        await sendWelcomeEmail(newUser.rows[0].email, username, newUser.rows[0].role);
        res.status(201).json({
            message: 'Registration Successful! Check your email for a welcome gift!',
            user: newUser.rows[0]
        });

    } catch (err) {
        console.error("Registration Error:", err.message);
        res.status(500).send('Server Error');
    }
});


router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
    const userRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (userRes.rows.length === 0) {
        return res.status(400).json({message: 'Invalid Credetials (Email not found)'});

    }
    const user = userRes.rows[0];

    const isMatch = await bcrypt.compare(password, user.password_hash);
    
    if (!isMatch) {
        return res.status(400).json({message: 'Invalid Credentials (Wrong Password)'});

    }
    const accessToken = jwt.sign(
        { id: user.id, role: user.role, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: '1d'} 
    );
    const refreshToken = jwt.sign(
        {
            id: user.id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

    
    res.status(200).json({
        message: `Welcome back, ${user.username}!`,
        accessToken,
        refreshToken,
        user: {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role
        }
    });

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});



// 🔒 A Secret Route for Testing the Token
router.get('/profile', protect, (req, res) => {
    // If the token is good, 'req.user' will have the ID and Role
    res.json({
        message: "🔓 Access Granted! You are viewing a private profile.",
        your_id: req.user.id,
        your_role: req.user.role
    });
});

router.post('/send-otp', async (req, res) => {

    const schema = Joi.object({
        email: Joi.string().email().required()
    });

    const { error } = schema.validate(req.body);
    if (error) {
        return res.status(400).json({ message: "Please provide a valid email address (e.g., name@gmail.com)" });
    }

    const { email } = req.body;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    try {
        // 🧹 1. Global Cleanup: Delete ALL expired codes from the table
        await pool.query('DELETE FROM otp_codes WHERE expires_at < CURRENT_TIMESTAMP');

        // 🧹 2. Specific Cleanup: Delete previous codes for THIS email
        await pool.query('DELETE FROM otp_codes WHERE email = $1', [email]);

        // 🕒 3. Insert new OTP with 5-minute validity
        await pool.query(
            `INSERT INTO otp_codes (email, code, expires_at) 
             VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '5 minutes')`, 
            [email, otp]
        );

        // 📧 4. Send the Email
        await sendOTPEmail(email, otp);

        res.status(200).json({ message: "OTP sent! It is valid for 5 minutes." });
    } catch (err) {
        console.error("OTP Error:", err);
        res.status(500).json({ error: "Failed to send OTP. Check your connection." });
    }
});
router.post('/logout', (req, res) => {
    // On the frontend, we will remove the token from localStorage
    res.status(200).json({ message: "Logged out successfully. Token cleared on client." });
});

router.delete('/delete-account', protect, async (req, res) => {
    try {
        await pool.query('DELETE FROM users WHERE id = $1', [req.user.id]);
        res.status(200).json({ message: "Account deleted forever." });
    } catch (err) {
        res.status(500).send("Delete Failed");
    }
});


// 🛡️ Route for Google Users to set their first password
router.post('/set-initial-password', protect, async (req, res) => {
    const { password } = req.body;
    const userId = req.user.id; // From your 'protect' middleware

    try {
        // 1. Hash the new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // 2. Update the DB
        await pool.query(
            'UPDATE users SET password_hash = $1 WHERE id = $2',
            [hashedPassword, userId]
        );

        res.json({ message: "Password set successfully! You can now login with Email or Google." });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error setting password" });
    }
});

// 👑 GET ALL USERS (Admin Only)
router.get('/all-users', protect, async (req, res) => {
    try {
        // 🛡️ Security Check: Double check if the user is actually an admin
        if (req.user.role.toLowerCase() !== 'admin') {
            return res.status(403).json({ message: "Access denied. Admins only." });
        }

        const users = await pool.query(
            'SELECT id, username, email, role, is_google_user, is_verified FROM users ORDER BY id ASC'
        );
        res.json(users.rows);
    } catch (err) {
        res.status(500).json({ message: "Server error fetching users" });
    }
});

// 🛡️ ADMIN: DELETE USER (FIXED: Safely cleans up all database ties first)
router.delete('/delete-user/:id', protect, async (req, res) => {
    const userId = req.params.id;
    const client = await pool.connect();
    
    try {
        if (req.user.role.toLowerCase() !== 'admin') {
            return res.status(403).json({ message: "Admin access required" });
        }

        await client.query('BEGIN'); // Start safe transaction

        // 1. Delete all reviews made by this user
        await client.query('DELETE FROM reviews WHERE user_id = $1', [userId]);

        // 2. Delete all orders placed by this user (as a customer)
        await client.query('DELETE FROM orders WHERE user_id = $1', [userId]);

        // 3. Delete all orders sold by this user (if they are a vendor)
        await client.query('DELETE FROM orders WHERE vendor_id = $1', [userId]);

        // 4. Delete all products listed by this user (if they are a vendor)
        await client.query('DELETE FROM products WHERE vendor_id = $1', [userId]);

        // 5. Finally, delete the actual user account!
        await client.query('DELETE FROM users WHERE id = $1', [userId]);

        await client.query('COMMIT'); // Save all changes
        res.json({ message: "User and all associated data safely deleted." });

    } catch (error) {
        await client.query('ROLLBACK'); // Cancel if something goes wrong
        console.error("Delete User Error:", error);
        res.status(500).json({ message: "Server error during deletion" });
    } finally {
        client.release();
    }
});


// 1. 📦 ADMIN: GET ALL PRODUCTS (This was the missing piece!)
router.get('/admin/all-products', protect, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.*, u.username as vendor_name 
            FROM products p 
            JOIN users u ON p.vendor_id = u.id 
            ORDER BY p.created_at DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error("Admin Product Fetch Error:", err);
        res.status(500).json({ message: "Database error fetching products" });
    }
});

// 2. 🗑️ ADMIN: DELETE ANY PRODUCT
router.delete('/admin/delete-product/:id', protect,  async (req, res) => {
    try {
        await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
        res.json({ message: "Product removed by Admin" });
    } catch (err) {
        res.status(500).json({ message: "Delete failed" });
    }
});

// 3. 💳 ADMIN: GET ALL PAYMENTS
router.get('/admin/all-payments', protect,  async (req, res) => {
    try {
        const payments = await pool.query(
            'SELECT * FROM orders WHERE status = $1 ORDER BY created_at DESC', ['paid']
        );
        res.json(payments.rows);
    } catch (err) {
        res.status(500).json({ message: "Error fetching payments" });
    }
});



// 1. 📧 ROUTE: REQUEST PASSWORD RESET (SEND OTP)
router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    try {
        const userRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userRes.rows.length === 0) return res.status(404).json({ message: "User not found" });

        // Generate a 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpires = new Date(Date.now() + 10 * 60000); // 10 minutes from now

        // Save OTP to DB
        await pool.query(
            'UPDATE users SET reset_otp = $1, otp_expiry = $2 WHERE email = $3',
            [otp, otpExpires, email]
        );

        // Send the Email (using your existing function)
        await sendOTPEmail(email, otp);

        res.json({ message: "OTP sent to your email!" });
    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});

// 2. 🔐 ROUTE: VERIFY OTP & RESET PASSWORD
router.post('/reset-password', async (req, res) => {
    const { email, otp, newPassword } = req.body;
    try {
        const userRes = await pool.query(
            'SELECT * FROM users WHERE email = $1 AND reset_otp = $2 AND otp_expiry > NOW()',
            [email, otp]
        );

        if (userRes.rows.length === 0) {
            return res.status(400).json({ message: "Invalid or expired OTP" });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        // Update password and clear OTP fields
        await pool.query(
            'UPDATE users SET password_hash = $1, is_verified = true, reset_otp = NULL, otp_expiry = NULL WHERE email = $2',
            [hashedPassword, email]
        );

        res.json({ message: "Password reset successful! You can now login." });
    } catch (err) {
        res.status(500).json({ message: "Reset failed" });
    }
});

router.put('/update-profile', protect, async (req, res) => {
    const { username, address, phone } = req.body;
    const userId = req.user.id;

    console.log(`🛠️ Attempting to update user ${userId}:`, { username, address, phone });

    try {
        // 1. Perform the update
        const result = await pool.query(
            `UPDATE users 
             SET username = $1, address = $2, phone = $3 
             WHERE id = $4 
             RETURNING id, username, email, role, address, phone, is_verified`,
            [username, address, phone, userId]
        );

        // 2. Check if the row was actually found and updated
        if (result.rows.length === 0) {
            console.log("❌ Error: No user found with that ID in the database.");
            return res.status(404).json({ message: "User not found in database" });
        }

        const updatedUser = result.rows[0];
        console.log("✅ Database Update Success:", updatedUser);

        // 3. Send the updated user back to the frontend
        res.json({ 
            message: "Profile updated!", 
            user: updatedUser 
        });

    } catch (err) {
        console.error("❌ DATABASE CRASH:", err.message);
        res.status(500).json({ message: "Update failed", error: err.message });
    }
});
module.exports = router;