const mongoose = require("mongoose");

const payment = new mongoose.Schema({
    booking: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "booking", 
        required: true
    },
    user: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "user", 
        required: true 
    },
    amount: { 
        type: Number, 
        required: true 
    },
    method: { 
        type: String, 
        required: true, 
        enum: ["Card", "COD", "Wallet"] 
    },
    status: { 
        type: String, 
        default: "Pending", 
        enum: ["Pending", "Completed", "Failed", "Refunded"] 
    },
    transactionId: {
        type: String, 
        default: null
    },
    refundStatus: { 
        type: String, 
        default: "Not Initiated",
        enum: ["Not Initiated", "Processing", "Refunded", "Failed"]
    },
    refundedAmount: {
        type: Number,
        default: 0
    }
}, { timestamps: true });

module.exports = mongoose.model("Payment", payment);
