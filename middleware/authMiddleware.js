const jwt = require('jsonwebtoken');
const pool = require('../db'); // 🛡️ Import your DB pool

const protect = async (req, res, next) => { // 🛡️ Added 'async'
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            // 🛡️ FETCH FRESH DATA FROM DB (Including Role)
            const userRes = await pool.query(
                'SELECT id, username, email, role FROM users WHERE id = $1', 
                [decoded.id]
            );

            if (userRes.rows.length === 0) {
                return res.status(401).json({ message: 'User no longer exists' });
            }

            req.user = userRes.rows[0]; // Now req.user.role is definitely there!
            return next(); 
        } catch (error) {
            return res.status(401).json({ message: 'Not authorized, token failed' });
        }
    }

    if (!token) {
        return res.status(401).json({ message: 'Not authorized, no token' });
    }
};

// 👮 The Role Supervisor (Great for multiple roles)
const authorize = (...roles) => {
    return (req, res, next) => {
        // Ensure roles are compared in lowercase to avoid "Vendor" vs "vendor" bugs
        if (!req.user || !roles.map(r => r.toLowerCase()).includes(req.user.role.toLowerCase())) {
            return res.status(403).json({ 
                message: `Forbidden: Your role (${req.user?.role}) does not have permission.` 
            });
        }
        next();
    };
};



// ... (your protect function is above this)

const adminOnly = (req, res, next) => {
    console.log("DEBUG: Current User Role from DB is ->", `"${req.user?.role}"`);
    
    if (req.user && req.user.role && req.user.role.toLowerCase().trim() === 'admin') {
        next(); 
    } else {
        res.status(403).json({ message: "Access Denied: Admins Only!" });
    }
};
// 🛡️ CRITICAL: You must export it here!
module.exports = { protect, adminOnly, authorize };



