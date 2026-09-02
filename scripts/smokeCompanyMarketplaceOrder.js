/**
 * Phase 14 company marketplace order helpers smoke (no DB).
 * Run: node scripts/smokeCompanyMarketplaceOrder.js
 */
const assert = require("assert");

const buildFulfillment = (items, shippedMap) => {
    let totalUnits = 0;
    let shippedUnits = 0;
    for (const item of items) {
        const qty = Number(item.quantity) || 0;
        const shipped = Math.min(shippedMap.get(String(item._id)) || 0, qty);
        totalUnits += qty;
        shippedUnits += shipped;
    }
    return {
        totalUnits,
        shippedUnits,
        remainingUnits: Math.max(0, totalUnits - shippedUnits),
        progressPercent:
            totalUnits > 0 ? Math.round((shippedUnits / totalUnits) * 100) : 0,
    };
};

const fulfillment = buildFulfillment(
    [{ _id: "a", quantity: 4 }, { _id: "b", quantity: 2 }],
    new Map([["a", 3]])
);
assert.strictEqual(fulfillment.progressPercent, 50);
assert.strictEqual(fulfillment.remainingUnits, 3);

console.log("smokeCompanyMarketplaceOrder: ok");
