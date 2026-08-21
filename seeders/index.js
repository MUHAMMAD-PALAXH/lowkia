require("dotenv").config();
const mongoose = require("mongoose");

const seedCounters = require("./counterSeeder");
const seedGlobalSuperAdmin = require("./globalSuperAdminSeeder");
const { ensureDefaultPlans } = require("../services/subscriptionService");

const runSeeder = async () => {

    try {

        await mongoose.connect(process.env.MONGO_URL);

        console.log("MongoDB Connected");

        await seedCounters();
        await seedGlobalSuperAdmin();
        const createdPlans = await ensureDefaultPlans();
        console.log(
            "Subscription plans:",
            createdPlans.length
                ? `created ${createdPlans.join(", ")}`
                : "already present"
        );

        console.log("All Seeders Completed");

        process.exit();

    } catch (error) {

        console.error(error);

        process.exit(1);

    }

};

runSeeder();
