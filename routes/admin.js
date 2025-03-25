const router = require("express").Router();
const User = require("../models/user");
const Booking = require("../models/booking");
const Payment = require("../models/payment");
const jwt = require("jsonwebtoken");
const { Vehicle , Car, Bike, Truck, Bus } = require("../models/vehicle");
const { authenticateToken, authorizeRole } = require("./userAuth");
const status = require("statuses");
const nodemailer = require("nodemailer");


const vehicleModels = { car: Car, bike: Bike, truck: Truck, bus: Bus };

//Add Vehicle done
router.post("/add-vehicle/:vehicleType", authenticateToken, authorizeRole(["admin","driver"]), async (req, res) => {
    try {
        const { vehicleType } = req.params;
        const Model = vehicleModels[vehicleType.toLowerCase()];
        
        if (!Model) return res.status(400).json({ message: "Invalid vehicle type!" });

        // Ensure driver has completed profile
        // if (req.user.role === "driver") {
        //     const user = await User.findById(req.user.id);
        //     if (!user.driverInfo || !user.driverInfo.licenseNumber) {
        //         return res.status(403).json({ message: "Complete your driver profile before adding a vehicle!" });
        //     }
        // }

        const vehicleData = { 
            ...req.body, 
            addedBy: req.user.id, 
            status: "Pending", 
            availability: false 
        };
        
        const newVehicle = new Model(vehicleData);
        await newVehicle.save();

        res.status(201).json({ message: `${vehicleType} added successfully! To rental wait for admin approval.` });
    } catch (error) {
        console.error("Error adding vehicle:", error.message);
        res.status(500).json({ message: "Internal Server Error!", error: error.message });
    }    
});

// pending vehicle done
router.get("/pending-vehicles", authenticateToken, authorizeRole(["admin"]), async (req, res) => {
    try {
        const pendingVehicles = await Vehicle.find({ status: "Pending" }).populate("addedBy", "email name");
        res.status(200).json({ success: true, data: pendingVehicles });
    } catch (error) {
        console.error("Error fetching pending vehicles:", error);
        res.status(500).json({ success: false, message: "Internal Server Error!" });
    }
  });

//Vehicle approval api done
router.put("/approve-vehicle/:vehicleId", authenticateToken, authorizeRole(["admin"]), async (req, res) => {
  try {
      const { status, reason } = req.body;

      if (!["Approved", "Rejected"].includes(status)) {
          return res.status(400).json({ message: "Invalid status value. Must be 'Approved' or 'Rejected'." });
      }

      const vehicle = await Vehicle.findById(req.params.vehicleId).populate("addedBy", "email name");
      if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });

      vehicle.status = status;
      vehicle.availability = status === "Approved";
      await vehicle.save();

      // Send Email Notification
      await sendApprovalEmail(vehicle.addedBy.email, vehicle.name, status, reason);

      res.status(200).json({ message: `Vehicle has been ${status}.` });
  } catch (error) {
    console.log(error);
      res.status(500).json({ message: "Internal Server Error!" });
  }
});

//sending approval/rejection emails done
const sendApprovalEmail = async (email, vehicleName, status, reason = "") => {
  let transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      service: process.env.SMTP_SERVICE,
      auth: { user: process.env.SMTP_EMAIL, pass: process.env.SMTP_PASSWORD },
  });

  let subject = `Vehicle ${status} Notification`;
  let message = status === "Approved"
      ? `Your vehicle "<b>${vehicleName}</b>" has been approved and is now available for rental.`
      : `Your vehicle "<b>${vehicleName}</b>" has been rejected. Reason: ${reason}.`;

  let htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
          <h2 style="color: #007bff; text-align: center;">Vehicle Approval Update</h2>
          <p style="font-size: 16px;">Hello,</p>
          <p style="font-size: 16px;">${message}</p>
          <p style="font-size: 14px; color: #555;">Vehicle Name: <b>${vehicleName}</b></p>
          <p style="font-size: 14px; color: #555;">Status: <b style="color: ${status === "Approved" ? "green" : "red"};">${status.toUpperCase()}</b></p>
          <p>Thank you for using our service!</p>
      </div>
  `;

  await transporter.sendMail({ from: process.env.SMTP_EMAIL, to:email, subject, html: htmlContent });
};

 //get Vehicles by user done
 router.get("/get-user-vehicles", authenticateToken, async (req, res) => {
  try {
      let filter = req.user.role === "admin" ? {} : { addedBy: req.user.id };
      const vehicles = await Vehicle.find(filter).sort({ createdAt: -1 });
      res.status(200).json({ data: vehicles });
  } catch (error) {
      res.status(500).json({ message: "Internal Server Error!", error: error.message });
  }
});

//Delete Vehicle done
router.delete('/delete-vehicle/:vehicleId', authenticateToken, authorizeRole(["driver","admin"]), async (req, res) => {
  try {
      const { vehicleId } = req.params;
      const vehicle = await Vehicle.findById(vehicleId);

      if (!vehicle) return res.status(404).json({ message: "Vehicle not found!" });

      if (req.user.role === "driver" && vehicle.addedBy.toString() !== req.user.id) {
          return res.status(403).json({ message: "Unauthorized! You can only delete your own vehicles." });
      }

      await Vehicle.findByIdAndDelete(vehicleId);
      res.status(200).json({ message: "Vehicle deleted successfully!" });
  } catch (error) {
      res.status(500).json({ message: "Internal Server Error!" });
  }
});


const getVehicleModelById = async (vehicleid) => {
  const models = [Vehicle,Car, Bike, Truck, Bus];
  for (const model of models) {
      const vehicle = await model.findById(vehicleid);
      if (vehicle) return { model, vehicle };
  }
  return null;
};

// Update vehicle done
router.put('/update-vehicle', authenticateToken, authorizeRole(["driver", "admin"]), async (req, res) => {
  try {
      const { vehicleid } = req.headers;
      if (!vehicleid) return res.status(400).json({ message: "Vehicle ID is required!" });

      const vehicleData = await getVehicleModelById(vehicleid);
      if (!vehicleData) return res.status(404).json({ message: "Vehicle not found!" });

      const { model: VehicleModel, vehicle } = vehicleData;

      // Check if the logged-in user is the owner (driver)
      if (req.user.role === "driver" && vehicle.addedBy.toString() !== req.user.id) {
          return res.status(403).json({ message: "Unauthorized! You can only update your own vehicle." });
      }

      await VehicleModel.findByIdAndUpdate(vehicleid, {
        ...req.body,
        availability: req.body.availability === "true",
    }, { new: true });

      return res.status(200).json({ message: "Vehicle updated successfully!" });
  } catch (error) {
      console.error("Error updating vehicle:", error);
      res.status(500).json({ message: "Internal server error!" });
  }
});


// API to get company data done
router.get("/company-data", authenticateToken, authorizeRole(["admin"]), async (req, res) => {
    try {
      // Fetch basic stats
      const totalRevenue = await Payment.aggregate([
        { $match: { status: "Completed" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]);
  
      const totalBookings = await Booking.countDocuments();
      const pendingPayments = await Payment.countDocuments({ status: "Pending" });
      const registeredUsers = await User.countDocuments();
  
      // Fetch vehicle distribution by type
      const vehicleCounts = {
        cars: await Car.countDocuments(),
        bikes: await Bike.countDocuments(),
        trucks: await Truck.countDocuments(),
        buses: await Bus.countDocuments(),
      };
  
      // Fetch revenue distribution by vehicle type with admin profit calculation
      const revenueByVehicleType = await Payment.aggregate([
        { $match: { status: "Completed" } },
        {
          $group: {
            _id: { $toLower: "$vehicleType" },
            totalRevenue: { $sum: "$amount" },
          },
        },
        {
          $project: {
            _id: 1,
            totalRevenue: 1,
            adminProfit: { $multiply: ["$totalRevenue", 0.3] }, // Admin earns 30%
          },
        },
      ]);

      res.status(200).json({
        status: "Success",
        data: {
          totalRevenue: totalRevenue.length > 0 ? totalRevenue[0].total : 0,
          totalBookings,
          pendingPayments,
          registeredUsers,
          vehicleCounts,
          revenueByVehicleType: revenueByVehicleType.length > 0 ? revenueByVehicleType : [],
        },
      });
  
    } catch (error) {
      console.error("Error fetching company data:", error);
      res.status(500).json({ status: "Error", message: "Internal server error" });
    }
  });

//Get all users done
router.get("/users", authenticateToken,  authorizeRole(["admin"]), async (req, res) => {
  try {
      const users = await User.find({}, "-password").sort({ createdAt: -1 });
      res.status(200).json({ users });
  } catch (error) {
      res.status(500).json({ message: "Internal server error" });
  }
});

//Get a single user by ID done
router.get("/users/:userId", authenticateToken, authorizeRole(["admin","driver"]), async (req, res) => {
  try {
      const user = await User.findById(req.params.userId, "-password").sort({ createdAt: -1 });
      if (!user) {
          return res.status(404).json({ message: "User not found" });
      }
      res.status(200).json({ user });
  } catch (error) {
      res.status(500).json({ message: "Internal server error" });
  }
});

//Delete a user done
router.delete("/delete-user/:userId", authenticateToken,  authorizeRole(["admin"]), async (req, res) => {
  try {
      const deletedUser = await User.findByIdAndDelete(req.params.userId);

      if (!deletedUser) {
          return res.status(404).json({ message: "User not found" });
      }

      res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
      res.status(500).json({ message: "Internal server error" });
  }
});

// Fetch bookings based on role done
router.get("/bookings", authenticateToken, async (req, res) => {
  try {
      let query = {};  // Default query (admin sees all)

      if (req.user.role === "user") {
          query.user = req.user.id;  // User sees only their bookings
      } else if (req.user.role === "driver") {
          // Driver sees bookings for vehicles they added
          const driverVehicles = await Vehicle.find({ owner: req.user.id }).select("_id");
          query.vehicle = { $in: driverVehicles };
      }

      const bookings = await Booking.find(query)
          .populate("user", "username email")
          .populate("vehicle", "name")
          .select("status pickupTime duration totalAmount createdAt")
          .sort({ createdAt: -1 });

      res.status(200).json({ status: "Success", bookings });
  } catch (error) {
      console.error(error);
      res.status(500).json({ status: "Error", message: "Internal server error" });
  }
});

// Update booking status (admin & driver only) done
router.put("/bookings-status", authenticateToken, authorizeRole(["admin", "driver"]), async (req, res) => {
  try {
      const { id, status } = req.body;
      const validStatuses = ["Pending", "Confirmed", "Completed", "Cancelled"];

      if (!validStatuses.includes(status)) {
          return res.status(400).json({ status: "Error", message: "Invalid status value." });
      }

      let booking = await Booking.findById(id).populate("vehicle");

      if (!booking) {
          return res.status(404).json({ status: "Error", message: "Booking not found." });
      }

      // Driver can only update bookings for their own vehicles
      if (req.user.role === "driver" && booking.vehicle.owner.toString() !== req.user.id) {
          return res.status(403).json({ status: "Error", message: "Not authorized to update this booking." });
      }

      booking.status = status;
      await booking.save();

      res.status(200).json({ status: "Success", message: "Booking status updated successfully.", booking });
  } catch (error) {
      console.error("Error updating booking status:", error);
      res.status(500).json({ status: "Error", message: "Internal server error" });
  }
});


// Get Admin Info
router.get("/get-admin-information", authenticateToken, async (req, res) => {
  try {
      const admin = await User.findOne({ _id: req.user.id, role: "admin" }).select("-password");
      if (!admin) {
          return res.status(404).json({ message: "Admin not found" });
      }
      res.status(200).json(admin);
  } catch (error) {
      res.status(500).json({ message: "Internal server error" });
  }
});


module.exports = router;

// Prefill the form with the current vehicle data.