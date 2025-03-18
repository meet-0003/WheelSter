const jwt = require("jsonwebtoken");
const User = require("../models/user");


const authenticateToken = (req, res, next) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (token == null) {
        return res.status(401).json({ message: "Authentication token required" });
    }

    jwt.verify(token, "vehiclerent123", (err, user) => {
        if (err) {
            return res.status(403).json({ message: "Token expired. Please sigIn again." });
        }

        if (!user.id) {
            return res.status(403).json({ message: "Invalid token: Missing user ID" });
        }
        req.user = user;
        next();
    });
};

const authorizeRole = (roles) => {
    return async (req, res, next) => {
        try {
            const user = await User.findById(req.user.id).select("role");

            if (!user || !roles.includes(user.role)) {
                return res.status(403).json({ message: "Access Denied." });
            }

            next();
        } catch (error) {
            res.status(500).json({ message: "Internal server error" });
        }
    };
};

module.exports = { authenticateToken , authorizeRole };