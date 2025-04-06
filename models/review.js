const mongoose = require("mongoose");

const review = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
        // required: true
    },
    // vehicle: {
    //     type: mongoose.Schema.Types.ObjectId,
    //     ref: "Vehicle",
    //     // required: true
    // },
    rating: {
        type: Number,
        // required: true,
        min: 1,
        max: 5
    },
    comment: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
},
    { timestamps: true }
);

module.exports = mongoose.model("review", review);
