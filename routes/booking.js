const router = require("express").Router();
const User = require("../models/user");
const { Vehicle ,Car, Bike, Truck, Bus } = require("../models/vehicle");
const Booking = require("../models/booking");
const Payment = require("../models/payment");
const { message } = require("statuses");
const { authenticateToken ,authorizeRole} = require("./userAuth");
const nodemailer = require("nodemailer");
const cron = require("node-cron");




//Create a new booking done
router.post("/create-booking", authenticateToken, authorizeRole(["user","driver"]) ,async (req, res) => {
    try {

        const { vehicleId, endDate, startDate, location, area, city, state, country, pincode, pickupTime, duration, withDriver, licenseNumber } = req.body;
        const userId = req.user.id;

        let vehicle = await Car.findById(vehicleId).populate("addedBy") ||
            await Bike.findById(vehicleId).populate("addedBy") ||
            await Truck.findById(vehicleId).populate("addedBy") ||
            await Bus.findById(vehicleId).populate("addedBy");

        if (!vehicle) {
            return res.status(404).json({ message: "Vehicle not found" });
        }
        const existingBooking = await Booking.findOne({
            vehicle: vehicleId,
            status: "Confirmed",
            $or: [
                { startDate: { $lt: endDate }, endDate: { $gt: startDate } },
            ],
        });

        if (existingBooking) {
            return res.status(400).json({ message: "Vehicle is already booked." });
        }



        if (!withDriver && !licenseNumber) {
            return res.status(400).json({ message: "License number is required when choosing without driver." });
        }

        const address = `${location}, ${area}, ${city}, ${state}, ${country}, ${pincode}`;

        const totalAmount = parseInt(vehicle.rent) * duration;

        const newBooking = new Booking({
            user: userId,
            vehicle: vehicleId,
            driver: vehicle.addedBy._id,  // 🔥 Ensure we store the driver's ID
            address,
            pickupTime,
            duration,
            totalAmount,
            withDriver,
            licenseNumber: withDriver ? null : licenseNumber,
            status: "Pending",
            paymentStatus: "Pending",
            createdAt: new Date(),
        });

        await newBooking.save();

        await User.findByIdAndUpdate(userId, { address });

        res.status(200).json({ message: "Booking created successfully", bookingId: newBooking._id });
    } catch (error) {
        console.log(error);
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

//Process payment done
router.post("/process-payment", authenticateToken, authorizeRole(["user"]), async (req, res) => {
    try {
        const { bookingId, method, paymentId } = req.body;
        const userId = req.user?.id;

        if (!bookingId) {
            return res.status(400).json({ message: "Booking ID is required" });
        }

        const booking = await Booking.findById(bookingId).populate("vehicle");
        if (!booking) {
            return res.status(404).json({ message: "Booking not found" });
        }

        if (booking.paymentStatus === "Paid") {
            return res.status(400).json({ message: "Payment already completed" });
        }

        if (booking.status !== "Pending") {
            return res.status(400).json({ message: "Booking is already confirmed or cancelled." });
        }

        const newPayment = new Payment({
            booking: bookingId,
            user: userId,
            amount: booking.totalAmount,
            method,
            status: "Completed",
        });

        booking.paymentId = paymentId;

        await newPayment.save();
        await Booking.findByIdAndUpdate(bookingId, { paymentStatus: "Paid", status: "Confirmed" });

        res.status(200).json({ message: "Payment successful" });

        // Send email confirmation after successful payment
        await sendBookingConfirmation(userId, booking);
    } catch (error) {
        console.log("Error processing payment:", error);
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
                <p><strong>Model Name :</strong> ${vehicle.name}(${vehicle.vehicleType})</p>
                <p><strong>Registration Number :</strong> ${vehicle.registrationNumber}</p>
                </br>
                <h2>📍 Pickup Location </h2></br>
                <p><strong>Location:</strong> ${booking.address}</p>
                </br>
                <h2>🕒 Booking Details</h2></br>
                <p><strong>Pickup Time:</strong> ${new Date(booking.pickupTime).toLocaleTimeString({ hour: '2-digit', minute: '2-digit', hour12: true })}</p>
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


  

module.exports = router;

