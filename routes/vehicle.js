const router = require("express").Router();
const User = require("../models/user");
const jwt = require("jsonwebtoken");
const { Vehicle } = require("../models/vehicle");
const status = require("statuses");
const Booking = require("../models/booking");
const { authenticateToken, authorizeRole } = require("./userAuth");



//Get All vehicle done
// router.get('/get-all-vehicle', async (req, res) => {

//     try {

//         const vehicles = await Vehicle.find({status:"Approved"}).sort({createdAt: -1});


//         const updatedVehicles = await Promise.all(
//             vehicles.map(async (vehicle) => {
//                 const confirmedBooking = await Booking.findOne({
//                     vehicle: vehicle._id,
//                     status: "Confirmed",
//                 });

//                 if (confirmedBooking) {
//                     return { ...vehicle._doc, availability: "Not Available" };
//                 }
//                 const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
//                 const pendingBooking = await Booking.findOne({
//                     vehicle: vehicle._id,
//                     status: "Pending",
//                     createdAt: { $gt: tenMinutesAgo },
//                 });

//                 return {
//                     ...vehicle._doc,
//                     availability: pendingBooking ? "Available" : vehicle.availability,
//                 };
//             })
//         );
//         return res.json({ status: "Success", data: updatedVehicles });
//     } catch (error) {
//         res.status(500).json({ message: "Internal srever error!!!" });
//     }
// });


router.get('/get-all-vehicle', authenticateToken, async (req, res) => {
    try {
        const userRole = req.user.role;

        let vehicles;

        // ✅ If admin, populate addedBy with driver's name
        if (userRole === "admin") {
            vehicles = await Vehicle.find({ status: "Approved" })
                .populate("addedBy", "username")
                .sort({ createdAt: -1 });
        } else {
            // ✅ For non-admins, do not populate addedBy
            vehicles = await Vehicle.find({ status: "Approved" }).sort({ createdAt: -1 });
        }

        // ✅ Availability logic (same as before)
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
        console.error(error);
        res.status(500).json({ message: "Internal server error!!!" });
    }
});



//vehicle details done
router.get('/get-vehicle-by-id/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const vehicle = await Vehicle.findById(id).populate("ratings.user", "name");

        if (!vehicle) {
            return res.status(404).json({ message: "Vehicle not found" });
        }

        // Calculate average rating
        let averageRating = 0;
        if (vehicle.ratings.length > 0) {
            const totalRating = vehicle.ratings.reduce((sum, r) => sum + r.rating, 0);
            averageRating = (totalRating / vehicle.ratings.length).toFixed(1);
        }

        // Check booking status
        const confirmedBooking = await Booking.findOne({ vehicle: id, status: "Confirmed" });

        if (confirmedBooking) {
            return res.json({ status: "Success", data: { ...vehicle._doc, availability: "Not Available", averageRating } });
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
                averageRating
            }
        });

    } catch (error) {
        console.error("Error fetching vehicle:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

router.post('/rate-vehicle/:id', authenticateToken, authorizeRole(["user", "driver"]), async (req, res) => {
    try {
        const { id } = req.params;
        const { rating } = req.body;
        const userId = req.user.id;

        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({ message: "Rating must be between 1 and 5" });
        }

        const vehicle = await Vehicle.findById(id);
        if (!vehicle) {
            return res.status(404).json({ message: "Vehicle not found" });
        }

        // Check if user has already rated
        const existingRating = vehicle.ratings.find(r => r.user.toString() === userId);
        if (existingRating) {
            existingRating.rating = rating; // Update existing rating
        } else {
            vehicle.ratings.push({ user: userId, rating });
        }

        // Recalculate average rating
        const totalRating = vehicle.ratings.reduce((sum, r) => sum + r.rating, 0);
        vehicle.averageRating = (totalRating / vehicle.ratings.length).toFixed(1);

        await vehicle.save();
        res.json({ message: "Rating submitted successfully!", averageRating: vehicle.averageRating });

    } catch (error) {
        console.error("Error submitting rating:", error);
        res.status(500).json({ message: "Internal Server Error" });
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
            status: { $nin: ["Cancelled", "Completed"] } // Ignore cancelled & completed bookings
        });

        const isBooked = bookings.length > 0;
        res.json({ isBooked });
    } catch (error) {
        console.error("Error checking vehicle availability:", error);
        res.status(500).json({ message: "Error fetching availability" });
    }
});



module.exports = router;