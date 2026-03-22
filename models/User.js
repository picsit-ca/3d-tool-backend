const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
        unique: true,
    },
    tokens: {
        type: Number,
        default: 10,
    },
});

module.exports = mongoose.model('User', UserSchema);
