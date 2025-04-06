const mongoose = require("mongoose");
const router = require("express").Router();
const User = require("../models/user");
const { Vehicle, Car, Bike, Truck, Bus } = require("../models/vehicle");
const Booking = require("../models/booking");
const Payment = require("../models/payment");
const { message } = require("statuses");
const { authenticateToken, authorizeRole } = require("./userAuth");
const nodemailer = require("nodemailer");
const cron = require("node-cron");
const { DriverStatus, BookingStatus, PaymentStatus } = require("../enum");

//Create a new booking done
router.post("/create-booking", authenticateToken, authorizeRole(["user", "driver"]),
  async (req, res) => {
    try {
      let {
        vehicleId,
        startDate,
        endDate,
        location,
        area,
        city,
        state,
        country,
        pincode,
        pickupTime,
        duration,
        withDriver,
        licenseNumber,
      } = req.body;
      const userId = req.user.id;

      // Fetch vehicle details from different models
      let vehicle =
        (await Car.findById(vehicleId).populate("addedBy")) ||
        (await Bike.findById(vehicleId).populate("addedBy")) ||
        (await Truck.findById(vehicleId).populate("addedBy")) ||
        (await Bus.findById(vehicleId).populate("addedBy"));

      if (!vehicle) {
        return res.status(404).json({ message: "Vehicle not found" });
      }

      if (!vehicle.rent) {
        return res
          .status(400)
          .json({ message: "Vehicle rent is missing or invalid." });
      }

      // Check for existing overlapping bookings
      const existingBooking = await Booking.findOne({
        vehicle: vehicleId,
        status: { $in: ["Confirmed", "Pending"] },
        $or: [{ startDate: { $lt: endDate }, endDate: { $gt: startDate } }],
      });

      if (existingBooking) {
        return res
          .status(400)
          .json({
            message: "Vehicle is already booked for the selected dates.",
          });
      }

      if (!startDate || !endDate) {
        return res
          .status(400)
          .json({ message: "Start date and end date are required." });
      }

      if (new Date(startDate) > new Date(endDate)) {
        return res
          .status(400)
          .json({ message: "End date must be after start date." });
      }

      // Ensure pickupTime is on the same day as startDate
      if (pickupTime) {
        const pickupDate = new Date(startDate); // Keep it as a Date object
        const selectedTime = new Date(pickupTime);

        // Set hours and minutes from pickupTime to pickupDate
        pickupDate.setHours(selectedTime.getHours(), selectedTime.getMinutes());

        pickupTime = pickupDate; // Now it's a proper Date object
        console.log("🚗 pickupTime after fix:", pickupTime);
      }

      // Validate license number when without driver
      if (!withDriver && !licenseNumber) {
        return res
          .status(400)
          .json({
            message:
              "License number is required when renting without a driver.",
          });
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

      res
        .status(200)
        .json({
          message: "Booking created successfully",
          bookingId: newBooking._id,
        });
    } catch (error) {
      console.error("Error in create-booking:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

const stripe = require("stripe")(
  "sk_test_51R5syKH83FrM5QBBpCNC3Bl4wW4bDBJOKubitHHf5wcSnkv3E7hpLmkpYIToGcp9GmikMLJgba4yMtmCz9H7WFRj00zm29hV35"
);

router.post("/process-payment", authenticateToken, authorizeRole(["user", "driver"]), async (req, res) => {
  try {
    const { bookingId, method, paymentMethodId } = req.body;
    const userId = req.user?.id;

    if (!bookingId)
      return res.status(400).json({ message: "Booking ID is required" });

    const booking = await Booking.findById(bookingId).populate("vehicle");
    if (!booking)
      return res.status(404).json({ message: "Booking not found" });

    if (booking.paymentStatus === "Paid")
      return res.status(400).json({ message: "Payment already completed" });

    let paymentStatus = "Pending";
    let transactionId = null;

    if (method === "Card") {
      const minAmountInr = 50; // Stripe's minimum equivalent in INR

      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.max(booking.totalAmount, minAmountInr) * 100, // Ensure at least ₹50
        currency: "inr",
        payment_method: paymentMethodId,
        confirm: true,
        return_url: "http://localhost:3000/payment-success",
      });

      paymentStatus =
        paymentIntent.status === "succeeded" ? "Completed" : "Failed";
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
      await Booking.findByIdAndUpdate(bookingId, {
        paymentStatus: "Paid",
        status: "Confirmed",
      });

      // Send Confirmation Email
      await sendBookingConfirmation(userId, booking);

      return res
        .status(200)
        .json({ message: "Payment successful", transactionId });
    } else {
      return res.status(400).json({ message: "Payment failed" });
    }
  } catch (error) {
    console.error("Payment processing error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}
);

// Cancel Booking and Process Refund
router.post("/cancel-booking", authenticateToken, authorizeRole(["user", "admin", "driver"]), async (req, res) => {
  try {
    const { bookingId, refundAmount } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role; // 👈 Get the role of the one making the request


    // Fetch booking details
    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    // Prevent cancellation if already completed
    if (booking.status === "Completed") {
      return res.status(400).json({ message: "Booking already completed. Cannot cancel." });
    }

    // 🟨 Only if driver cancels — send email to the user
    if (userRole === "driver") {
      await sendMail(
        booking.user, // userId to whom the email should go
        "Booking Cancelled by Driver",
        booking
      );
    }

    // Update booking status to Cancelled
    booking.status = "Cancelled";
    await booking.save();

    // Check for payment details
    const payment = await Payment.findOne({ booking: bookingId });
    if (!payment || payment.status !== "Completed") {
      return res.status(200).json({ message: "Booking cancelled successfully. No refund needed." });
    }

    // Calculate refund amount (Default: 80% of the paid amount)
    let defaultRefundAmount = payment.amount * 0.8;
    let updatedRefundAmount = refundAmount !== undefined ? Math.min(refundAmount, payment.amount) : defaultRefundAmount;

    if (updatedRefundAmount > payment.amount) {
      return res.status(400).json({ message: "Refund amount cannot exceed paid amount." });
    }

    // Handle Refund Process
    if (payment.method === "Card") {
      try {
        // Refund via Stripe
        const refund = await stripe.refunds.create({
          payment_intent: payment.transactionId,
          amount: updatedRefundAmount, // Convert to cents
        });

        // Update payment refund details
        payment.refundStatus = "Refunded";
        payment.refundedAmount = updatedRefundAmount;
        payment.status = "Refunded"; // ✅ Updating payment status
        await payment.save();

        booking.paymentStatus = "Refunded";
        await booking.save();

        return res.status(200).json({
          message: `Booking cancelled. Refund of $${updatedRefundAmount} processed successfully.`,
          refundedAmount: updatedRefundAmount,
          paymentStatus: payment.status
        });
      } catch (error) {
        return res.status(500).json({ message: "Refund failed. Contact support." });
      }
    } else if (payment.method === "Wallet") {
      // Refund to user's wallet
      payment.refundStatus = "Refunded";
      payment.refundedAmount = updatedRefundAmount;
      payment.status = "Refunded"; // ✅ Updating payment status
      await payment.save();

      return res.status(200).json({
        message: `Booking cancelled. Refund of $${updatedRefundAmount} added to wallet.`,
        refundedAmount: updatedRefundAmount,
        paymentStatus: payment.status
      });
    } else {
      // COD refunds are manual
      payment.refundStatus = "Not Initiated";
      payment.status = "Pending Refund"; // ✅ Setting a proper status for COD refunds
      await payment.save();

      return res.status(200).json({
        message: "Booking cancelled. Contact support for COD refund.",
        paymentStatus: payment.status
      });
    }
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: "Internal server error" });
  }
});

const sendMail = async (userId, subject, booking) => {
  try {
    const user = await User.findById(userId);

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      service: process.env.SMTP_SERVICE,
      secure: true,
      auth: {
        user: process.env.SMTP_EMAIL,
        pass: process.env.SMTP_PASSWORD,
      },
    });

    const mailOptions = {
      from: `"Vehicle Rental Service" <${process.env.SMTP_EMAIL}>`,
      to: user.email,
      subject,
      html: `  <h3>Booking Rejected</h3>
      <p>Dear ${user.username},</p>
      <p>Unfortunately, your booking with ID <strong>${booking._id}</strong> has been rejected by the driver.</p>
      <p>Please try booking another vehicle or contact support if needed.</p>
      <br />
      <p>Thanks,<br/>Vehicle Rental Team</p>`,
    };

    await transporter.sendMail(mailOptions);
    console.log("📧 Email sent to", user.email);
  } catch (error) {
    console.error("❌ Failed to send email:", error.message);
  }
};

//Send email confirmation done
const sendBookingConfirmation = async (userId, booking) => {
  try {
    const user = await User.findById(userId);

    let vehicle =
      (await Car.findById(booking.vehicle)) ||
      (await Bike.findById(booking.vehicle)) ||
      (await Truck.findById(booking.vehicle)) ||
      (await Bus.findById(booking.vehicle));

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
                <p><strong>Model Name :</strong> ${vehicle.name} (${vehicle.vehicleType
        })</p>
                <p><strong>Registration Number :</strong> ${vehicle.registrationNumber
        }</p>
                </br>
                <h2>📍 Pickup Location </h2></br>
                <p><strong>Location:</strong> ${booking.address}</p>
                </br>
                <h2>🕒 Booking Details</h2></br>
                <p><strong>Start Date:</strong> ${new Date(
          booking.startDate
        ).toLocaleDateString()}</p>
                <p><strong>End Date:</strong> ${new Date(
          booking.endDate
        ).toLocaleDateString()}</p>
                <p><strong>Pickup Time:</strong> ${new Date(
          booking.pickupTime
        ).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        })}</p>
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

  const expiredBookings = await Booking.find({
    status: "Pending",
    createdAt: { $lt: expiryTime },
  });

  for (const booking of expiredBookings) {
    booking.status = "Cancelled";
    await booking.save();

    let vehicle =
      (await Car.findById(booking.vehicle)) ||
      (await Bike.findById(booking.vehicle)) ||
      (await Truck.findById(booking.vehicle)) ||
      (await Bus.findById(booking.vehicle));

    if (vehicle) {
      vehicle.availability = "Available";
      await vehicle.save();
    }
  }
});


router.get("/bookings/:vehicleId", async (req, res) => {
  const { vehicleId } = req.params;
  console.log("Fetching bookings for vehicleId:", vehicleId);

  try {
    // Check if vehicle exists first
    const vehicle = await Vehicle.findById(vehicleId);
    if (!vehicle) {
      return res.status(404).json({ message: "Vehicle not found" });
    }

    // Fetch bookings, including status
    const bookings = await Booking.find({
      vehicle: vehicleId,
      status: { $in: ["Confirmed", "Completed", "Cancelled"] },
    }).select("startDate endDate status");

    res.json({ bookings, vehicle });
  } catch (error) {
    console.error("Error fetching bookings:", error);
    res.status(500).json({ message: "Error fetching booked dates" });
  }
});

// Accept or reject the booking
router.put("/bookings/:bookingId", authenticateToken, authorizeRole(["driver"]), async (req, res) => {
  try {
    const { action } = req.body; // 'accept' or 'reject'
    const driverId = req.user.id;
    const { bookingId } = req.params;

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      console.log("Booking not found");
      return res.status(404).json({ message: "Booking not found" });
    }


    // Ensure the requesting driver is the currently assigned driver
    if (!booking.driver || booking.driver.toString() !== driverId) {
      console.log(`Unauthorized action: Driver ${driverId} is not the assigned driver for booking ${bookingId}`);

      // Log the latest booking driver to debug
      const updatedBooking = await Booking.findById(bookingId);
      console.log(`Latest Booking Driver ID: ${updatedBooking?.driver}`);

      return res.status(403).json({ message: "Unauthorized action" });
    }

    if (action === "accept" || action === "accepted") {
      booking.driverStatus = DriverStatus.ACCEPTED;
    } else if (action === "reject" || action === "rejected") {
      booking.driverStatus = DriverStatus.REJECTED;
      booking.status = BookingStatus.CANCELLED;

      const payment = await Payment.findOne({ booking: bookingId });
      const updatedRefundAmount = payment.amount;
      if (payment.method === "Card") {
        try {
          // Refund via Stripe
          const refund = await stripe.refunds.create({
            payment_intent: payment.transactionId,
            amount: updatedRefundAmount, // Convert to cents
          });

          // Update payment refund details
          payment.refundStatus = "Refunded";
          payment.refundedAmount = updatedRefundAmount;
          payment.status = "Refunded"; // ✅ Updating payment status
          await payment.save();

          booking.paymentStatus = PaymentStatus.REFUNDED;

        } catch (error) {
          console.log(error)
          return res.status(500).json({ message: "Refund failed. Contact support." });
        }
      } else if (payment.method === "Wallet") {
        // Refund to user's wallet
        payment.refundStatus = "Refunded";
        payment.refundedAmount = updatedRefundAmount;
        payment.status = "Refunded"; // ✅ Updating payment status
        await payment.save();

        booking.paymentStatus = PaymentStatus.REFUNDED;

      } else {
        // COD refunds are manual
        payment.refundStatus = "Not Initiated";
        payment.status = "Pending Refund"; // ✅ Setting a proper status for COD refunds
        await payment.save();
      }

    } else {
      console.log("Invalid action received");
      return res.status(400).json({ message: "Invalid action" });
    }

    await booking.save();
    console.log(`Booking ${action} successfully`);
    res.json({ message: `Booking ${action} successfully`, data: booking });

  } catch (error) {
    console.error("Error updating booking:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});






module.exports = router;
