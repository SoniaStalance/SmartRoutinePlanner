const mongoose = require('mongoose');

    const ProfileSchema = new mongoose.Schema({
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'user'
        },
        age: {
            type: String,
            required: true
        },
        occupation: {
            type: String
        },
        status: {
            type: String,
            required: true
        },
        hobbies: {
            type: [String]
        },
        pincode: {
            type: String,
            required: true
        },
        date: {
            type: Date,
            default: Date.now
        }
    });

    module.exports = Profile = mongoose.model('profile', ProfileSchema);