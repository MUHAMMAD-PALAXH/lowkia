/**
 * Phase 12 marketplace refund helpers smoke (no DB).
 * Run: node scripts/smokeMarketplaceRefund.js
 */
const assert = require("assert");

const roundMoney = (value) =>
    Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const computeItemRefundAmount = (lineSubtotal, quantity, refundQty) => {
    const unit = Number(lineSubtotal) / Number(quantity);
    return roundMoney(unit * refundQty);
};

assert.strictEqual(computeItemRefundAmount(1000, 2, 1), 500);
assert.strictEqual(computeItemRefundAmount(99, 3, 1), 33);
assert.strictEqual(roundMoney(10.005), 10.01);

console.log("smokeMarketplaceRefund: ok");
