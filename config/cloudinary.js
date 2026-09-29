const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
require('dotenv').config();

if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    console.error("❌ CRITICAL ERROR: Missing Cloudinary environment variables in .env file!");
}

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// 🟢 SMART UPLOAD GATE
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: async (req, file) => {
        return {
            folder: 'subhams_hub',
            resource_type: 'auto', // Allows Videos and Images safely
            allowed_formats: ['jpg', 'png', 'jpeg', 'webp', 'mp4', 'mov', 'webm', 'gif'],
            // 🚨 CRITICAL: Forces Cloudinary to compress heavy files to save your frontend bandwidth!
            quality: 'auto:good',
            fetch_format: 'auto'
        };
    },
});

// 🚨 STRICT SERVER RAM PROTECTION
const upload = multer({ 
    storage: storage,
    limits: { 
        fileSize: 50 * 1024 * 1024, // 50MB is perfect for a compressed 60-second mobile video
        files: 5 // Prevents malicious users from uploading 100 files at once and crashing Render
    } 
});

module.exports = { cloudinary, upload };