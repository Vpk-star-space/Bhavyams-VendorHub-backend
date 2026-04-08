const express = require('express');
const dotenv = require('dotenv');
const pool = require('./db');
const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');
const orderRoutes = require('./routes/orderRoutes');
const cors = require('cors');
const path = require('path');
const cartRoutes = require('./routes/cartRoutes');

dotenv.config();

const app = express();

// 🚀 PRODUCTION FIX: Trust the Render Proxy
app.set('trust proxy', 1);

// 📍 BULLETPROOF CORS CONFIGURATION
app.use(cors({
    origin: [
        'http://localhost:3000',
        'https://bhavyams-vendor-hub-vpk.vercel.app',
        'https://bhavyams-vendor-hub-vpk.vercel.app/'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: true,
    optionsSuccessStatus: 200 // Some legacy browsers choke on 204
}));

app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/cart', cartRoutes);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => {
    res.send('Bhavyams VendorHub API is running smoothly on Render !!!');
});

app.get('/test-db', async (req, res) => {
    try {
        const result = await pool.query("SELECT TO_CHAR(NOW(), 'YYYY-MM-DD HH12:MI:SS AM') AS indian_time");
        res.json({ 
            message: '✅ Database Connected!', 
            time_in_india: result.rows[0].indian_time 
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '❌ Database connection failed' });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server is sprinting on port ${PORT}`);
});