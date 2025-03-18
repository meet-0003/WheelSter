const mongoose = require("mongoose");

const options = { discriminatorKey: "vehicleType", timestamps: true };

const vehicle = new mongoose.Schema(
  {
    url: { type: String, required: true },
    name: { type: String, required: true },
    rent: { type: String, required: true },
    registrationNumber: { type: String, required: true, unique: true },
    availability: { type: Boolean, default: false },
    rating: { type: String, required: true },
    desc: { type: String, required: true },
    gear: { type: String, required: true },
    seat: { type: String, required: true },
    pump: { type: String, required: true },
    engine: { type: String, required: true },
    tire: { type: String, required: true },
    status: { type: String, enum: ["Pending", "Approved", "Rejected"], default: "Pending" }, 
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true }, 
  },
  options
);

const Vehicle = mongoose.model("vehicle", vehicle);

// Car Schema
const Car = Vehicle.discriminator(
  "Car",
  new mongoose.Schema({
    ac: { type: String, required: true },
    safetyfeatures: { type: [String] },
    bodytype: { type: String }, 
  })
);

// Bike Schema
const Bike = Vehicle.discriminator(
  "Bike",
  new mongoose.Schema({
    bodytype: { type: String }, 
    helmetIncluded: { type: Boolean, default: false },
  })
);

// Truck Schema
const Truck = Vehicle.discriminator(
  "Truck",
  new mongoose.Schema({
    payload: { type: String, required: true }, 
    bodytype: { type: String }, 
    trucktype: { type: String }, 
  })
);

// Bus Schema
const Bus = Vehicle.discriminator(
  "Bus",
  new mongoose.Schema({
    ac: { type: String, required: true },
    bustype : { type: String, required: true },
    seatingarrangement : { type: String, required: true },
    amenities: { type: [String] },
  })
);

module.exports = { Vehicle, Car, Bike, Truck, Bus };
