const express = require('express');
const router = express.Router();
const pool = require('../db'); 
const { protect } = require('../middleware/authMiddleware');
const { upload } = require('../config/cloudinary');

// 1. GET FEED
router.get('/feed', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.*, s.business_name AS shop_name, s.shop_logo, s.address AS location, s.user_id AS owner_id, s.is_verified
            FROM expo_posts p
            JOIN vendor_profiles s ON p.shop_id = s.id
            ORDER BY p.created_at DESC
        `);
        res.json({ posts: result.rows });
    } catch (err) {
        res.status(500).json({ message: "Server Error fetching feed." });
    }
});

// 🟢 NEW: GET USER'S FOLLOWED SHOPS (Fixes the refresh bug)
router.get('/following', protect, async (req, res) => {
    try {
        const follows = await pool.query('SELECT following_shop_id FROM shop_followers WHERE follower_user_id = $1', [req.user.id]);
        const followingMap = {};
        follows.rows.forEach(f => { followingMap[f.following_shop_id] = true; });
        res.json({ following: followingMap });
    } catch (err) {
        res.status(500).json({ message: "Server Error fetching follows." });
    }
});

// 2. CREATE POST
router.post('/create', protect, upload.single('media'), async (req, res) => {
    try {
        const { content, media_type, tagged_item_id, tagged_item_type, tagged_item_name, allow_comments, trim_start, trim_end } = req.body;
        const userId = req.user.id;
        
        const media_url = req.file ? (req.file.path || req.file.secure_url) : null; 
        const shopRes = await pool.query('SELECT id, is_verified FROM vendor_profiles WHERE user_id = $1', [userId]);
        
        if (shopRes.rows.length === 0 && req.user.role !== 'admin' && req.user.email !== 'pavanvenkat63@gmail.com') {
            return res.status(403).json({ message: "Only approved shop owners can post." });
        }
        
        const shopId = shopRes.rows.length > 0 ? shopRes.rows[0].id : 1; 
        const safeStart = parseInt(trim_start) || 0;
        const safeEnd = parseInt(trim_end) || 60;

        const newPost = await pool.query(
            `INSERT INTO expo_posts (shop_id, content, media_type, media_url, tagged_item_id, tagged_item_type, tagged_item_name, allow_comments, trim_start, trim_end) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
            [shopId, content, media_type, media_url, tagged_item_id || null, tagged_item_type || null, tagged_item_name || null, allow_comments !== 'false', safeStart, safeEnd]
        );
        
        const createdPost = await pool.query(`
            SELECT p.*, s.business_name AS shop_name, s.shop_logo, s.address AS location, s.user_id AS owner_id, s.is_verified
            FROM expo_posts p JOIN vendor_profiles s ON p.shop_id = s.id WHERE p.id = $1
        `, [newPost.rows[0].id]);

        res.json({ message: "Post created!", post: createdPost.rows[0] });
    } catch (err) {
        console.error("Upload Error:", err);
        res.status(500).json({ message: "Server Error during upload." });
    }
});

// 3. GET COMMENTS (Strictly enforces Subhams Hub Official Name)
router.get('/:id/comments', async (req, res) => {
    try {
        const comments = await pool.query(`
            SELECT c.*, u.role, u.email,
                CASE 
                    WHEN u.role = 'admin' OR u.email = 'pavanvenkat63@gmail.com' THEN 'Subhams Hub Official' 
                    WHEN u.role = 'vendor' THEN COALESCE(v.business_name, u.username) 
                    ELSE u.username 
                END as display_name,
                CASE WHEN u.role = 'vendor' THEN v.shop_logo ELSE NULL END as display_avatar
            FROM expo_comments c 
            JOIN users u ON c.user_id = u.id LEFT JOIN vendor_profiles v ON u.id = v.user_id
            WHERE c.post_id = $1 ORDER BY c.created_at ASC
        `, [req.params.id]);
        res.json({ comments: comments.rows });
    } catch (err) { res.status(500).json({ message: "Server Error" }); }
});

// 4. ADD COMMENT
router.post('/:id/comment', protect, async (req, res) => {
    try {
        const { text, parent_comment_id } = req.body;
        await pool.query('INSERT INTO expo_comments (post_id, user_id, text, parent_comment_id) VALUES ($1, $2, $3, $4)', [req.params.id, req.user.id, text, parent_comment_id || null]);
        await pool.query('UPDATE expo_posts SET comments_count = comments_count + 1 WHERE id = $1', [req.params.id]);
        res.json({ message: "Comment added!" });
    } catch (err) { res.status(500).json({ message: "Server Error" }); }
});

// 5. DELETE COMMENT
router.delete('/comment/:commentId', protect, async (req, res) => {
    try {
        await pool.query('DELETE FROM expo_comments WHERE id = $1', [req.params.commentId]);
        res.json({ message: "Comment deleted." });
    } catch (err) { res.status(500).json({ message: "Server Error" }); }
});

// 6. DELETE POST 
router.delete('/:id', protect, async (req, res) => {
    try {
        await pool.query('DELETE FROM expo_posts WHERE id = $1', [req.params.id]);
        res.json({ message: "Post deleted successfully." });
    } catch (err) { res.status(500).json({ message: "Server Error" }); }
});

// 7. TOGGLE LIKE
router.post('/:id/like', protect, async (req, res) => {
    try {
        const likeCheck = await pool.query('SELECT * FROM expo_likes WHERE post_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        if (likeCheck.rows.length > 0) {
            await pool.query('DELETE FROM expo_likes WHERE post_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
            await pool.query('UPDATE expo_posts SET likes_count = likes_count - 1 WHERE id = $1', [req.params.id]);
            res.json({ message: "Post unliked", isLiked: false });
        } else {
            await pool.query('INSERT INTO expo_likes (post_id, user_id) VALUES ($1, $2)', [req.params.id, req.user.id]);
            await pool.query('UPDATE expo_posts SET likes_count = likes_count + 1 WHERE id = $1', [req.params.id]);
            res.json({ message: "Post liked", isLiked: true });
        }
    } catch (err) { res.status(500).json({ message: "Server Error" }); }
});

// 8. GET USERS WHO LIKED
router.get('/:id/likes', async (req, res) => {
    try {
        const likes = await pool.query(`
            SELECT u.id, u.email,
                CASE 
                    WHEN u.role = 'admin' OR u.email = 'pavanvenkat63@gmail.com' THEN 'Subhams Hub Official' 
                    WHEN u.role = 'vendor' THEN COALESCE(v.business_name, u.username) 
                    ELSE u.username 
                END as name,
                u.role
            FROM expo_likes el
            JOIN users u ON el.user_id = u.id
            LEFT JOIN vendor_profiles v ON u.id = v.user_id
            WHERE el.post_id = $1
        `, [req.params.id]);
        res.json({ likes: likes.rows });
    } catch (err) { res.status(500).json({ message: "Server Error" }); }
});

// 9. TRACK VIEWS
router.post('/:id/view', async (req, res) => {
    try {
        await pool.query('UPDATE expo_posts SET views_count = views_count + 1 WHERE id = $1', [req.params.id]);
        res.json({ message: "View counted" });
    } catch (err) { res.status(500).json({ message: "Server Error" }); }
});

// 10. TOGGLE FOLLOW SHOP
router.post('/follow/:shopId', protect, async (req, res) => {
    try {
        const { shopId } = req.params;
        const userId = req.user.id;

        const followCheck = await pool.query('SELECT * FROM shop_followers WHERE follower_user_id = $1 AND following_shop_id = $2', [userId, shopId]);

        if (followCheck.rows.length > 0) {
            await pool.query('DELETE FROM shop_followers WHERE follower_user_id = $1 AND following_shop_id = $2', [userId, shopId]);
            res.json({ message: "Unfollowed shop", isFollowing: false });
        } else {
            await pool.query('INSERT INTO shop_followers (follower_user_id, following_shop_id) VALUES ($1, $2)', [userId, shopId]);
            res.json({ message: "Following shop", isFollowing: true });
        }
    } catch (err) {
        res.status(500).json({ message: "Server Error" });
    }
});

// 11. GET TAGGABLE ITEMS 
router.get('/tags', protect, async (req, res) => {
    try {
        if (req.user.role === 'admin' || req.user.email === 'pavanvenkat63@gmail.com') {
            const shops = await pool.query(`SELECT id, business_name AS name, 'shop' AS type, shop_logo AS image FROM vendor_profiles WHERE business_name ILIKE $1 LIMIT 10`, [`%${req.query.q || ''}%`]);
            const products = await pool.query(`SELECT p.id, p.name, 'product' AS type, p.image_url AS image FROM products p WHERE p.name ILIKE $1 LIMIT 10`, [`%${req.query.q || ''}%`]);
            return res.json({ tags: [...shops.rows, ...products.rows] });
        } 
        const products = await pool.query(
            `SELECT p.id, p.name, 'product' AS type, p.image_url AS image FROM products p JOIN vendor_profiles v ON p.vendor_id = v.user_id WHERE v.user_id = $1 AND p.name ILIKE $2 LIMIT 15`,
            [req.user.id, `%${req.query.q || ''}%`]
        );
        return res.json({ tags: products.rows });
    } catch (err) { res.status(500).json({ message: "Server Error" }); }
});

module.exports = router;