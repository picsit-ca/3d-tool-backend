require('dotenv').config({ path: './.env' });
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const Transaction = require('./models/Transaction');
const path = require('path');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3000;
const BASE_URL = 'https://threed-tool-backend.onrender.com';

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../3d-tool-frontend')));

app.use((_req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    next();
});

// Environment variables - All loaded directly from Render config
const MONGO_URI = process.env.MONGO_URI;
const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || '').trim().replace(/\s+/g, '');
const GOOGLE_CLIENT_SECRET = String(process.env.GOOGLE_CLIENT_SECRET || '').trim().replace(/\s+/g, '');
const JWT_SECRET = process.env.JWT_SECRET;
const TSR_PARTNER_ID = process.env.TSR_PARTNER_ID;
const TSR_PARTNER_KEY = process.env.TSR_PARTNER_KEY;

// Initialize Google OAuth
const client = new OAuth2Client({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri: `${BASE_URL}/auth/google/callback`
});

// Production CORS configuration
app.use(cors({
    origin: [BASE_URL, 'http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// MongoDB Connection
const connectDB = async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('✅ MongoDB connected successfully');
    } catch (err) {
        console.error('❌ MongoDB connection error:', err.message);
        process.exit(1);
    }
};
connectDB();

// Auth middleware
app.use(async (req, res, next) => {
    const userId = req.cookies.userId;
    if (userId) {
        try {
            const user = await User.findOne({ userId });
            if (user) req.user = user;
        } catch (error) {
            console.error('Error finding user:', error);
        }
    }
    next();
});

// ─────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.send('Server 3D Tool đang chạy cực chill ông giáo ạ! ✅ Production mode');
});

// Login endpoint
app.post('/login', async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    try {
        let user = await User.findOne({ userId });
        if (!user) {
            console.log('Creating new user:', userId);
            user = new User({ userId, tokens: 10 });
            await user.save();
        }

        res.cookie('userId', userId, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'None',
            maxAge: 30 * 24 * 60 * 60 * 1000
        });

        res.json({ message: 'Logged in successfully' });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error during login' });
    }
});

// Get user profile
app.get('/me', (req, res) => {
    if (req.user) {
        res.json({ tokens: req.user.tokens });
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
});

// Convert endpoint
app.post('/convert', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { blocks } = req.body;
    const cost = Math.ceil(blocks / 1000);

    if (req.user.tokens < cost) {
        return res.status(400).json({ error: 'Not enough tokens' });
    }

    try {
        req.user.tokens -= cost;
        await req.user.save();
        res.json({ message: 'Conversion successful, tokens deducted.' });
    } catch (error) {
        console.error('Conversion error:', error);
        res.status(500).json({ error: 'Server error during conversion.' });
    }
});

// Rate limiting for recharge
const rechargeRateLimit = new Map();

// TSR Recharge Endpoint
app.post('/api/recharge', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const userId = req.user.userId;
    const now = Date.now();
    const userRequests = rechargeRateLimit.get(userId) || [];
    const recentRequests = userRequests.filter(t => now - t < 5 * 60 * 1000);

    if (recentRequests.length >= 3) {
        return res.status(429).json({ error: 'Too many requests, please try again later' });
    }

    const { telco, code, serial, amount } = req.body;

    if (!telco || !code || !serial || !amount) {
        return res.status(400).json({ error: 'Missing required parameters' });
    }

    try {
        const requestId = String(Date.now());
        
        // ✅ TSR Signature calculation: md5(PARTNER_KEY + code + serial)
        const sign = crypto.createHash('md5')
            .update(TSR_PARTNER_KEY + code + serial)
            .digest('hex');

        const transaction = new Transaction({
            userId,
            requestId,
            telco,
            code,
            serial,
            declaredAmount: amount,
            status: 0
        });
        await transaction.save();

        recentRequests.push(now);
        rechargeRateLimit.set(userId, recentRequests);

        // Call Thesieure API
        const tsrResponse = await fetch('https://thesieure.com/chargingws/v2', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                partner_id: TSR_PARTNER_ID,
                request_id: requestId,
                telco,
                code,
                serial,
                amount,
                command: 'charging',
                sign
            })
        });

        const tsrData = await tsrResponse.json();
        console.log(`📤 TSR Request sent: ${requestId} | Response: ${tsrData.status}`);
        
        res.json({
            success: true,
            message: 'Recharge request sent',
            requestId,
            response: tsrData
        });

    } catch (error) {
        console.error('❌ TSR API Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// TSR Callback Webhook
app.post('/api/callback/thesieure', async (req, res) => {
    console.log('📥 Received TSR Callback:', JSON.stringify(req.body));
    
    try {
        const { request_id, code, serial, status, amount, callback_sign } = req.body;

        // ✅ Verify signature: md5(PARTNER_KEY + code + serial)
        const expectedSign = crypto.createHash('md5')
            .update(TSR_PARTNER_KEY + code + serial)
            .digest('hex');

        if (callback_sign !== expectedSign) {
            console.log(`❌ Invalid signature. Expected: ${expectedSign} Received: ${callback_sign}`);
            return res.status(401).json({ status: 'error', message: 'Invalid signature' });
        }

        const transaction = await Transaction.findOne({ requestId: request_id });
        if (!transaction) {
            console.log(`❌ Transaction not found: ${request_id}`);
            return res.status(404).json({ status: 'error', message: 'Transaction not found' });
        }

        if (transaction.status !== 0) {
            console.log(`ℹ️ Transaction already processed: ${request_id}`);
            return res.status(200).json({ status: 'success', message: 'Already processed' });
        }

        transaction.realAmount = amount;
        transaction.status = status;

        if (status === 1 || status === 3) {
            const tokensToAdd = Math.floor(amount / 1000);
            console.log(`✅ Granting ${tokensToAdd} tokens to user: ${transaction.userId}`);
            
            await User.findOneAndUpdate(
                { userId: transaction.userId },
                { $inc: { tokens: tokensToAdd } }
            );
        }

        await transaction.save();
        console.log(`✅ Transaction processed: ${request_id} | Status: ${status} | Amount: ${amount}`);
        
        res.json({ status: 'success', message: 'OK' });

    } catch (error) {
        console.error('❌ TSR Callback Error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// Transaction history
app.get('/api/recharge/history', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const transactions = await Transaction.find({ userId: req.user.userId })
            .sort({ createdAt: -1 })
            .limit(50);

        res.json(transactions);
    } catch (error) {
        console.error('History fetch error:', error);
        res.status(500).json({ error: 'Server error loading transaction history' });
    }
});

// Google OAuth
app.get('/auth/google', (req, res) => {
    const authUrl = client.generateAuthUrl({
        access_type: 'offline',
        scope: ['profile', 'email'],
        redirect_uri: `${BASE_URL}/auth/google/callback`
    });
    res.redirect(authUrl);
});

// Google OAuth Callback
app.get('/auth/google/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('Authorization code not provided');
    
    try {
        const { tokens } = await client.getToken(code);
        const ticket = await client.verifyIdToken({
            idToken: tokens.id_token,
            audience: GOOGLE_CLIENT_ID
        });
        
        const payload = ticket.getPayload();
        const userId = payload.sub;
        
        let user = await User.findOne({ userId });
        if (!user) {
            user = new User({ userId, tokens: 10 });
            await user.save();
        }
        
        res.cookie('userId', userId, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'None',
            maxAge: 30 * 24 * 60 * 60 * 1000
        });
        
        const jwtToken = jwt.sign(
            { sub: userId, email: payload.email, name: payload.name },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        return res.redirect(`/?token=${jwtToken}`);
        
    } catch (error) {
        console.error('Google Auth callback error:', error);
        res.status(500).send('Authentication failed');
    }
});

// Start server
app.listen(port, () => {
    console.log(`✅ Server running on ${BASE_URL} port ${port}`);
    console.log(`✅ Production mode: ${process.env.NODE_ENV === 'production'}`);
});