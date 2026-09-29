const express = require('express');
const router = express.Router();
const pool = require('../db');
const { protect } = require('../middleware/authMiddleware');

// 🟢 IMPORT YOUR SERVICES
const { upload, cloudinary } = require('../config/cloudinary'); 
const { sendOTPEmail } = require('../utils/emailService'); 

// 🟢 IN-MEMORY OTP CACHE (For Staff Invites)
const staffOtpCache = new Map();

// 🟢 DATABASE AUTO-FIXER 
const fixDatabase = async () => {
    try {
        await pool.query('ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT true');
        await pool.query('ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS shop_type VARCHAR(50) DEFAULT \'Products\'');
        await pool.query('ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS shop_logo TEXT');
        await pool.query('ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS address VARCHAR(255)');
        await pool.query('ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS lat NUMERIC(10, 6)');
        await pool.query('ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS lng NUMERIC(10, 6)');
        await pool.query('ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS delivery_areas TEXT DEFAULT \'All\'');
        
        // Ensure Verification Columns Exist
        await pool.query('ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false');
        await pool.query('ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS is_approved BOOLEAN DEFAULT true');

        // Staff Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS shop_staff (
                id SERIAL PRIMARY KEY,
                shop_id INTEGER REFERENCES vendor_profiles(id) ON DELETE CASCADE,
                staff_email VARCHAR(255) NOT NULL,
                role VARCHAR(50) DEFAULT 'Staff',
                added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(shop_id, staff_email)
            )
        `);

        // Delivery Requests Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS delivery_requests (
                id SERIAL PRIMARY KEY,
                shop_id INTEGER REFERENCES vendor_profiles(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                area_name VARCHAR(100) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(shop_id, user_id)
            )
        `);
    } catch (err) {
        console.error("DB Fix Note:", err.message);
    }
};
fixDatabase();

router.get('/check-shop-name', protect, async (req, res) => {
    try {
        const { name, location } = req.query;
        if (!name || name.trim().length < 3) return res.json({ available: true });

        const cleanName = name.trim();

        const exactCheck = await pool.query(
            'SELECT id FROM vendor_profiles WHERE LOWER(TRIM(business_name)) = LOWER($1) AND user_id != $2 LIMIT 1',
            [cleanName, req.user.id]
        );

        if (exactCheck.rows.length === 0) return res.json({ available: true }); 

        const locPart = location && location !== 'Area' ? location.split(',')[0].trim() : 'Hub';
        const randomNum = Math.floor(100 + Math.random() * 900);
        
        const suggestions = [
            `${cleanName} ${locPart}`,
            `${cleanName} Store`,
            `${cleanName} ${randomNum}`
        ];

        const checkSugs = await pool.query(
            `SELECT business_name FROM vendor_profiles WHERE LOWER(business_name) = ANY($1::text[])`,
            [suggestions.map(s => s.toLowerCase())]
        );

        const takenNames = checkSugs.rows.map(r => r.business_name.toLowerCase());
        const safeSuggestions = suggestions.filter(s => !takenNames.includes(s.toLowerCase()));

        return res.json({ available: false, suggestions: safeSuggestions });
    } catch (err) {
        console.error("Name Check DB Error:", err.message);
        res.status(500).json({ error: "Failed to check name." });
    }
});

router.get('/my-shop', protect, async (req, res) => {
    try {
        if (!req.user || !req.user.id) return res.status(401).json({ message: "Unauthorized." });

        const userQuery = await pool.query('SELECT email FROM users WHERE id = $1', [req.user.id]);
        const userEmail = userQuery.rows[0]?.email;

        const shopQuery = await pool.query(`
            SELECT v.* 
            FROM vendor_profiles v
            LEFT JOIN shop_staff s ON v.id = s.shop_id
            WHERE v.user_id = $1 OR s.staff_email = $2
            LIMIT 1
        `, [req.user.id, userEmail]);

        if (shopQuery.rows.length === 0) return res.json({ hasShop: false });

        const shop = shopQuery.rows[0];
        if (!shop.is_approved) return res.json({ hasShop: true, shop: shop, products: [] });

        const productsQuery = await pool.query('SELECT * FROM products WHERE vendor_id = $1 ORDER BY created_at DESC', [shop.user_id]);
        res.json({ hasShop: true, shop: shop, products: productsQuery.rows });
    } catch (err) {
        res.status(500).json({ message: "Server error: " + err.message });
    }
});

router.get('/:id/staff', protect, async (req, res) => {
    try {
        const staffQuery = await pool.query('SELECT id, staff_email, role FROM shop_staff WHERE shop_id = $1', [req.params.id]);
        res.json({ staff: staffQuery.rows });
    } catch (err) { res.status(500).json({ message: "Server error" }); }
});

router.post('/:id/staff/request-otp', protect, async (req, res) => {
    const { staff_email } = req.body;
    const shopId = req.params.id;

    try {
        const countQuery = await pool.query('SELECT COUNT(*) FROM shop_staff WHERE shop_id = $1', [shopId]);
        if (parseInt(countQuery.rows[0].count) >= 1) {
            return res.status(403).json({ message: "Free Tier Limit: You can only add 1 extra device. Upgrade to Premium for unlimited staff!" });
        }

        const existingStaff = await pool.query('SELECT * FROM shop_staff WHERE shop_id = $1 AND staff_email = $2', [shopId, staff_email.toLowerCase()]);
        if (existingStaff.rows.length > 0) return res.status(400).json({ message: "This email is already in your team." });

        const vendorCheck = await pool.query(`SELECT v.id FROM vendor_profiles v JOIN users u ON v.user_id = u.id WHERE LOWER(u.email) = $1`, [staff_email.toLowerCase()]);
        if (vendorCheck.rows.length > 0) {
            return res.status(400).json({ message: "Security Block: This email belongs to an existing Shop Owner." });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        staffOtpCache.set(`${shopId}-${staff_email.toLowerCase()}`, otp);
        
        await sendOTPEmail(staff_email, otp, "Future Staff Member");

        res.json({ message: `Verification code sent to ${staff_email}` });
    } catch (err) {
        res.status(500).json({ message: "Failed to send OTP." });
    }
});

router.post('/:id/staff/verify-otp', protect, async (req, res) => {
    const { staff_email, otp, role } = req.body;
    const shopId = req.params.id;
    const emailLower = staff_email.toLowerCase();

    const storedOtp = staffOtpCache.get(`${shopId}-${emailLower}`);
    if (!storedOtp || storedOtp !== otp) {
        return res.status(400).json({ message: "Invalid or expired verification code." });
    }

    try {
        await pool.query('INSERT INTO shop_staff (shop_id, staff_email, role) VALUES ($1, $2, $3)', [shopId, emailLower, role || 'Staff']);
        staffOtpCache.delete(`${shopId}-${emailLower}`); 
        res.json({ message: "Staff added securely!" });
    } catch (err) {
        res.status(500).json({ message: "Failed to verify and add staff." });
    }
});

router.delete('/:id/staff/:staffEmail', protect, async (req, res) => {
    try {
        await pool.query('DELETE FROM shop_staff WHERE shop_id = $1 AND staff_email = $2', [req.params.id, req.params.staffEmail]);
        res.json({ message: "Access removed successfully!" });
    } catch (err) { res.status(500).json({ message: "Failed to remove staff." }); }
});

router.post('/:id/request-delivery', protect, async (req, res) => {
    try {
        const { area_name } = req.body;
        const shopId = req.params.id;
        const userId = req.user.id;

        await pool.query(
            'INSERT INTO delivery_requests (shop_id, user_id, area_name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [shopId, userId, area_name]
        );
        res.json({ message: "Request logged successfully!" });
    } catch (err) {
        res.status(500).json({ message: "Failed to request delivery." });
    }
});

router.get('/active/all', async (req, res) => {
    try {
        const shopsQuery = await pool.query(`
            SELECT v.*, u.address AS user_address
            FROM vendor_profiles v
            JOIN users u ON v.user_id = u.id
            WHERE v.is_approved = true
        `);
        
        const processedShops = shopsQuery.rows.map(shop => ({
            ...shop,
            address: shop.address || shop.user_address || ''
        }));

        res.json({ shops: processedShops });
    } catch (err) { res.status(500).json({ message: "Server error" }); }
});

// =====================================================================
// 🌍 PUBLIC: GET SHOP PROFILE BY ID (🟢 BULLETPROOF ERROR HANDLING)
// =====================================================================
router.get('/:id', async (req, res) => {
    let shopId = req.params.id;
    if (shopId === '42' || shopId === 'undefined' || shopId === 'null') {
        try {
            const defaultShop = await pool.query('SELECT id FROM vendor_profiles ORDER BY id ASC LIMIT 1');
            if (defaultShop.rows.length > 0) { shopId = defaultShop.rows[0].id; }
        } catch(e) { return res.status(500).json({ message: "Database Error" }); }
    }

    try {
        const shopQuery = await pool.query(`
            SELECT v.*, u.phone, u.address AS user_address, u.email as user_email, u.username as user_name
            FROM vendor_profiles v
            JOIN users u ON v.user_id = u.id
            WHERE v.id = $1
        `, [shopId]);

        if (shopQuery.rows.length === 0) return res.status(404).json({ message: "Shop not found." });
        
        const shop = shopQuery.rows[0];
        shop.address = shop.address || shop.user_address || '';

        // 🟢 SAFELY FETCH PRODUCTS
        let products = [];
        try {
            const productsQuery = await pool.query('SELECT * FROM products WHERE vendor_id = $1 ORDER BY created_at DESC', [shop.user_id]);
            products = productsQuery.rows;
        } catch(err) { console.warn("Could not fetch products:", err.message); }
        
        // 🟢 SAFELY FETCH EXPO POSTS (Won't crash if table is missing)
        let expoPosts = [];
        try {
            const expoQuery = await pool.query('SELECT * FROM expo_posts WHERE shop_id = $1 ORDER BY created_at DESC', [shopId]);
            expoPosts = expoQuery.rows;
        } catch(err) { console.warn("Could not fetch Expo posts:", err.message); }

        // 🟢 SAFELY FETCH DELIVERY REQUESTS
        let deliveryRequests = [];
        try {
            const requestsQuery = await pool.query(`
                SELECT area_name as area, COUNT(*) as count 
                FROM delivery_requests 
                WHERE shop_id = $1 
                GROUP BY area_name ORDER BY count DESC LIMIT 5
            `, [shopId]);
            deliveryRequests = requestsQuery.rows;
        } catch(err) { console.warn("Could not fetch Delivery Requests:", err.message); }

        res.json({ 
            shop: shop, 
            products: products, 
            delivery_requests: deliveryRequests,
            expo_posts: expoPosts 
        });
    } catch (err) { 
        console.error("CRITICAL SHOP FETCH ERROR:", err.message);
        res.status(500).json({ message: "Failed to load shop profile.", error: err.message }); 
    }
});

router.put('/:id', protect, upload.single('shop_logo'), async (req, res) => {
    const { business_name, category, shop_type, is_online, address, delivery_areas } = req.body;
    const shopId = req.params.id;
    let shop_logo_url = null;

    try {
        if (req.file) {
            shop_logo_url = req.file.path; 
            const oldShop = await pool.query('SELECT shop_logo FROM vendor_profiles WHERE id = $1', [shopId]);
            if (oldShop.rows.length > 0 && oldShop.rows[0].shop_logo && oldShop.rows[0].shop_logo.includes('cloudinary')) {
                try {
                    const urlParts = oldShop.rows[0].shop_logo.split('/');
                    const publicId = `${urlParts[urlParts.length - 2]}/${urlParts[urlParts.length - 1].split('.')[0]}`; 
                    await cloudinary.uploader.destroy(publicId);
                } catch (delErr) {}
            }
        }

        const updateQuery = await pool.query(`
            UPDATE vendor_profiles 
            SET business_name = COALESCE($1, business_name),
                category = COALESCE($2, category),
                shop_type = COALESCE($3, shop_type),
                is_online = COALESCE($4, is_online),
                shop_logo = COALESCE($5, shop_logo),
                address = COALESCE($6, address),
                delivery_areas = COALESCE($7, delivery_areas)
            WHERE id = $8
            RETURNING *
        `, [business_name, category, shop_type, is_online, shop_logo_url, address, delivery_areas, shopId]);

        if (updateQuery.rows.length === 0) return res.status(404).json({ message: "Shop not found." });

        const updatedShop = updateQuery.rows[0];
        const io = req.app.get('io');
        if (io) io.emit('shop_updated', updatedShop);

        res.json({ message: "Shop updated successfully!", shop: updatedShop });
    } catch (err) { res.status(500).json({ message: "Failed to update shop." }); }
});

// 🟢 ADMIN: TOGGLE VENDOR VERIFICATION 
router.put('/admin/vendor/:shopId/verify-status', protect, async (req, res) => {
    try {
        const isAdmin = req.user.role === 'admin' || req.user.email === 'pavanvenkat63@gmail.com';
        if (!isAdmin) {
            return res.status(403).json({ message: "Access denied. Master Admin only." });
        }

        const { shopId } = req.params;
        const { is_verified, is_approved } = req.body;

        const updateRes = await pool.query(
            `UPDATE vendor_profiles 
             SET is_verified = COALESCE($1, is_verified),
                 is_approved = COALESCE($2, is_approved)
             WHERE id = $3 RETURNING id, business_name, is_verified, is_approved`,
            [is_verified, is_approved, shopId]
        );

        if (updateRes.rows.length === 0) {
            return res.status(404).json({ message: "Vendor profile not found." });
        }

        res.json({ message: "Vendor status updated successfully!", vendor: updateRes.rows[0] });
    } catch (err) {
        console.error("Admin verify status error:", err.message);
        res.status(500).json({ message: "Server Error updating vendor status." });
    }
});

module.exports = router;