const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, adminOnly } = require('../middleware/authMiddleware');

// 🟢 HELPER FUNCTION FOR LIVE SYNC
const triggerLiveSync = (req) => {
    const io = req.app.get('io');
    if (io) {
        io.emit('admin_refresh');
    }
};

// 🟢 AUTO-UNBLOCK ENGINE
// Checks database and restores shops/users if their time has expired
const autoUnblockSystem = async () => {
    try {
        const expired = await pool.query(`SELECT id FROM users WHERE account_status = 'temp_block' AND ban_until <= NOW()`);
        for (let row of expired.rows) {
            await pool.query('UPDATE vendor_profiles SET is_approved = true WHERE user_id = $1', [row.id]);
            await pool.query('UPDATE users SET account_status = $1, ban_reason = NULL, ban_until = NULL WHERE id = $2', ['active', row.id]);
        }
    } catch (err) { console.error("Auto-Unblock Error:", err); }
};

// =====================================================================
// 🟢 SILENT SYNC ROUTE (Fixes the refresh/disappearing bug)
// =====================================================================
router.get('/my-security-status', protect, async (req, res) => {
    try {
        await autoUnblockSystem(); // Instantly unblock if time is up

        const userQuery = await pool.query(
            'SELECT account_status, ban_reason, ban_until FROM users WHERE id = $1', 
            [req.user.id]
        );
        if (userQuery.rows.length > 0) {
            res.json(userQuery.rows[0]);
        } else {
            res.status(404).json({ message: "User not found" });
        }
    } catch (err) {
        res.status(500).json({ message: "Server error" });
    }
});

// =====================================================================
// 👑 ADMIN: GET ALL VENDORS
// =====================================================================
router.get('/pending-vendors', protect, async (req, res) => {
    try {
        const pending = await pool.query(`
            SELECT v.*, u.username, u.email as user_email, u.phone as user_phone, u.address as user_address
            FROM vendor_profiles v
            JOIN users u ON v.user_id = u.id
            ORDER BY v.created_at DESC
        `);
        res.json(pending.rows);
    } catch (err) {
        res.status(500).json({ message: "Failed to load registrations." });
    }
});

// =====================================================================
// ✅ ADMIN: APPROVE SHOP
// =====================================================================
router.put('/approve-vendor/:id', protect, adminOnly, async (req, res) => {
    try {
        const vendorCheck = await pool.query('SELECT user_id, business_name FROM vendor_profiles WHERE id = $1', [req.params.id]);
        if (vendorCheck.rows.length === 0) return res.status(404).json({ message: "Shop not found." });

        await pool.query('UPDATE vendor_profiles SET is_approved = true WHERE id = $1', [req.params.id]);
        await pool.query("UPDATE users SET role = 'vendor' WHERE id = $1", [vendorCheck.rows[0].user_id]);

        triggerLiveSync(req); 
        res.json({ message: "Shop approved successfully!" });
    } catch (err) {
        res.status(500).json({ message: "Failed to approve shop." });
    }
});

// =====================================================================
// ✉️ ADMIN: REQUEST CHANGES (SEND MESSAGE TO VENDOR)
// =====================================================================
router.put('/request-changes/:id', protect, async (req, res) => {
    try {
        const { reason } = req.body;
        await pool.query(`ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS status_note TEXT`);
        await pool.query('UPDATE vendor_profiles SET is_approved = false, status_note = $1 WHERE id = $2', [reason, req.params.id]);
        triggerLiveSync(req);
        res.json({ message: "Message sent to vendor successfully." });
    } catch (err) {
        res.status(500).json({ message: "Failed to send message." });
    }
});

// =====================================================================
// ⏸️ ADMIN: SUSPEND SHOP (Hide from App)
// =====================================================================
router.put('/suspend-vendor/:id', protect, adminOnly, async (req, res) => {
    try {
        const vendorCheck = await pool.query('SELECT user_id FROM vendor_profiles WHERE id = $1', [req.params.id]);
        if (vendorCheck.rows.length === 0) return res.status(404).json({ message: "Shop not found." });

        await pool.query('UPDATE vendor_profiles SET is_approved = false WHERE id = $1', [req.params.id]);
        await pool.query("UPDATE users SET role = 'customer' WHERE id = $1", [vendorCheck.rows[0].user_id]);

        triggerLiveSync(req); 
        res.json({ message: "Shop suspended successfully." });
    } catch (err) {
        res.status(500).json({ message: "Failed to suspend shop." });
    }
});

// =====================================================================
// 🗑️ ADMIN: PERMANENTLY DELETE SHOP
// =====================================================================
router.delete('/delete-vendor/:id', protect, adminOnly, async (req, res) => {
    try {
        const vendorCheck = await pool.query('SELECT user_id FROM vendor_profiles WHERE id = $1', [req.params.id]);
        if (vendorCheck.rows.length === 0) return res.status(404).json({ message: "Shop not found." });

        await pool.query('DELETE FROM vendor_profiles WHERE id = $1', [req.params.id]);
        await pool.query("UPDATE users SET role = 'customer' WHERE id = $1", [vendorCheck.rows[0].user_id]);

        triggerLiveSync(req); 
        res.json({ message: "Shop permanently deleted." });
    } catch (err) {
        res.status(500).json({ message: "Failed to delete shop." });
    }
});

// =====================================================================
// 📂 ADMIN CATEGORY MANAGER
// =====================================================================
router.post('/categories', async (req, res) => {
    try {
        const { name, section } = req.body;
        const hd_image = req.file ? req.file.path : req.body.hd_image; 
        if (!name || !section) return res.status(400).json({ message: "Name and section are required." });

        const newCategory = await pool.query(
            `INSERT INTO app_categories (name, section, hd_image) VALUES ($1, $2, $3) RETURNING *`,
            [name, section, hd_image || '']
        );
        triggerLiveSync(req); 
        res.status(201).json(newCategory.rows[0]);
    } catch (err) { res.status(500).json({ message: "Server error" }); }
});

router.get('/categories', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM app_categories ORDER BY id ASC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ message: "Server error" }); }
});

router.delete('/categories/:id', protect, adminOnly, async (req, res) => {
    try {
        await pool.query('DELETE FROM app_categories WHERE id = $1', [req.params.id]);
        triggerLiveSync(req); 
        res.json({ message: "Category deleted successfully" });
    } catch (err) { res.status(500).json({ message: "Server error" }); }
});

// =====================================================================
// 🛡️ ADMIN: GET ALL USERS FOR SECURITY CENTER
// =====================================================================
router.get('/all-users', protect, adminOnly, async (req, res) => {
    try {
        await autoUnblockSystem(); // Clean up expired blocks before sending

        const users = await pool.query(`
            SELECT id, username, email, phone, role, account_status, ban_reason, ban_until, created_at 
            FROM users ORDER BY created_at DESC
        `);
        res.json(users.rows);
    } catch (err) {
        res.status(500).json({ message: "Failed to load users." });
    }
});

// =====================================================================
// 🔨 ADMIN: APPLY SECURITY ACTION
// =====================================================================
router.put('/user-security/:id', protect, adminOnly, async (req, res) => {
    try {
        const { action, reason, minutes } = req.body; 
        const userId = req.params.id;

        let unblockTime = null;

        if (action === 'unblock') {
            await pool.query('UPDATE users SET account_status = $1, ban_reason = NULL, ban_until = NULL WHERE id = $2', ['active', userId]);
            await pool.query('UPDATE vendor_profiles SET is_approved = true WHERE user_id = $1', [userId]);
        } 
        else if (action === 'warn') {
            await pool.query('UPDATE users SET account_status = $1, ban_reason = $2 WHERE id = $3', ['warned', reason, userId]);
        } 
        else if (action === 'temp_block') {
            const timeQuery = await pool.query(`
                UPDATE users 
                SET account_status = 'temp_block', ban_reason = $1, ban_until = NOW() + INTERVAL '${minutes} minutes' 
                WHERE id = $2 RETURNING ban_until
            `, [reason, userId]);
            
            unblockTime = timeQuery.rows[0].ban_until;
            await pool.query('UPDATE vendor_profiles SET is_approved = false, is_online = false WHERE user_id = $1', [userId]);
        }
        else if (action === 'perma_banned') {
            await pool.query('UPDATE users SET account_status = $1, ban_reason = $2, ban_until = NULL WHERE id = $3', ['perma_banned', reason, userId]);
            await pool.query('UPDATE vendor_profiles SET is_approved = false, is_online = false WHERE user_id = $1', [userId]);
        }

        const io = req.app.get('io');
        if (io) {
            io.emit('admin_refresh');
            io.emit('force_logout', { userId, action, reason, ban_until: unblockTime }); 
        }

        res.json({ message: `User status updated to ${action}` });
    } catch (err) {
        res.status(500).json({ message: "Failed to update user security status." });
    }
});

// =====================================================================
// 💀 ADMIN: PERMANENTLY WIPE USER & CLEAN DB
// =====================================================================
router.delete('/delete-user/:id', protect, adminOnly, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const userId = req.params.id;
        
        await client.query('DELETE FROM cart WHERE user_id = $1', [userId]);
        
        const shopCheck = await client.query('SELECT id FROM vendor_profiles WHERE user_id = $1', [userId]);
        if (shopCheck.rows.length > 0) {
            const shopId = shopCheck.rows[0].id;
            await client.query('DELETE FROM cart WHERE product_id IN (SELECT id FROM products WHERE vendor_id = $1)', [shopId]);
            await client.query('DELETE FROM products WHERE vendor_id = $1', [shopId]);
            await client.query('DELETE FROM vendor_profiles WHERE id = $1', [shopId]);
        }
        
        await client.query('DELETE FROM users WHERE id = $1', [userId]);
        await client.query('COMMIT'); 

        triggerLiveSync(req);
        res.json({ message: "User and all related data completely wiped safely." });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ message: "Failed to delete user." });
    } finally {
        client.release();
    }
});

module.exports = router;