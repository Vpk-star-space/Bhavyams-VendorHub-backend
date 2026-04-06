const jwt = require('jsonwebtoken');
const pool = require('../db.js'); // 🛡️ Import your DB pool

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

// 👮 The Role Supervisor
const authorize = (...roles) => {
    return (req, res, next) => {
        // req.user was created by the 'protect' middleware
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ 
                message: `Forbidden: Your role (${req.user.role}) does not have permission.` 
            });
        }
        next();
    };
};




// ... (your protect function is above this)

const adminOnly = (req, res, next) => {
    // 🛡️ This checks the 'role' we fetched from the DB in the protect middleware
    if (req.user && req.user.role && req.user.role.toLowerCase() === 'admin') {
        next(); 
    } else {
        res.status(403).json({ message: "Access Denied: Admins Only!" });
    }
};

// 🛡️ CRITICAL: You must export it here!
module.exports = { protect, adminOnly };



