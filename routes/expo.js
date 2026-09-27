const express = require('express');
const router = express.Router();
const pool = require('../db'); 
const { protect } = require('../middleware/authMiddleware');

// 🟢 Use your existing Cloudinary upload configuration
const { upload } = require('../config/cloudinary');

// 🟢 1. GET EXPO FEED (Public/All Users)
router.get('/feed', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                p.*, 
                s.business_name AS shop_name, 
                s.shop_logo, 
                s.address AS location,
                s.user_id AS owner_id
            FROM expo_posts p
            JOIN vendor_profiles s ON p.shop_id = s.id
            ORDER BY p.created_at DESC
        `);
        res.json({ posts: result.rows });
    } catch (err) {
        console.error("Feed Error:", err.message);
        res.status(500).json({ message: "Server Error: Could not fetch feed." });
    }
});

// 🟢 2. CREATE POST (Uploads directly to Cloudinary)
router.post('/create', protect, upload.single('media'), async (req, res) => {
    try {
        const { content, media_type } = req.body;
        const userId = req.user.id;
        
        // 🟢 Cloudinary stores the full https:// URL in req.file.path
        const media_url = req.file ? (req.file.path || req.file.secure_url) : null; 

        // Find the user's shop using vendor_profiles
        const shopRes = await pool.query('SELECT id FROM vendor_profiles WHERE user_id = $1', [userId]);
        
        if (shopRes.rows.length === 0) {
            if (req.user.role === 'admin' || req.user.email === 'pavanvenkat63@gmail.com') {
                return res.status(403).json({ message: "Admin: Please register an Official Shop profile first to post on Expo!" });
            }
            return res.status(403).json({ message: "Only approved shop owners can post." });
        }
        
        const shopId = shopRes.rows[0].id;

        const newPost = await pool.query(
            'INSERT INTO expo_posts (shop_id, content, media_type, media_url) VALUES ($1, $2, $3, $4) RETURNING *',
            [shopId, content, media_type, media_url]
        );
        
        const createdPost = await pool.query(`
            SELECT p.*, s.business_name AS shop_name, s.shop_logo, s.address AS location, s.user_id AS owner_id
            FROM expo_posts p
            JOIN vendor_profiles s ON p.shop_id = s.id
            WHERE p.id = $1
        `, [newPost.rows[0].id]);

        res.json({ message: "Post created!", post: createdPost.rows[0] });
    } catch (err) {
        console.error("Create Post Error:", err.message);
        res.status(500).json({ message: "Server Error: Could not create post." });
    }
});

// 🟢 3. DELETE POST (Admin God-Mode & Post Owner)
router.delete('/:id', protect, async (req, res) => {
    try {
        const postId = req.params.id;
        const userId = req.user.id;
        const userRole = req.user.role?.toLowerCase();

        const postRes = await pool.query(`
            SELECT p.id, s.user_id AS owner_id 
            FROM expo_posts p 
            JOIN vendor_profiles s ON p.shop_id = s.id 
            WHERE p.id = $1
        `, [postId]);

        if (postRes.rows.length === 0) return res.status(404).json({ message: "Post not found." });

        const ownerId = postRes.rows[0].owner_id;

        if (userRole === 'admin' || req.user.email === 'pavanvenkat63@gmail.com' || String(ownerId) === String(userId)) {
            await pool.query('DELETE FROM expo_posts WHERE id = $1', [postId]);
            res.json({ message: "Post deleted successfully." });
        } else {
            res.status(403).json({ message: "Unauthorized. You cannot delete this post." });
        }
    } catch (err) {
        console.error("Delete Error:", err.message);
        res.status(500).json({ message: "Server Error" });
    }
});

// 🟢 4. TOGGLE LIKE
router.post('/:id/like', protect, async (req, res) => {
    try {
        const postId = req.params.id;
        const userId = req.user.id;

        const likeCheck = await pool.query('SELECT * FROM expo_likes WHERE post_id = $1 AND user_id = $2', [postId, userId]);

        if (likeCheck.rows.length > 0) {
            await pool.query('DELETE FROM expo_likes WHERE post_id = $1 AND user_id = $2', [postId, userId]);
            await pool.query('UPDATE expo_posts SET likes_count = likes_count - 1 WHERE id = $1', [postId]);
            res.json({ message: "Post unliked", isLiked: false });
        } else {
            await pool.query('INSERT INTO expo_likes (post_id, user_id) VALUES ($1, $2)', [postId, userId]);
            await pool.query('UPDATE expo_posts SET likes_count = likes_count + 1 WHERE id = $1', [postId]);
            res.json({ message: "Post liked", isLiked: true });
        }
    } catch (err) {
        console.error("Like Error:", err.message);
        res.status(500).json({ message: "Server Error" });
    }
});

module.exports = router;