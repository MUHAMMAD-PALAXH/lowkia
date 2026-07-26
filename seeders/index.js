require("dotenv").config();
const mongoose = require("mongoose");

const seedCounters = require("./counterSeeder");

const runSeeder = async () => {

    try {

        await mongoose.connect(process.env.MONGO_URL);

        console.log("MongoDB Connected");

        await seedCounters();

        console.log("All Seeders Completed");

        process.exit();

    } catch (error) {

        console.error(error);

        process.exit(1);

    }

};

runSeeder();