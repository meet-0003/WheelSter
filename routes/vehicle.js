const router = require("express").Router();
const User = require("../models/user");
const jwt = require("jsonwebtoken");
const {  Vehicle } = require("../models/vehicle");
const status = require("statuses");
const Booking = require("../models/booking");



//Get All vehicle done
router.get('/get-all-vehicle', async (req, res) => {

    try {

        const vehicles = await Vehicle.find().sort({createdAt: -1});


        const updatedVehicles = await Promise.all(
            vehicles.map(async (vehicle) => {
                const confirmedBooking = await Booking.findOne({
                    vehicle: vehicle._id,
                    status: "Confirmed",
                });

                if (confirmedBooking) {
                    return { ...vehicle._doc, availability: "Not Available" };
                }
                const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
                const pendingBooking = await Booking.findOne({
                    vehicle: vehicle._id,
                    status: "Pending",
                    createdAt: { $gt: tenMinutesAgo },
                });

                return {
                    ...vehicle._doc,
                    availability: pendingBooking ? "Available" : vehicle.availability,
                };
            })
        );
        return res.json({ status: "Success", data: updatedVehicles });
    } catch (error) {
        res.status(500).json({ message: "Internal srever error!!!" });
    }
});

//Get Recently added vehicles 
router.get('/get-recent-vehicle', async (req, res) => {
    try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const vehicles = await Vehicle.find().sort({ createdAt: -1 }).limit(4);

        const updatedVehicles = vehicles.map(vehicle => {
            return {
                ...vehicle._doc,
                recentlyAdded: vehicle.createdAt > sevenDaysAgo,
            };
        });

        return res.json({ status: "Success", data: updatedVehicles });

    } catch (error) {
        res.status(500).json({ message: "Internal server error!!!" });
    }
});
//vehicle details done
router.get('/get-vehicle-by-id/:id', async (req, res) => {

    try {
        const { id } = req.params;
        const vehicle = await Vehicle.findById(id);

        if (!vehicle) {
            return res.status(404).json({ message: "Vehicle not found" });
        }

        const confirmedBooking = await Booking.findOne({
            vehicle: id,
            status: "Confirmed",
        });

        if (confirmedBooking) {
            return res.json({ status: "Success", data: { ...vehicle._doc, availability: "Not Available" } });
        }

        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
        const pendingBooking = await Booking.findOne({
            vehicle: id,
            status: "Pending",
            createdAt: { $gt: tenMinutesAgo },
        });

        return res.json({
            status: "Success",
            data: {
                ...vehicle._doc,
                availability: pendingBooking ? "Available" : vehicle.availability,
            }
        });

    } catch (error) {
        res.status(500).json({ message: "Internal srever error!!!" });
    }
});

module.exports = router;