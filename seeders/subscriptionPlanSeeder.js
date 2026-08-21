/**
 * Seed default SaaS subscription plans.
 * Run: node seeders/subscriptionPlanSeeder.js
 * Or via: npm run seed:plans
 */
require("dotenv").config();
const mongoose = require("mongoose");
const { ensureDefaultPlans, listPlans } = require("../services/subscriptionService");

const run = async () => {
    await mongoose.connect(process.env.MONGO_URL);
    const created = await ensureDefaultPlans();
    const plans = await listPlans({});
    console.log("Created:", created.length ? created.join(", ") : "(none new)");
    console.log(
        "Plans:",
        plans.map((p) => `${p.planCode} $${(p.priceMinor / 100).toFixed(2)}/${p.billingInterval}`).join(" | ")
    );
    await mongoose.disconnect();
};

run().catch(async (e) => {
    console.error(e);
    try {
        await mongoose.disconnect();
    } catch (_) {}
    process.exit(1);
});
