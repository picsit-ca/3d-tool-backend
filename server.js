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

// Serve static files from the frontend directory
app.use(express.static(path.join(__dirname, '../3d-tool-frontend')));

app.use((_req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    next();
});
const port = process.env.PORT || 3000;

const MONGO_URI = process.env.MONGO_URI;
const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || '').trim().replace(/\s+/g, '');
const GOOGLE_CLIENT_SECRET = String(process.env.GOOGLE_CLIENT_SECRET || '').trim().replace(/\s+/g, '');
const JWT_SECRET = process.env.JWT_SECRET;
const TSR_PARTNER_ID = process.env.TSR_PARTNER_ID;
const TSR_PARTNER_KEY = process.env.TSR_PARTNER_KEY;

// Debug: Log credential lengths to verify they are loaded correctly
console.log('=== Google OAuth Debug Info ===');
console.log('GOOGLE_CLIENT_ID length:', GOOGLE_CLIENT_ID.length);
console.log('GOOGLE_CLIENT_SECRET length:', GOOGLE_CLIENT_SECRET.length);
console.log('GOOGLE_CLIENT_ID:', GOOGLE_CLIENT_ID);
console.log('GOOGLE_CLIENT_SECRET:', GOOGLE_CLIENT_SECRET);

// Validate credentials are not empty
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.error('❌ ERROR: Google OAuth credentials are missing or empty!');
    process.exit(1);
}

console.log('✅ Google OAuth credentials loaded successfully');
console.log('=== End Debug Info ===');

// Initialize OAuth2Client
const client = new OAuth2Client({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri: 'http://localhost:3000/auth/google/callback'
});

// ─── CORS ────────────────────────────────────────────────────────────────────
// Đặt TRƯỚC tất cả các route. origin: true = phản chiếu origin của request,
// credentials: true = cho phép gửi cookie cross-origin.
app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// ─── Body / Cookie parsers ────────────────────────────────────────────────────
app.use(express.json());
app.use(cookieParser());


// ─── Database ─────────────────────────────────────────────────────────────────
const connectDB = async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('MongoDB connected');
    } catch (err) {
        console.error('MongoDB connection error:', err.message);
        process.exit(1);
    }
};
connectDB();

// ─── Middleware: gắn req.user từ cookie userId ────────────────────────────────
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

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.send('Server 3D Tool đang chạy');
});

// POST /login  – nhận userId từ body, tạo user nếu chưa có, set cookie
app.post('/login', async (req, res) => {
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    try {
        let user = await User.findOne({ userId });

        if (!user) {
            console.log('Creating new user:', userId);
            user = new User({ userId, tokens: 10 });
            await user.save();
        }

        // Cookie httpOnly + Secure + SameSite=None để hoạt động cross-origin
        res.cookie('userId', userId, {
            httpOnly: true,
            secure: true,
            sameSite: 'None',
            maxAge: 30 * 24 * 60 * 60 * 1000 // 30 ngày
        });

        res.json({ message: 'Logged in successfully' });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error during login' });
    }
});

// GET /me  – trả về số token của user đang đăng nhập (dựa vào cookie userId)
app.get('/me', (req, res) => {
    if (req.user) {
        res.json({ tokens: req.user.tokens });
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
});

// POST /convert  – trừ token theo số block, yêu cầu cookie userId hợp lệ
app.post('/convert', async (req, res) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

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

// Rate limiting for recharge requests
const rechargeRateLimit = new Map();

// POST /api/recharge  – Thesieure API v2
app.post('/api/recharge', async (req, res) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // Rate limit: 3 requests / 5 minutes
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
        // Generate request ID
        const requestId = String(Date.now());
        
        // Calculate TSR signature
        const sign = crypto.createHash('md5')
            .update(TSR_PARTNER_KEY + code + serial)
            .digest('hex');

        // Save transaction first
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

        // Update rate limit
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
        
        res.json({
            success: true,
            message: 'Recharge request sent',
            requestId,
            response: tsrData
        });

    } catch (error) {
        console.error('TSR API Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/callback/thesieure  – Thesieure Webhook v2
app.post('/api/callback/thesieure', async (req, res) => {
    try {
        const { request_id, code, serial, status, amount, callback_sign } = req.body;

        // Verify signature
        const expectedSign = crypto.createHash('md5')
            .update(TSR_PARTNER_KEY + code + serial)
            .digest('hex');

        if (callback_sign !== expectedSign) {
            return res.status(401).json({ status: 'error', message: 'Invalid signature' });
        }

        // Find transaction
        const transaction = await Transaction.findOne({ requestId: request_id });
        if (!transaction) {
            return res.status(404).json({ status: 'error', message: 'Transaction not found' });
        }

        if (transaction.status !== 0) {
            return res.status(200).json({ status: 'success', message: 'Already processed' });
        }

        // Update transaction
        transaction.realAmount = amount;
        transaction.status = status;

        if (status === 1 || status === 3) {
            // Success or Wrong Amount - grant tokens based on real amount
            const tokensToAdd = Math.floor(amount / 1000);
            
            await User.findOneAndUpdate(
                { userId: transaction.userId },
                { $inc: { tokens: tokensToAdd } }
            );
        }

        await transaction.save();

        console.log(`TSR Callback: ${request_id} | Status: ${status} | Amount: ${amount}`);
        res.json({ status: 'success', message: 'OK' });

    } catch (error) {
        console.error('TSR Callback Error:', error);
        res.status(500).json({ status: 'error', message: 'Server error' });
    }
});

// GET /auth/google  – initiate Google OAuth flow
app.get('/auth/google', (req, res) => {
    const authUrl = client.generateAuthUrl({
        access_type: 'offline',
        scope: ['profile', 'email'],
        redirect_uri: 'http://localhost:3000/auth/google/callback'
    });
    
    res.redirect(authUrl);
});

// GET /auth/google/callback  – handle Google OAuth callback
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
        const userId = payload.sub; // Critical: We need the Google ID
        
        // 1. Create or find user (Replaces the need for the frontend to call /login)
        let user = await User.findOne({ userId });
        if (!user) {
            user = new User({ userId, tokens: 10 });
            await user.save();
        }
        
        // 2. Set the cookie for /me and /convert endpoints.
        // IMPORTANT: Use secure: false and sameSite: 'Lax' for localhost testing!
        res.cookie('userId', userId, {
            httpOnly: true,
            secure: false, 
            sameSite: 'Lax',
            maxAge: 30 * 24 * 60 * 60 * 1000
        });
        
        // 3. Create the JWT (now including the 'sub')
        const jwtToken = jwt.sign(
            { sub: userId, email: payload.email, name: payload.name },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        // 4. Redirect safely
        return res.redirect('/?token=' + jwtToken);
        
    } catch (error) {
        console.error('Google Auth callback error:', error);
        res.status(500).send('Authentication failed. Please check server console and ensure JWT_SECRET is in your .env file.');
    }
});


// GET /api/recharge/history  – Get user recharge transaction history
app.get('/api/recharge/history', async (req, res) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

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



// ─── Start server ─────────────────────────────────────────────────────────────
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
