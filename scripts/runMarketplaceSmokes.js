/**
 * Run all marketplace smoke scripts (Phases 10–17).
 * Usage: node scripts/runMarketplaceSmokes.js
 */
const { spawnSync } = require("child_process");
const path = require("path");

const scripts = [
    "smokeMarketplaceOrderStatus.js",
    "smokeMarketplaceNotification.js",
    "smokeMarketplaceRefund.js",
    "smokeMarketplaceOrderAggregation.js",
    "smokeCompanyMarketplaceOrder.js",
    "smokePlatformMarketplace.js",
    "smokeMarketplaceSecurity.js",
    "smokeMarketplacePagination.js",
];

const root = path.join(__dirname);
let failed = 0;

for (const script of scripts) {
    const file = path.join(root, script);
    const result = spawnSync(process.execPath, [file], {
        stdio: "inherit",
        env: process.env,
    });
    if (result.status !== 0) {
        failed += 1;
        console.error(`FAILED: ${script}`);
    }
}

if (failed) {
    console.error(`\n${failed} marketplace smoke script(s) failed.`);
    process.exit(1);
}

console.log(`\nAll ${scripts.length} marketplace smoke scripts passed.`);
