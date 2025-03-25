const express = require("express");
const router = express.Router();
const mongoose = require("mongoose"); 
const Review = require("../models/review");
const { authenticateToken , authorizeRole } = require("./userAuth");
const User = require("../models/user");
const Vehicle = require("../models/vehicle");


 
//Add a review
router.post("/:vehicleId", authenticateToken, async (req, res) => {
    try {
      const { rating, comment } = req.body;
      const userId = req.user.id;
      const { vehicleId } = req.params;
  
      const review = new Review({ user: userId, vehicle: vehicleId, rating, comment });
      await review.save();
  
      res.status(201).json({ message: "Review submitted successfully!", review });
    } catch (error) {
      res.status(500).json({ error: "Server error" });
    }
  });
  
  //Fetch reviews for a specific vehicle
router.get("/:vehicleId", async (req, res) => {
    try {
      const { vehicleId } = req.params;
      const objectIdVehicleId = new mongoose.Types.ObjectId(vehicleId);
      const reviews = await Review.find({ vehicle: objectIdVehicleId }).populate("user", "username");
      if (reviews.length === 0) {
        return res.status(404).json({ message: "No reviews found for this vehicle" });
    }
      res.json(reviews);
    } catch (error) {
      res.status(500).json({ error: "Server error" });
    }
  });

  // extra avg of reviews for a specific vehicle
  router.get("/average/:vehicleId", async (req, res) => {
    try {
      const { vehicleId } = req.params;
      const reviews = await Review.find({ vehicle: vehicleId });
  
      if (reviews.length === 0) return res.json({ averageRating: 0 });
  
      const avgRating = reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length;
      res.json({ averageRating: avgRating.toFixed(1) });
    } catch (error) {
      res.status(500).json({ error: "Server error" });
    }
  });

  // Add a new service review
router.post("/add-service-reviews", authenticateToken,authorizeRole(["user","driver"]), async (req, res) => {
  try {
    const { comment } = req.body;
    const userId = req.user.id;

    const review = new Review({ user: userId, comment });
    await review.save();

    res.status(201).json({ message: "Review submitted successfully!", review });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Server error" });
  }
});

  // Fetch all service reviews with user details
router.get("/service-reviews", async (req, res) => {
  try {
    const reviews = await Review.find().populate("user", "username"); // Fetch username & avatar
    res.json(reviews);
  } catch (error) {
    console.log(error);

    res.status(500).json({ error: "Server error" });
  }
});

  module.exports = router;
