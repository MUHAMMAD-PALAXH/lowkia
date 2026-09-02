/**
 * Phase 16 marketplace security helpers smoke (no DB).
 * Run: node scripts/smokeMarketplaceSecurity.js
 */
const assert = require("assert");
const {
    buildWebhookEventKey,
    signPayload,
} = require("../services/marketplace/marketplaceSecurityService");

const key = buildWebhookEventKey("stripe", {
    paymentId: "abc",
    providerTransactionId: "txn_1",
    status: "successful",
});
assert.ok(key.includes("stripe"));
assert.ok(key.includes("successful"));

const signature = signPayload('{"status":"successful"}', "test-secret");
assert.strictEqual(signature.length, 64);

console.log("smokeMarketplaceSecurity: ok");
