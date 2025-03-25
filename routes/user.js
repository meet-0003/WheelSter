const router = require("express").Router();
const User = require("../models/user");
const Booking = require("../models/booking");
const Feedback = require("../models/feedback");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const {authenticateToken,authorizeRole} = require("./userAuth");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const nodemailer = require("nodemailer");
const otpGenerator = require("otp-generator");
const axios = require("axios");



const uploadDir = path.join(__dirname, "../uploads/");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "uploads/"); 
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    },
});

const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith("image/")) {
            cb(null, true);
        } else {
            cb(new Error("Only image files are allowed!"), false);
        }
    },
});

// Profile photo upload route done
router.post("/upload-profile-photo", authenticateToken, upload.single("avatar"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: "No file uploaded" });
        }

        const imageUrl = `/uploads/${req.file.filename}`; // Local file URL

        await User.findByIdAndUpdate(req.user.id, { avatar: imageUrl });

        res.status(200).json({ message: "Profile photo uploaded successfully", avatar: imageUrl });
    } catch (error) {
        res.status(500).json({ message: "Internal server error" });
    }
});


// sign up done
router.post('/sign-up', upload.single("avatar"), async (req, res) => {
    try {
        
        const {username, email, password, phnumber} = req.body;
        
        if (!username || !email || !password || !phnumber) {
            return res.status(400).json({ message: "All fields are required." });
        }
        
        if (username.length < 4) {
            return res
            .status(400).json({ message: "Username should be grater than 3 characters" });
        }
        
        const existingUsername = await User.findOne({ username: username });
        if (existingUsername) {
            return res
            .status(400).json({ message: "Username already exists" });
        }
        
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ message: "Invalid email format." });
        }
        
        const existingEmail = await User.findOne({ email });
        if (existingEmail) {
            return res.status(400).json({ message: "Email already exists." });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ message: "Password should be grater than 5 characters" });
        }
        
        const phoneRegex = /^\d{10,15}$/;
        if (!phoneRegex.test(phnumber)) {
            return res.status(400).json({ message: "Invalid phone number format." });
        }
        
        const hashPass = await bcrypt.hash(password, 10);
        const avatar = `/uploads/${req.file.filename}`;
        
        const newUser = new User({username: username, email: email, password: hashPass, phnumber: phnumber,avatar:avatar});
        await newUser.save();
        
        return res.status(200).json({ message: "SignUp successfully" });
        
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Internal srever error!" });
    }
});

// sign in done
router.post('/sign-in', async (req, res) => {
    try {
        const { username, password} = req.body;
        
        const existingUser = await User.findOne({ username });
        if (!existingUser) {
            return res
           .status(400).json({message: "Invalid credentials"} );
        }

        await bcrypt.compare(password, existingUser.password, (err,data) => {
            if(data){
                const token = jwt.sign(
                    {
                        id: existingUser._id, 
                        username: existingUser.username,
                        role: existingUser.role
                    },
                    "vehiclerent123",
                    { expiresIn: "30d" }
                );
                res.status(200).json({id : existingUser._id, token: token,role: existingUser.role,avatar: existingUser.avatar});
            }
            else{
                res
               .status(400).json({message: "Invalid credentials"} );
            }
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({message:"Internal srever error!!!"});
    } 
});

router.get("/get-user-information", authenticateToken, async (req, res) => {
    try {
        // Find user and include driverInfo explicitly
        const user = await User.findById(req.user.id)
            .select("-password") // Exclude password field
            .sort({ createdAt: -1 })
            .lean(); // Convert to a plain JavaScript object

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        if (user.role === "driver") {
            const driver = await User.findById(req.user.id).select("driverInfo").lean();
            user.driverInfo = driver.driverInfo || {}; // Assign driverInfo if available
        }

        res.status(200).json(user);
    } catch (error) {
        res.status(500).json({ message: "Internal server error" });
    }
});


// update user info 
router.put("/update-profile", authenticateToken, upload.single("avatar"), async (req, res) => {
    try {
        const userData = JSON.parse(req.body.data); 

        const { username, email, phnumber, address, licenseNumber, experience, ability, age, gender, dob, licenseExpiry } = userData;

        const updates = { 
            username, 
            email, 
            phnumber, 
            "driverInfo.address": address, 
            "driverInfo.licenseNumber": licenseNumber, 
            "driverInfo.experience": experience, 
            "driverInfo.ability": ability, 
            "driverInfo.age": age, 
            "driverInfo.gender": gender, 
            "driverInfo.dob": dob, 
            "driverInfo.licenseExpiry": licenseExpiry 
        };

        if (req.file) {
            updates.avatar = `/uploads/${req.file.filename}`;
        }

        const updatedUser = await User.findByIdAndUpdate(req.user.id, updates, { new: true });

        if (!updatedUser) {
            return res.status(404).json({ message: "User not found" });
        }

        return res.status(200).json({ message: "Profile updated successfully", user: updatedUser });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Internal server error!" });
    }
});


// Forgot Password (Generate OTP)
router.post("/forgot-password", async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });

        if (!user) {
            return res.status(400).json({ message: "User not found." });
        }

        const otp = otpGenerator.generate(6, { 
            digits: true, 
            lowerCaseAlphabets: false, 
            upperCaseAlphabets: false, 
            specialChars: false 
        });       
        
        user.resetOTP = otp;
        user.otpExpires = Date.now() + 3 * 60 * 1000;
        await user.save();

        let transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT,
            service: process.env.SMTP_SERVICE,
            auth: { user: process.env.SMTP_EMAIL,
                pass: process.env.SMTP_PASSWORD },
        });

        await transporter.sendMail({
            to: user.email,
            subject: "Password Reset OTP",
            text: `Your OTP is ${otp}`,
        });

        res.status(200).json({ message: "OTP sent to email." });
    } catch (error) {
        res.status(500).json({ message: "Internal server error" });
    }
});

// Reset Password (Using OTP)
router.post("/reset-password", async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;

        const user = await User.findOne({ email });

        if (!user) {
            return res.status(400).json({ message: "User not found." });
        }

        if (!user.resetOTP || user.otpExpires < Date.now()) {
            return res.status(400).json({ message: "Invalid or expired OTP." });
        }

        if (user.resetOTP !== otp) {
            return res.status(400).json({ message: "Incorrect OTP." });
        }

        // Hash the new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        user.password = hashedPassword;
        user.resetOTP = null;
        user.otpExpires = null;
        await user.save();

        res.status(200).json({ message: "Password reset successful." });
    } catch (error) {
        console.error("Error resetting password:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

const updateUserRoleToDriver = async (req, res) => {
  try {
    const { userId, driverInfo } = req.body;

    if (!driverInfo) {
      return res.status(400).json({ message: "Driver info is required" });
    }

    let user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.driverInfo = driverInfo;
    user.role = "driver";
    await user.save(); // ✅ Ensure user is saved

    res.status(200).json({ message: "User updated to driver successfully", user});
  } catch (error) {
    console.error("Update Error:", error);
    res.status(500).json({ message: error.message });
  }
};

router.put("/update-to-driver", authenticateToken, async (req, res) => {
    console.log("🔵 Received request to update user to driver:", req.body);
    console.log("🔹 Authenticated User:", req.user); 


    try {
        const { driverInfo } = req.body;

        if (!driverInfo) {
            return res.status(400).json({ message: "Driver info is required" });
        }

        // Update user role and driver info
        const updatedUser = await User.findByIdAndUpdate(
            req.user.id,
            {
                role: "driver",
                driverInfo
                //$set: { driverInfo: driverInfo }
            },
            { new: true, runValidators: true } // Ensures we return the updated user
        );

        if (!updatedUser) {
            return res.status(404).json({ message: "User not found" });
        }


           // ✅ Generate new token after role update
           const token = jwt.sign(
            { id: updatedUser._id, username: updatedUser.username, role: updatedUser.role },
            "vehiclerent123",
            { expiresIn: "30d" }
        );
        console.log("✅ Token generated:", token);
        console.log("🚀 Sending API Response:", { user: updatedUser, token });

        res.status(200).json({ 
            message: "User updated to driver successfully", 
            user: updatedUser, 
            token 
        });
        console.log("✅ Token generated:", token);
    } catch (error) {
        // Handle duplicate license number error
        if (error.code === 11000 && error.keyPattern["driverInfo.licenseNumber"]) {
            return res.status(400).json({ message: "License number already exists" });
        }
        console.log(error);
        res.status(500).json({ message: "Internal server error", error });
    }
});


// Fetch driver information
router.get("/driver-info/:userId", authenticateToken,authorizeRole(["driver"]), async (req, res) => {
    try {
        const { userId } = req.params;

        const driver = await User.findById(userId).select("role username email phnumber avatar driverInfo ").sort({ createdAt: -1 });

        if (!driver) {
            return res.status(404).json({ message: "Driver not found" });
        }

        if (driver.role !== "driver") {
            return res.status(400).json({ message: "User is not a driver" });
        }
        if (!driver.driverInfo) {
            driver.driverInfo = {}; // Ensure it's always defined
          }

        const {userDetails, ...driverInfo } = driver.toObject();

        res.status(200).json({  userDetails,driverInfo });
    } catch (error) {
        console.log(error)
        res.status(500).json({ message: "Internal server error", error });
    }
});

router.get('/drivers', authenticateToken, authorizeRole(["admin"]), async (req, res) => {
    try {
        const drivers = await User.find({ role: "driver" }).select("_id username");
        res.json({ drivers });
    } catch (error) {
        console.error("Error fetching drivers:", error);
        res.status(500).json({ message: "Server error" });
    }
});

router.get("/driver/:driverId", async (req, res) => {
    try {
      const driver = req.params.driverId;
  
      const bookings = await Booking.find()
        .populate({
          path: "vehicle",
          select: "name addedBy", 
        })
        .populate({
          path: "user",
          select: "username",
        })
        .populate({
            path: "driver",
            select: "id",
          })
        .select("startDate endDate pickupTime address status paymentStatus driverStatus") 
        .sort({ createdAt: -1 })
        .lean();
  
      // Ensure vehicle has an addedBy before filtering
      const driverBookings = bookings
      .filter((booking) => booking?.vehicle?.addedBy?.toString() === driver)
      .map((booking) => ({
          _id: booking._id,
          username: booking.user?.username || "Unknown",
          vehicleName: booking.vehicle?.name || "Unknown",
          startDate: booking.startDate,
          endDate: booking.endDate,
          pickupTime: booking.pickupTime,
          address: booking.address,
          status: booking.status,
          paymentStatus: booking.paymentStatus,
          withDriver: true,
          driverStatus: booking.driverStatus || "pending", // Ensure this is included
        }));
  
      res.json(driverBookings);
    } catch (error) {
      console.error("Error fetching bookings:", error);
      res.status(500).json({ message: "Error fetching bookings" });
    }
  });
  
  // accept or reject the booking
  router.put("/bookings/:bookingId", authenticateToken, authorizeRole(["driver"]), async (req, res) => {
    try {
        const { action } = req.body; // 'accept' or 'reject'
        const driverId = req.user.id;
        const { bookingId } = req.params;

        const booking = await Booking.findById(bookingId);
        if (!booking) return res.status(404).json({ message: "Booking not found" });

        if (booking.driver.toString() !== driverId) {
            return res.status(403).json({ message: "Unauthorized action" });
        }

        if (action === "accept" || action === "accepted") {
            booking.driverStatus = "accepted";
        } else if (action === "reject" || action === "rejected") {
            booking.driverStatus = "declined";
        } else {
            return res.status(400).json({ message: "Invalid action" });
        }
        

        await booking.save();
        res.json({ message: `Booking ${action}ed successfully` });

    } catch (error) {
        console.error("Error updating booking:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

router.put("/reassign-driver/:bookingId", authenticateToken, authorizeRole(["admin"]), async (req, res) => {
    try {
        const { newDriverId } = req.body;
        const adminId = req.user.id;
        const { bookingId } = req.params;

        const booking = await Booking.findById(bookingId);
        if (!booking) return res.status(404).json({ message: "Booking not found" });

        if (booking.driverStatus !== "declined" && booking.driverStatus !== "pending") {
            return res.status(400).json({ message: "Cannot reassign driver unless the previous driver declined or has not responded." });
        }
        

        // Track reassignment history
        booking.reassignedDrivers.push({
            driver: booking.driver,
            reassignedBy: adminId
        });

        // Assign new driver
        booking.driver = newDriverId;
        booking.driverStatus = "pending";

        await booking.save();
        res.json({ message: "Driver reassigned successfully" });

    } catch (error) {
        console.error("Error reassigning driver:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});




module.exports = {router,updateUserRoleToDriver};

