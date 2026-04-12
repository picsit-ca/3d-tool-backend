const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
        index: true
    },
    requestId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    telco: {
        type: String,
        required: true
    },
    code: {
        type: String,
        required: true
    },
    serial: {
        type: String,
        required: true
    },
    declaredAmount: {
        type: Number,
        required: true
    },
    realAmount: {
        type: Number,
        default: 0
    },
    status: {
        type: Number,
        enum: [0, 1, 2, 3],
        default: 0,
        index: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Transaction', TransactionSchema);