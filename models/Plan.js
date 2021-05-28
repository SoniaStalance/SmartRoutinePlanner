const mongoose = require('mongoose');

    const PlanSchema = new mongoose.Schema({
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'user'
        },
        routine:  [
            {
                date: {
                        type: Date,
                        default: Date.now
                },
                plan: {
                        type: Array,
                        required: true
                },
                remarks: {
                    type: Array
                },
                score:  {
                            type: String,
                            default: "0"
                },
                feedback:  {
                    type: String,
                    default: "3"
                }
            }
        ]
    });

    module.exports = Plan = mongoose.model('plan', PlanSchema);