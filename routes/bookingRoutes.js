const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect, authorize, adminOnly } = require('../middleware/authMiddleware');

// =====================================================================
// 🕒 1. CUSTOMER: REQUEST A SERVICE / PRODUCT (Starts the 1-Hour Timer)
// =====================================================================
router.post('/request', protect, async (req, res) => {
    const { itemId, vendorId, address } = req.body;
    
    try {
        // 1. Verify the item and vendor still exist and are approved
        const itemCheck = await pool.query(
            `SELECT p.name, v.is_approved 
             FROM products p 
             JOIN vendor_profiles v ON p.vendor_id = v.user_id 
             WHERE p.id = $1 AND p.vendor_id = $2`,
            [itemId, vendorId]
        );

        if (itemCheck.rows.length === 0 || !itemCheck.rows[0].is_approved) {
            return res.status(400).json({ message: "This service is currently unavailable or the vendor is offline." });
        }

        // 2. Create the Booking with a strict 1-Hour Expiration!
        const newBooking = await pool.query(
            `INSERT INTO bookings (customer_id, vendor_id, item_id, status, customer_address, expires_at) 
             VALUES ($1, $2, $3, 'Pending', $4, NOW() + INTERVAL '1 hour') 
             RETURNING *`,
            [req.user.id, vendorId, itemId, address || req.user.address]
        );

        res.status(201).json({ 
            message: "Request sent to the vendor! They have 1 hour to respond.", 
            booking: newBooking.rows[0] 
        });

    } catch (err) {
        console.error("Booking Request Error:", err);
        res.status(500).json({ message: "Failed to send booking request." });
    }
});

// =====================================================================
// 📱 2. CUSTOMER: GET MY ACTIVE BOOKINGS (To show the countdown timer)
// =====================================================================
router.get('/my-bookings', protect, async (req, res) => {
    try {
        // We calculate 'seconds_remaining' directly in the database!
        // If it drops below 0 and status is still 'Pending', it's expired.
        const bookings = await pool.query(
            `SELECT b.*, p.name as item_name, p.image_url, p.is_service, v.business_name,
             EXTRACT(EPOCH FROM (b.expires_at - NOW())) AS seconds_remaining
             FROM bookings b
             JOIN products p ON b.item_id = p.id
             JOIN vendor_profiles v ON b.vendor_id = v.user_id
             WHERE b.customer_id = $1
             ORDER BY b.requested_at DESC`,
            [req.user.id]
        );

        res.json(bookings.rows);
    } catch (err) {
        console.error("Fetch Bookings Error:", err);
        res.status(500).json({ message: "Failed to load bookings." });
    }
});

// =====================================================================
// 🏪 3. VENDOR: GET INCOMING REQUESTS
// =====================================================================
router.get('/vendor-requests', protect, authorize('vendor'), async (req, res) => {
    try {
        const requests = await pool.query(
            `SELECT b.*, p.name as item_name, u.username as customer_name,
             EXTRACT(EPOCH FROM (b.expires_at - NOW())) AS seconds_remaining
             FROM bookings b
             JOIN products p ON b.item_id = p.id
             JOIN users u ON b.customer_id = u.id
             WHERE b.vendor_id = $1 AND b.status = 'Pending'
             ORDER BY b.requested_at ASC`,
            [req.user.id]
        );

        res.json(requests.rows);
    } catch (err) {
        res.status(500).json({ message: "Failed to load incoming requests." });
    }
});

// =====================================================================
// ✅ 4. VENDOR: RESPOND TO REQUEST (Accept or Reject)
// =====================================================================
router.put('/respond/:id', protect, authorize('vendor'), async (req, res) => {
    const { action } = req.body; // 'Accept' or 'Reject'
    const bookingId = req.params.id;

    try {
        // First, check if the 1-hour timer already ran out!
        const checkQuery = await pool.query('SELECT expires_at, status FROM bookings WHERE id = $1 AND vendor_id = $2', [bookingId, req.user.id]);
        
        if (checkQuery.rows.length === 0) return res.status(404).json({ message: "Booking not found." });
        
        if (new Date() > new Date(checkQuery.rows[0].expires_at) && checkQuery.rows[0].status === 'Pending') {
            // Auto-cancel it if they were too slow
            await pool.query("UPDATE bookings SET status = 'Expired' WHERE id = $1", [bookingId]);
            return res.status(400).json({ message: "Too late! The 1-hour timer expired." });
        }

        const newStatus = action === 'Accept' ? 'Accepted' : 'Rejected';

        const updated = await pool.query(
            "UPDATE bookings SET status = $1 WHERE id = $2 RETURNING *",
            [newStatus, bookingId]
        );

        res.json({ message: `Booking ${newStatus}!`, booking: updated.rows[0] });

    } catch (err) {
        console.error("Vendor Response Error:", err);
        res.status(500).json({ message: "Failed to update booking." });
    }
});

// =====================================================================
// 👑 5. ADMIN: VIEW ALL ACTIVE BOOKINGS & TIMERS
// =====================================================================
router.get('/admin-dashboard', protect, adminOnly, async (req, res) => {
    try {
        const allBookings = await pool.query(`
            SELECT b.id, b.status, b.requested_at, u.username as customer, v.business_name as vendor
            FROM bookings b
            JOIN users u ON b.customer_id = u.id
            JOIN vendor_profiles v ON b.vendor_id = v.user_id
            ORDER BY b.requested_at DESC
        `);
        res.json(allBookings.rows);
    } catch (err) {
        res.status(500).json({ message: "Admin fetch failed." });
    }
});

module.exports = router;