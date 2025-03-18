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

// Reset Password
router.post("/reset-password", async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;
        const user = await User.findOne({ email });

        if (!user || user.resetOTP !== otp || user.otpExpires < Date.now()) {
            return res.status(400).json({ message: "Invalid OTP or expired." });
        }
        user.password = await bcrypt.hash(newPassword, 10);
        user.resetOTP = undefined;
        user.otpExpires = undefined;
        await user.save();

        res.status(200).json({ message: "Password reset successful." });
    } catch (error) {
        res.status(500).json({ message: "Internal server error" });
    }
});

// update to driver done
const updateUserRoleToDriver = async (req, res) => {
    try {
        const { userId, driverInfo } = req.body;

        // Ensure driverInfo object exists
        if (!driverInfo) {
            return res.status(400).json({ message: "Driver info is required" });
        }

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            {
                role: "driver",
                driverInfo: driverInfo, // Add driver details
            },
            { new: true, runValidators: true } // Return updated document
        );

        if (!updatedUser) {
            return res.status(404).json({ message: "User not found" });
        }

        res.status(200).json(updatedUser);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
router.put("/update-to-driver", authenticateToken, async (req, res) => {
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
                $set: { driverInfo: driverInfo }
            },
            { new: true, runValidators: true } // Ensures we return the updated user
        );

        if (!updatedUser) {
            return res.status(404).json({ message: "User not found" });
        }

        res.status(200).json({ message: "User updated to driver successfully", user: updatedUser });
    } catch (error) {
        // Handle duplicate license number error
        if (error.code === 11000 && error.keyPattern["driverInfo.licenseNumber"]) {
            return res.status(400).json({ message: "License number already exists" });
        }

        res.status(500).json({ message: "Internal server error", error });
    }
});

// Fetch driver information
router.get("/driver-info/:userId", authenticateToken,authorizeRole(["driver"]), async (req, res) => {
    try {
        const { userId } = req.params;

        const driver = await User.findById(userId).select("role username email phnumber avatar driverInfo ");

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

router.get('/driver-bookings', authenticateToken, authorizeRole(["driver"]), async (req, res) => {
    try {
        const bookings = await Booking.find({ driver: req.user.id })
            .populate('user', 'username email')  // 'name' instead of 'username'
            .populate('vehicle', 'name');

        res.json(bookings.map(booking => ({
            _id: booking._id,
            user: { id: booking.user._id, username: booking.user.username }, // Ensure correct key
            vehicle: { name: booking.vehicle.name },
            pickupTime: booking.pickupTime,
            duration: `${booking.duration} days`,
            totalAmount: `$${booking.totalAmount}`,
            status: booking.status,
            canAccept: booking.withDriver
        })));
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

router.put('/bookings/:id/accept', authenticateToken, authorizeRole(["driver"]), async (req, res) => {
    try {
        const booking = await Booking.findById(req.params.id);
        
        if (!booking) return res.status(404).json({ message: 'Booking not found' });

        // Ensure only the assigned driver can accept
        if (booking.driver.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Unauthorized' });
        }

        // Ensure booking is "Pending"
        if (booking.status !== "Pending") {
            return res.status(400).json({ message: "This booking is already processed" });
        }

        // Ensure it is a 'With Driver' booking
        if (!booking.withDriver) {
            return res.status(400).json({ message: 'Cannot accept self-drive bookings' });
        }

        // Manually update status
        booking.status = 'Accepted';
        await booking.save();
        
        res.json({ message: 'Booking accepted successfully', booking });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});






module.exports = {router,updateUserRoleToDriver};

