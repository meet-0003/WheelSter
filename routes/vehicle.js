const router = require("express").Router();
const User = require("../models/user");
const jwt = require("jsonwebtoken");
const {  Vehicle } = require("../models/vehicle");
const status = require("statuses");
const Booking = require("../models/booking");



//Get All vehicle done
router.get('/get-all-vehicle', async (req, res) => {

    try {

        const vehicles = await Vehicle.find({status:"Approved"}).sort({createdAt: -1});


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


router.get("/vehicle-availability/:vehicleId", async (req, res) => {
    const { vehicleId } = req.params;
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to start of the day

    try {
        const bookings = await Booking.find({
            vehicle: vehicleId,
            startDate: { $lte: today }, // Booking started on or before today
            endDate: { $gte: today },   // Booking is still active today
        });

        const isBooked = bookings.length > 0;
        res.json({ isBooked });
    } catch (error) {
        console.error("Error checking vehicle availability:", error);
        res.status(500).json({ message: "Error fetching availability" });
    }
});

module.exports = router;