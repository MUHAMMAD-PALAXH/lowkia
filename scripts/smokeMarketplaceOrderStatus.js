/**
 * Phase 10 marketplace order status engine smoke (no DB).
 * Run: node scripts/smokeMarketplaceOrderStatus.js
 */
const assert = require("assert");
const {
    deriveMasterOrderStatus,
    assertCompanyTransition,
    COMPANY_ORDER_TRANSITIONS,
} = require("../services/marketplace/marketplaceOrderStatusService");

assert.strictEqual(deriveMasterOrderStatus(["pending", "pending"]), "pending");
assert.strictEqual(
    deriveMasterOrderStatus(["confirmed", "confirmed"]),
    "confirmed"
);
assert.strictEqual(
    deriveMasterOrderStatus(["processing", "confirmed"]),
    "processing"
);
assert.strictEqual(
    deriveMasterOrderStatus(["packed", "processing"]),
    "processing"
);
assert.strictEqual(
    deriveMasterOrderStatus(["partially_shipped", "confirmed"]),
    "partially_shipped"
);
assert.strictEqual(
    deriveMasterOrderStatus(["shipped", "shipped"]),
    "shipped"
);
assert.strictEqual(
    deriveMasterOrderStatus(["delivered", "shipped"]),
    "partially_delivered"
);
assert.strictEqual(
    deriveMasterOrderStatus(["delivered", "delivered"]),
    "delivered"
);
assert.strictEqual(
    deriveMasterOrderStatus(["cancelled", "cancelled"]),
    "cancelled"
);
assert.strictEqual(
    deriveMasterOrderStatus(["cancelled", "confirmed"]),
    "partially_cancelled"
);
assert.strictEqual(
    deriveMasterOrderStatus(["refunded", "confirmed"]),
    "partially_refunded"
);

assert.strictEqual(assertCompanyTransition("confirmed", "processing"), "processing");
assert.throws(() => assertCompanyTransition("pending", "shipped"));
assert.ok(COMPANY_ORDER_TRANSITIONS.delivered.length === 0);

console.log("smokeMarketplaceOrderStatus: ok");
