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

app.use(cors({
    origin: '*', // This allows all websites to talk to your backend
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes)
app.use('/api/orders', orderRoutes);
app.use('/api/cart', cartRoutes);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => {
    res.send('Bhavyams VendorHub API is running smoothly !!!');
});

app.get('/test-db', async (req, res) => {
    try {
        const result = await pool.query("SELECT TO_CHAR(NOW(), 'YYYY-MM-DD HH12:MI:SS AM') AS indian_time");
        res.json({ 
            message: ' Database Connected!', 
            time_in_india: result.rows[0].indian_time 
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: ' Database connection failed' });
    }
});

// 🌐 DEPLOYMENT FIX: Process.env.PORT is mandatory for Cloud Providers
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is sprinting on port ${PORT}`);
});