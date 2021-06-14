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
            type: String,
            default: 'others'
        },
        status: {
            type: String,
            required: true
        },
        hobbies: {
            type: [String]
        },
        city: {
            type: String
        },
        date: {
            type: Date,
            default: Date.now
        }
    });

    module.exports = Profile = mongoose.model('profile', ProfileSchema);