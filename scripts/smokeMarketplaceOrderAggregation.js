/**
 * Phase 13 customer order aggregation smoke (no DB).
 * Run: node scripts/smokeMarketplaceOrderAggregation.js
 */
const assert = require("assert");
const {
    formatCustomerOrderItem,
    buildFulfillmentSummary,
} = require("../services/marketplace/marketplaceOrderService");

const item = formatCustomerOrderItem(
    {
        _id: "507f1f77bcf86cd799439011",
        product: { productName: "Phone" },
        quantity: 3,
        lineSubtotal: 300,
        refundedQuantity: 1,
    },
    1
);

assert.strictEqual(item.shippedQuantity, 1);
assert.strictEqual(item.remainingQuantity, 1);

const fulfillment = buildFulfillmentSummary(
    [{ _id: "a", quantity: 2 }, { _id: "b", quantity: 1 }],
    new Map([["a", 2], ["b", 0]])
);
assert.strictEqual(fulfillment.progressPercent, 67);
assert.strictEqual(fulfillment.isFullyShipped, false);

console.log("smokeMarketplaceOrderAggregation: ok");
