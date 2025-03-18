const mongoose = require("mongoose");

const payment = new mongoose.Schema({
    booking: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "Booking", 
        // required: true
    },
    user: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "User", 
        // required: true 
    },
    amount: { 
        type: Number, 
        required: true 
    },
    method: { 
        type: String, 
        required: true, 
        enum: ["Card", "cod", "Wallet"] 
    },
    status: { 
        type: String, 
        default: "Pending", 
        enum: ["Pending", "Completed", "Failed"] 
    },
}, { timestamps: true });

module.exports = mongoose.model("Payment", payment);
