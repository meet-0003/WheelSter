const mongoose = require('mongoose');

const user = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
    },
    email: {
        type: String,
        required: true,
        unique: true,
    },
    password: {
        type: String,
        required: true,
    },
    phnumber: {
        type: String,
        required: true,
    },
    avatar: {
        type: String,
    },
    role: {
        type: String,
        default: "user",
        enum: ["user", "driver", "admin"],
    },
    address: { 
        type: String,
        default: "",
    },
    bookings: [{
        type: mongoose.Types.ObjectId,
        ref: "booking",
    }],
    resetOTP: { 
        type: String, 
        default: null 
    },
    otpExpires: { 
        type: Date, 
        default: null 
    },  
    driverInfo: {
        address: { type: String, default: "" },
        licenseNumber: { type: String, unique: true, sparse: true }, 
        licenseExpiry: { type: Date },
        experience: { type: Number, default: 0 },
        ability: { type: String },
        age: { type: Number },
        gender: { type: String, enum: ["male", "female"] },
        dob: { type: Date },
        vehicles: [{
            type: mongoose.Types.ObjectId,
            ref: "vehicle",
        }],
    }
}, 
{ timestamps: true }
);

module.exports = mongoose.model("user", user);
