const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
require('dotenv').config();
const connectDB = require('./db');
const User = require('./models/User');

const app = express();
const port = process.env.PORT || 3000;

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "dat_mot_ma_bi_mat_o_day";

// Connect to database
connectDB();

app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Middleware to identify user
app.use(async (req, res, next) => {
    const userId = req.cookies.userId;
    if (userId) {
        try {
            const user = await User.findOne({ userId });
            if (user) {
                req.user = user;
            }
        } catch (error) {
            console.error('Error finding user:', error);
        }
    }
    next();
});

app.post('/login', async (req, res) => {
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ error: "userId is required" });
    }

    try {
        let user = await User.findOne({ userId });

        if (!user) {
            console.log("Creating new user:", userId);
            user = new User({ userId, tokens: 10 });
            await user.save();
        }

        res.cookie('userId', userId, {
            httpOnly: true,
            secure: true,
            sameSite: 'None',
            maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
        });

        res.json({ message: "Logged in successfully" });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: "Server error during login" });
    }
});

app.post('/webhook-recharge', async (req, res) => {
    const { userId, productId, orderId, secret } = req.body;

    if (secret !== WEBHOOK_SECRET) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    if (!userId || !productId || !orderId) {
        return res.status(400).json({ error: "Missing parameters" });
    }

    const product = products.find(p => p.Pid === productId);
    if (!product) {
        return res.status(404).json({ error: "Product not found" });
    }

    try {
        const updatedUser = await User.findOneAndUpdate(
            { userId },
            { $inc: { tokens: product.Ptokens } },
            { new: true, upsert: true } // Create user if not exists
        );

        console.log(`User ${userId} recharged with ${product.Ptokens} tokens. New balance: ${updatedUser.tokens}`);

        res.json({ message: "Recharge successful" });
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ error: "Server error during webhook processing" });
    }
});

// This endpoint is no longer needed as data is persistent
app.post('/sync-users', (req, res) => {
    res.status(410).json({ message: "This endpoint is deprecated and no longer functional." });
});

app.get('/me', (req, res) => {
    if (req.user) {
        res.json({ tokens: req.user.tokens });
    } else {
        res.status(401).json({ error: "Unauthorized" });
    }
});

app.post('/convert', async (req, res) => {
    if (!req.user) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const { blocks } = req.body;
    const cost = Math.ceil(blocks / 1000);

    if (req.user.tokens < cost) {
        return res.status(400).json({ error: "Not enough tokens" });
    }

    try {
        req.user.tokens -= cost;
        await req.user.save();
        res.json({ message: "Conversion successful, tokens deducted." });
    } catch (error) {
        console.error('Conversion error:', error);
        res.status(500).json({ error: "Server error during conversion." });
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

// Mock product data (should match client-side)
const products = [
    { Pid: "01", Ptokens: 10 },
    { Pid: "02", Ptokens: 25 },
    { Pid: "03", Ptokens: 75 },
    { Pid: "04", Ptokens: 150 },
];
