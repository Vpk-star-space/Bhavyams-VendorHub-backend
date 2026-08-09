const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, adminOnly } = require('../middleware/authMiddleware');

// =====================================================================
// 👑 1. ADMIN: GET ALL VENDORS (PENDING & ACTIVE)
// =====================================================================
router.get('/pending-vendors', protect, adminOnly, async (req, res) => {
    try {
        // Fetch ALL vendors. The frontend will filter them into tabs.
        const pending = await pool.query(`
            SELECT v.*, u.username, u.email as user_email, u.phone as user_phone
            FROM vendor_profiles v
            JOIN users u ON v.user_id = u.id
            ORDER BY v.created_at DESC
        `);
        res.json(pending.rows);
    } catch (err) {
        console.error("Fetch All Vendors Error:", err);
        res.status(500).json({ message: "Failed to load registrations." });
    }
});

// =====================================================================
// ✅ 2. ADMIN: APPROVE SHOP
// =====================================================================
router.put('/approve-vendor/:id', protect, adminOnly, async (req, res) => {
    try {
        const vendorCheck = await pool.query('SELECT user_id, business_name FROM vendor_profiles WHERE id = $1', [req.params.id]);
        if (vendorCheck.rows.length === 0) return res.status(404).json({ message: "Shop not found." });

        await pool.query('UPDATE vendor_profiles SET is_approved = true WHERE id = $1', [req.params.id]);
        await pool.query("UPDATE users SET role = 'vendor' WHERE id = $1", [vendorCheck.rows[0].user_id]);

        res.json({ message: "Shop approved successfully!" });
    } catch (err) {
        res.status(500).json({ message: "Failed to approve shop." });
    }
});

// =====================================================================
// ⏸️ 3. ADMIN: SUSPEND SHOP (Hide from App)
// =====================================================================
router.put('/suspend-vendor/:id', protect, adminOnly, async (req, res) => {
    try {
        const vendorCheck = await pool.query('SELECT user_id FROM vendor_profiles WHERE id = $1', [req.params.id]);
        if (vendorCheck.rows.length === 0) return res.status(404).json({ message: "Shop not found." });

        // Change status to false (hides from public feed) and downgrade user to customer
        await pool.query('UPDATE vendor_profiles SET is_approved = false WHERE id = $1', [req.params.id]);
        await pool.query("UPDATE users SET role = 'customer' WHERE id = $1", [vendorCheck.rows[0].user_id]);

        res.json({ message: "Shop suspended successfully." });
    } catch (err) {
        res.status(500).json({ message: "Failed to suspend shop." });
    }
});

// =====================================================================
// 🗑️ 4. ADMIN: PERMANENTLY DELETE SHOP
// =====================================================================
router.delete('/delete-vendor/:id', protect, adminOnly, async (req, res) => {
    try {
        const vendorCheck = await pool.query('SELECT user_id FROM vendor_profiles WHERE id = $1', [req.params.id]);
        if (vendorCheck.rows.length === 0) return res.status(404).json({ message: "Shop not found." });

        // Delete the shop and downgrade the user to customer
        await pool.query('DELETE FROM vendor_profiles WHERE id = $1', [req.params.id]);
        await pool.query("UPDATE users SET role = 'customer' WHERE id = $1", [vendorCheck.rows[0].user_id]);

        res.json({ message: "Shop permanently deleted." });
    } catch (err) {
        res.status(500).json({ message: "Failed to delete shop." });
    }
});
// =====================================================================
// 💾 UPDATE PROFILE & SYNC DETAILS (Phone, Address, Language)
// =====================================================================
router.put('/update-profile', protect, async (req, res) => {
    const { username, phone, address, language } = req.body;

    try {
        // Update user record in the DB
        const updateQuery = await pool.query(
            `UPDATE users 
             SET username = $1, phone = $2, address = $3, language = COALESCE($4, language) 
             WHERE id = $5 
             RETURNING id, username, email, phone, address, role, language`,
            [username, phone, address, language, req.user.id]
        );

        if (updateQuery.rows.length === 0) {
            return res.status(404).json({ message: "User not found." });
        }

        // Return the fresh synced profile
        res.json({ 
            message: "Profile and Language Synced!", 
            user: updateQuery.rows[0] 
        });

    } catch (err) {
        console.error("Profile Sync Error:", err);
        res.status(500).json({ message: "Server error during sync." });
    }
});

module.exports = router;