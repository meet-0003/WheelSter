const router = require("express").Router();
const User = require("../models/user");
const { Vehicle, Car, Bike, Truck, Bus } = require("../models/vehicle");
const Booking = require("../models/booking");
const Payment = require("../models/payment");
const { message } = require("statuses");
const { authenticateToken, authorizeRole } = require("./userAuth");
const nodemailer = require("nodemailer");
const cron = require("node-cron");




//Create a new booking done
router.post("/create-booking", authenticateToken, authorizeRole(["user", "driver"]), async (req, res) => {
    try {
        let { vehicleId, startDate, endDate, location, area, city, state, country, pincode, pickupTime, duration, withDriver, licenseNumber } = req.body;
        const userId = req.user.id;

        // Fetch vehicle details from different models
        let vehicle = await Car.findById(vehicleId).populate("addedBy") ||
            await Bike.findById(vehicleId).populate("addedBy") ||
            await Truck.findById(vehicleId).populate("addedBy") ||
            await Bus.findById(vehicleId).populate("addedBy");

        if (!vehicle) {
            return res.status(404).json({ message: "Vehicle not found" });
        }

        if (!vehicle.rent) {
            return res.status(400).json({ message: "Vehicle rent is missing or invalid." });
        }

        // Check for existing overlapping bookings
        const existingBooking = await Booking.findOne({
            vehicle: vehicleId,
            status: { $in: ["Confirmed", "Pending"] },
            $or: [
                { startDate: { $lt: endDate }, endDate: { $gt: startDate } }
            ],
        });

        if (existingBooking) {
            return res.status(400).json({ message: "Vehicle is already booked for the selected dates." });
        }

        if (!startDate || !endDate) {
            return res.status(400).json({ message: "Start date and end date are required." });
        }
        
        if (new Date(startDate) > new Date(endDate)) {
            return res.status(400).json({ message: "End date must be after start date." });
        }
        
        // Ensure pickupTime is on the same day as startDate
        if (pickupTime) {
            const pickupDate = new Date(startDate);  // Keep it as a Date object
            const selectedTime = new Date(pickupTime);
        
            // Set hours and minutes from pickupTime to pickupDate
            pickupDate.setHours(selectedTime.getHours(), selectedTime.getMinutes());
        
            pickupTime = pickupDate;  // Now it's a proper Date object
            console.log("🚗 pickupTime after fix:", pickupTime);

        }
        
        

        // Validate license number when without driver
        if (!withDriver && !licenseNumber) {
            return res.status(400).json({ message: "License number is required when renting without a driver." });
        }

        // Construct address
        const address = `${location}, ${area}, ${city}, ${state}, ${country}, ${pincode}`;

        // Validate duration
        if (!duration || duration <= 0) {
            return res.status(400).json({ message: "Invalid duration provided." });
        }

        // Calculate total amount
        const totalAmount = vehicle.rent * duration;

        // Create new booking
        const newBooking = new Booking({
            user: userId,
            vehicle: vehicleId,
            driver: withDriver ? vehicle.addedBy._id : null, // Assign driver only if selected
            address,
            pickupTime,
            startDate,
            endDate,
            duration,
            totalAmount,
            withDriver,
            licenseNumber: withDriver ? null : licenseNumber,
            status: "Pending",
            paymentStatus: "Pending",
            createdAt: new Date(),
        });

        await newBooking.save();

        // Update user address
        await User.findByIdAndUpdate(userId, { address });

        res.status(200).json({ message: "Booking created successfully", bookingId: newBooking._id });
    } catch (error) {
        console.error("Error in create-booking:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});



// booking cancel
router.post("/cancel-booking/:bookingId", authenticateToken, authorizeRole(["user"]), async (req, res) => {
    try {
        const { bookingId } = req.params;
        const userId = req.user.id;

        const booking = await Booking.findById(bookingId);
        if (!booking) {
            return res.status(404).json({ message: "Booking not found" });
        }

        if (booking.user.toString() !== userId) {
            return res.status(403).json({ message: "Unauthorized to cancel this booking" });
        }

        if (booking.status === "Cancelled") {
            return res.status(400).json({ message: "Booking is already cancelled" });
        }
        if (booking.status === "Completed") {
            return res.status(400).json({ message: " You will not get a refund if you cancel a completed booking. " });
        }

        booking.status = "Cancelled";
        let vehicle = await Car.findById(booking.vehicle) ||
            await Bike.findById(booking.vehicle) ||
            await Truck.findById(booking.vehicle) ||
            await Bus.findById(booking.vehicle);
        if (vehicle) {
            vehicle.availability = true;
            await vehicle.save();
        }
        await booking.save();

        res.status(200).json({ message: "Booking cancelled successfully" });
    } catch (error) {
        res.status(500).json({ message: "Internal server error" });
    }
});

const stripe = require("stripe")("sk_test_51R5syKH83FrM5QBBpCNC3Bl4wW4bDBJOKubitHHf5wcSnkv3E7hpLmkpYIToGcp9GmikMLJgba4yMtmCz9H7WFRj00zm29hV35");


router.post("/process-payment", authenticateToken, authorizeRole(["user", "driver"]), async (req, res) => {
    try {
        const { bookingId, method, paymentMethodId } = req.body;
        const userId = req.user?.id;

        if (!bookingId) return res.status(400).json({ message: "Booking ID is required" });

        const booking = await Booking.findById(bookingId).populate("vehicle");
        if (!booking) return res.status(404).json({ message: "Booking not found" });

        if (booking.paymentStatus === "Paid") return res.status(400).json({ message: "Payment already completed" });

        let paymentStatus = "Pending";
        let transactionId = null;

        if (method === "Card") {
            const paymentIntent = await stripe.paymentIntents.create({
                amount: booking.totalAmount * 100,
                currency: "usd",
                payment_method: paymentMethodId,
                confirm: true,
                return_url: "http://localhost:3000/payment-success", // Change this to your frontend success page
            })

            paymentStatus = paymentIntent.status === "succeeded" ? "Completed" : "Failed";
            transactionId = paymentIntent.id;
        } else if (method === "COD") {
            paymentStatus = "Completed"; // COD is considered paid upon confirmation
        }

        // Save Payment
        const newPayment = new Payment({
            booking: bookingId,
            user: userId,
            amount: booking.totalAmount,
            method,
            status: paymentStatus,
            transactionId,
        });

        await newPayment.save();

        if (paymentStatus === "Completed") {
            await Booking.findByIdAndUpdate(bookingId, { paymentStatus: "Paid", status: "Confirmed" });

            // Send Confirmation Email
            await sendBookingConfirmation(userId, booking);

            return res.status(200).json({ message: "Payment successful", transactionId });
        } else {
            return res.status(400).json({ message: "Payment failed" });
        }
    } catch (error) {
        console.error("Payment processing error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});


//Send email confirmation done
const sendBookingConfirmation = async (userId, booking) => {
    try {
        const user = await User.findById(userId);

        let vehicle = await Car.findById(booking.vehicle) ||
            await Bike.findById(booking.vehicle) ||
            await Truck.findById(booking.vehicle) ||
            await Bus.findById(booking.vehicle);

        let transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT,
            service: process.env.SMTP_SERVICE,
            auth: {
                user: process.env.SMTP_EMAIL,
                pass: process.env.SMTP_PASSWORD,
            },
        });

        let mailOptions = {
            from: process.env.SMTP_EMAIL,
            to: user.email,
            subject: "Booking Confirmation",
            html: `
               <h1>WheelSter</h1>
                <h2>Booking Confirmed</h2>
                </br>
                <p><strong>📅 Date:</strong> ${new Date().toLocaleDateString()}</p>
                <p>👤 Dear ${user.username},</p>
                <p><strong>📞 Phone :</strong> ${user.phnumber}</p>
                </br>
                <p>Your booking has been confirmed.</p>
                </br>
                <h2> 🚗 Vehicle Details </h2></br>
                <p><strong>Model Name :</strong> ${vehicle.name} (${vehicle.vehicleType})</p>
                <p><strong>Registration Number :</strong> ${vehicle.registrationNumber}</p>
                </br>
                <h2>📍 Pickup Location </h2></br>
                <p><strong>Location:</strong> ${booking.address}</p>
                </br>
                <h2>🕒 Booking Details</h2></br>
                <p><strong>Start Date:</strong> ${new Date(booking.startDate).toLocaleDateString()}</p>
                <p><strong>End Date:</strong> ${new Date(booking.endDate).toLocaleDateString()}</p>
                <p><strong>Pickup Time:</strong> ${new Date(booking.pickupTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}</p>
                <p><strong>Duration:</strong> ${booking.duration} Days</p>
                </br>
                <h2>💰 Payment Summary</h2></br>
                <p><strong>Total Amount:</strong> $${booking.totalAmount}</p>
                </br>
                <p>📧 Thank you for choosing our service!</p>
                <p>🚗 We look forward to serving you!</p>
                <p>📩 For any inquiries, contact us at wheelSter@gmail.com</p>
            `,
        };

        await transporter.sendMail(mailOptions);
    } catch (error) {
        console.log("Error sending email:", error);
    }
};

// Run every 5 minutes to check for expired bookings
cron.schedule("*/1 * * * *", async () => {
    const expiryTime = new Date(Date.now() - 10 * 60 * 1000);

    const expiredBookings = await Booking.find({ status: "Pending", createdAt: { $lt: expiryTime } });

    for (const booking of expiredBookings) {
        booking.status = "Cancelled";
        await booking.save();

        let vehicle = await Car.findById(booking.vehicle) ||
            await Bike.findById(booking.vehicle) ||
            await Truck.findById(booking.vehicle) ||
            await Bus.findById(booking.vehicle);

        if (vehicle) {
            vehicle.availability = "Available";
            await vehicle.save();
        }
    }
});


router.get("/bookings/:vehicleId", async (req, res) => {
    const { vehicleId } = req.params;
    try {
        const bookings = await Booking.find({ vehicle: vehicleId }).select("startDate endDate");
        if (!bookings.length) {
            return res.status(404).json({ message: "No bookings found for this vehicle" });
        }
        res.json({ bookings });
    } catch (error) {
        res.status(500).json({ message: "Error fetching booked dates" });
    }
});



module.exports = router;

