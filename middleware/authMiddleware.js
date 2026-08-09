const jwt = require('jsonwebtoken');
const pool = require('../db'); 

// 1. Authentication Middleware
const protect = async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            const userRes = await pool.query(
                'SELECT id, username, email, role FROM users WHERE id = $1', 
                [decoded.id]
            );

            if (userRes.rows.length === 0) {
                return res.status(401).json({ message: 'User no longer exists' });
            }

            req.user = userRes.rows[0]; 
            return next(); 
        } catch (error) {
            return res.status(401).json({ message: 'Not authorized, token failed' });
        }
    }

    if (!token) {
        return res.status(401).json({ message: 'Not authorized, no token' });
    }
};

// 2. Safe Role Supervisor (Crash-proof if role is null/undefined)
const authorize = (...roles) => {
    return (req, res, next) => {
        const userRole = req.user?.role ? String(req.user.role).toLowerCase().trim() : '';
        const allowedRoles = roles.map(r => String(r).toLowerCase().trim());

        if (!req.user || !allowedRoles.includes(userRole)) {
            return res.status(403).json({ 
                message: `Forbidden: Your role (${req.user?.role || 'none'}) does not have permission.` 
            });
        }
        next();
    };
};

const adminOnly = (req, res, next) => {
    const userRole = req.user?.role ? String(req.user.role).toLowerCase().trim() : '';
    const userEmail = req.user?.email ? String(req.user.email).toLowerCase().trim() : '';

    // 🛡️ ULTRA-SECURE: Must be role 'admin' AND match your personal email
    if (req.user && (userRole === 'admin' && userEmail === 'pavanvenkat63@gmail.com')) {
        next(); 
    } else {
        console.warn(`🚨 Unauthorized Admin Access Attempt by: ${userEmail || 'Unknown'}`);
        res.status(403).json({ message: "Access Denied: Master Admin Only!" });
    }
};
module.exports = { protect, adminOnly, authorize };