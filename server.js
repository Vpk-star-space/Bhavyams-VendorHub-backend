const express = require('express');
const dotenv = require('dotenv');
const pool = require('./db');
const cors = require('cors');
const path = require('path');
const http = require('http'); // 🟢 NEW: Required for Web Sockets
const { Server } = require('socket.io'); // 🟢 NEW: The Switchboard

// Route Imports
const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const cartRoutes = require('./routes/cartRoutes');
const adminRoutes = require('./routes/adminRoutes');
const supportRoutes = require('./routes/supportRoutes'); 
const registrationRoutes = require('./routes/registrationRoutes');
const shopRoutes = require('./routes/shopRoutes');
const orderRoutes = require('./routes/orderRoutes');
dotenv.config();

const app = express();
const server = http.createServer(app); // 🟢 Wrap Express inside HTTP

// 🚀 PRODUCTION FIX: Trust the Render Proxy
app.set('trust proxy', 1);

// 📍 CORS CONFIGURATION
app.use(cors({
    origin: function(origin, callback) {
        return callback(null, true);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/bookings', bookingRoutes); 
app.use('/api/cart', cartRoutes);
app.use('/api/support', supportRoutes);
app.use('/api', registrationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/shops', require('./routes/shopRoutes'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api/orders', require('./routes/orderRoutes'));
app.get('/', (req, res) => {
    res.send('Subhams-Hub API & Switchboard is running smoothly!');
});

// =====================================================================
// 📞 THE ZERO-TRUST WEBRTC SWITCHBOARD (Socket.io)
// =====================================================================
const io = new Server(server, {
    cors: { origin: '*', methods: ["GET", "POST"] }
});

// This map remembers which User ID belongs to which Live Socket ID
const activeUsers = new Map(); 

io.on('connection', (socket) => {
    console.log(`🔌 New Device Connected: ${socket.id}`);

    // 1. When a user opens the app, they register their ID with the switchboard
    socket.on('register_user', (userId) => {
        activeUsers.set(userId, socket.id);
        console.log(`👤 User ${userId} is Online and ready to receive calls.`);
    });

    // 2. Customer clicks "Call Vendor"
    socket.on('initiate_call', async ({ callerId, receiverId, bookingId }) => {
        const receiverSocket = activeUsers.get(receiverId);
        
        if (receiverSocket) {
            // Ring the vendor's phone!
            io.to(receiverSocket).emit('incoming_call', { callerId, bookingId });
            console.log(`📞 Routing call from ${callerId} to ${receiverId}`);
        } else {
            // Vendor is offline / app is closed
            socket.emit('call_failed', { reason: 'Vendor is currently offline.' });
        }
    });

    // 3. Vendor clicks "Answer"
    socket.on('answer_call', ({ callerId, signalData }) => {
        const callerSocket = activeUsers.get(callerId);
        if (callerSocket) {
            // Send the secure WebRTC audio connection data back to the caller
            io.to(callerSocket).emit('call_answered', { signalData });
        }
    });

    // 4. Hang up the phone
    socket.on('end_call', ({ remoteUserId }) => {
        const remoteSocket = activeUsers.get(remoteUserId);
        if (remoteSocket) {
            io.to(remoteSocket).emit('call_ended');
        }
    });

    // 5. Cleanup when they close the app
    socket.on('disconnect', () => {
        // Find and remove this user from the active map
        for (let [userId, socketId] of activeUsers.entries()) {
            if (socketId === socket.id) {
                activeUsers.delete(userId);
                console.log(`👋 User ${userId} went Offline.`);
                break;
            }
        }
    });
});

// 🛡️ FATAL ERROR CATCHER
app.use((err, req, res, next) => {
    console.error("🔥 FATAL SERVER ERROR:", err.stack);
    res.status(500).json({ message: "Internal Server Error", error: err.message });
});

// 🟢 IMPORTANT: Notice we changed app.listen to server.listen!
const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Subhams Server & Switchboard sprinting on port ${PORT}`);
});