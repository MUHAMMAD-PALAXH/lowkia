/**
 * Sync marketplace MongoDB indexes (safe to run on deploy).
 * Usage: node scripts/ensureMarketplaceIndexes.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const models = require("../model/marketplace");

async function main() {
    if (!process.env.MONGO_URL) {
        console.error("MONGO_URL is required.");
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URL);

    for (const [name, model] of Object.entries(models)) {
        if (!model?.syncIndexes) continue;
        const result = await model.syncIndexes();
        const changed = Object.keys(result || {}).length;
        console.log(`${name}: synced${changed ? ` (${changed} change(s))` : ""}`);
    }

    await mongoose.disconnect();
    console.log("ensureMarketplaceIndexes: ok");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
