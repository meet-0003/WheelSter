const mongoose = require("mongoose");

const feedback = new mongoose.Schema({
    user: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "user", 
    },
    type: { 
        type: String, 
        enum: ["feedback", "complaint"], 
    },
    message: { 
        type: String, 
        required: true 
    },
    status: { 
        type: String, 
        enum: ["Pending", "Resolved"], 
        default: "Pending" 
    },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("feedback", feedback);
