const express = require('express');
const dotenv = require('dotenv');
const pool = require('./db');
const cors = require('cors');
const path = require('path');
const http = require('http'); 
const { Server } = require('socket.io'); 

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
const expoRoutes = require('./routes/expo');
const chatRoutes = require('./routes/chatRoutes');
const { router: notificationRoutes, sendPushToUser } = require('./routes/notificationRoutes');
dotenv.config();

const app = express();
const server = http.createServer(app); 

// 🚀 PRODUCTION FIX: Trust the Render Proxy
app.set('trust proxy', 1);

// 📍 CORS CONFIGURATION
app.use(cors({
    origin: '*', // Allow all origins to prevent Render blocks
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
app.use('/api/shops', shopRoutes);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api/orders', orderRoutes);
app.use('/api/expo', expoRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/notifications', notificationRoutes);
app.get('/', (req, res) => {
    res.send('Subhams-Hub API & Switchboard is running smoothly!');
});

// =====================================================================
// 📞 THE ZERO-TRUST WEBRTC SWITCHBOARD (Socket.io)
// =====================================================================

const io = new Server(server, {
    cors: { origin: '*', methods: ["GET", "POST", "PUT", "DELETE"] },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000, 
    pingInterval: 25000 
});

app.set('io', io);

const activeUsers = new Map(); 

io.on('connection', (socket) => {
    console.log(`🔌 New Device Connected: ${socket.id}`);

    socket.on('register_user', (userId) => {
        activeUsers.set(userId, socket.id);
    });

    // =================================================================
    // 💬 1. SECURE CHAT MESSAGING (Phase 1)
    // =================================================================
    socket.on('join_chat', (conversationId) => {
        socket.join(`chat_${conversationId}`);
        console.log(`User joined chat room: chat_${conversationId}`);
    });

    socket.on('leave_chat', (conversationId) => {
        socket.leave(`chat_${conversationId}`);
    });

  socket.on('send_message', async (data) => {
        const { conversation_id, sender_id, message_text } = data;
        
        try {
            // Save to Database
            const result = await pool.query(
                'INSERT INTO chat_messages (conversation_id, sender_id, message_text) VALUES ($1, $2, $3) RETURNING *',
                [conversation_id, sender_id, message_text]
            );
            
            // Update last_message timestamp on conversation
            await pool.query(
                'UPDATE shop_conversations SET last_message = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                [message_text, conversation_id]
            );

            // Broadcast to the exact live room
            io.to(`chat_${conversation_id}`).emit('receive_message', result.rows[0]);
            
            // 🟢 "GOD MODE": Send blind carbon copy to Admin Room
            io.to('admin_supervision_room').emit('admin_chat_intercept', result.rows[0]);

            // ==========================================
            // 🟢 NEW: OFFLINE PUSH NOTIFICATION SYSTEM
            // ==========================================
            // Find out who is supposed to receive this message
            const convoQuery = await pool.query('SELECT shop_id, customer_id FROM shop_conversations WHERE id = $1', [conversation_id]);
            if (convoQuery.rows.length > 0) {
                const convo = convoQuery.rows[0];
                
                // Get the Shop Owner's exact User ID
                const shopQuery = await pool.query('SELECT user_id, business_name FROM vendor_profiles WHERE id = $1', [convo.shop_id]);
                const shopOwnerId = shopQuery.rows[0].user_id;
                const shopName = shopQuery.rows[0].business_name;

                // If sender is customer, receiver is shop owner. If sender is shop owner, receiver is customer.
                let receiverId = String(sender_id) === String(convo.customer_id) ? shopOwnerId : convo.customer_id;
                
                // Fetch sender's name for the popup
                const senderQuery = await pool.query('SELECT username FROM users WHERE id = $1', [sender_id]);
                const senderName = String(sender_id) === String(shopOwnerId) ? shopName : senderQuery.rows[0].username;

                // Send Background Web Push to the Receiver's Phone!
                await sendPushToUser(receiverId, {
                    title: `New Message from ${senderName}`,
                    body: message_text.length > 40 ? message_text.substring(0, 40) + '...' : message_text,
                    url: `/chat/${conversation_id}`
                });
            }
            
        } catch (err) {
            console.error("Socket Message Save Error:", err);
        }
    });
    // =================================================================
    // 📞 2. VOICE CALLING PROXY 
    // =================================================================
    socket.on('initiate_call', async ({ callerId, receiverId, bookingId }) => {
        const receiverSocket = activeUsers.get(receiverId);
        if (receiverSocket) {
            io.to(receiverSocket).emit('incoming_call', { callerId, bookingId });
        } else {
            socket.emit('call_failed', { reason: 'Vendor is currently offline.' });
        }
    });

    socket.on('answer_call', ({ callerId, signalData }) => {
        const callerSocket = activeUsers.get(callerId);
        if (callerSocket) {
            io.to(callerSocket).emit('call_answered', { signalData });
        }
    });

    socket.on('end_call', ({ remoteUserId }) => {
        const remoteSocket = activeUsers.get(remoteUserId);
        if (remoteSocket) {
            io.to(remoteSocket).emit('call_ended');
        }
    });

    socket.on('disconnect', () => {
        for (let [userId, socketId] of activeUsers.entries()) {
            if (socketId === socket.id) {
                activeUsers.delete(userId);
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

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Subhams Server & Switchboard sprinting on port ${PORT}`);
});