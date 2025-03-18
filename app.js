const express = require('express');
const app = express();
const cors = require("cors");
require('dotenv').config();
require("./conn/conn");
const User = require("./routes/user").router;
const Vehicles = require("./routes/vehicle");
const Admin = require("./routes/admin");
const Booking = require("./routes/booking");
const Review = require('./routes/review');
const path = require("path");


app.use(cors());
app.use(express.json());

app.use("/api/v2",User);
app.use("/api/v2",Vehicles);
app.use("/api/v2",Admin);
app.use("/api/v2",Booking);
app.use("/api/v2",Review);

app.use("/uploads", express.static(path.join(__dirname, "uploads")));


//port
app.listen(process.env.PORT, () => {
    console.log(`server here at port ${process.env.PORT}`);
});