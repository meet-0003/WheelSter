const mongoose = require('mongoose');
const status = require('statuses');
const { DriverStatus, BookingStatus, PaymentStatus } = require('../enum');

const booking = new mongoose.Schema({
    user: {
        type: mongoose.Types.ObjectId,
        ref: "user",
    },
    vehicle: {
        type: mongoose.Types.ObjectId,
        ref: "vehicle",
    },
    driver: {
        type: mongoose.Types.ObjectId,
        ref: "user",
    },
    reassignedDrivers: [{
        driver: { type: mongoose.Types.ObjectId, ref: "user" },
        reassignedBy: { type: mongoose.Types.ObjectId, ref: "user" }, // Admin who reassigned
        reassignedAt: { type: Date, default: Date.now }
    }],
    address: {
        type: String,
        required: true
    },
    startDate: {
        type: Date,
        // required: true 
    },
    endDate: {
        type: Date,
        // required: true
    },
    pickupTime: {
        type: Date,
        // required: true
    },
    totalAmount: {
        type: Number,
    },
    duration: {
        type: Number,
        default: 0
    },
    withDriver: {
        type: Boolean,
        required: true
    },
    licenseNumber: {
        type: String,
        required: function () { return !this.withDriver; }
    },
    driverStatus: {
        type: String,
        default: DriverStatus.PENDING,
        enum: DriverStatus
    },
    status: {
        type: String,
        default: BookingStatus.PENDING,
        enum: BookingStatus
    },
    paymentStatus: {
        type: String,
        default: PaymentStatus.PENDING,
        enum: PaymentStatus
    },
    paymentId: {
        type: String,
        default: null
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
},
    { timeseries: true }
);

// booking.pre("save", function (next) {
//     if (this.status === "Cancelled") {
//         this.driverStatus = "-";
//     }
//     next();
// });

module.exports = mongoose.model("booking", booking);