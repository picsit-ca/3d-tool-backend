const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const app = express();
const port = process.env.PORT || 3000;

const WEBHOOK_SECRET = "dat_mot_ma_bi_mat_o_day";

// In-memory user data store
let users = {
    // "demo_user": { tokens: 100 }
};

app.use(cors({
    origin: ['https://3d-tool-frontend.vercel.app', 'http://127.0.0.1:5500'],
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Middleware to identify user
app.use((req, res, next) => {
    const userId = req.cookies.userId;
    if (userId && users[userId]) {
        req.user = { id: userId };
    }
    next();
});

app.post('/login', (req, res) => {
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ error: "userId is required" });
    }

    if (!users[userId]) {
        console.log("Creating new user:", userId);
        users[userId] = { tokens: 10 }; // Default tokens for new user
    }

    res.cookie('userId', userId, {
        httpOnly: true,
        secure: true,
        sameSite: 'None'
    });

    res.json({ message: "Logged in successfully" });
});

app.post('/webhook-recharge', (req, res) => {
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

    if (!users[userId]) {
        users[userId] = { tokens: 0 };
    }

    users[userId].tokens += product.Ptokens;

    console.log(`User ${userId} recharged with ${product.Ptokens} tokens. New balance: ${users[userId].tokens}`);

    res.json({ message: "Recharge successful" });
});

app.post('/sync-users', (req, res) => {
    const { userList, secret } = req.body;

    if (secret !== WEBHOOK_SECRET) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    if (!userList) {
        return res.status(400).json({ error: "userList is required" });
    }

    try {
        const syncedUsers = JSON.parse(userList);
        users = { ...users, ...syncedUsers };
        console.log("Users synced from Android app backup");
        res.json({ message: "Sync successful" });
    } catch (error) {
        res.status(400).json({ error: "Invalid userList format" });
    }
});


app.get('/me', (req, res) => {
    if (req.user && users[req.user.id]) {
        res.json({ tokens: users[req.user.id].tokens });
    } else {
        res.status(401).json({ error: "Unauthorized" });
    }
});

app.post('/convert', (req, res) => {
    if (!req.user) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = req.user.id;
    const { blocks } = req.body;
    const cost = Math.ceil(blocks / 1000);

    if (users[userId].tokens < cost) {
        return res.status(400).json({ error: "Not enough tokens" });
    }

    users[userId].tokens -= cost;

    res.json({ message: "Conversion successful" });
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
