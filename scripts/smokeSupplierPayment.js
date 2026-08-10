/**
 * Phase 3 supplier payment helper smoke (no DB).
 * Run: node scripts/smokeSupplierPayment.js
 */
const assert = require("assert");
const { mapLegacyMethod } = require("../services/supplierPaymentService");
const {
    assertMethodProviderCombo,
} = require("../services/paymentFoundationService");
const sm = require("../services/paymentStateMachine");

assert.strictEqual(mapLegacyMethod("Cash"), "CASH");
assert.strictEqual(mapLegacyMethod("Bank Transfer"), "BANK_TRANSFER");
assert.strictEqual(mapLegacyMethod("Cheque"), "CHECK");
assert.strictEqual(mapLegacyMethod("ACH"), "ACH");
assert.strictEqual(mapLegacyMethod("Apple Pay"), "APPLE_PAY");

assert.deepStrictEqual(assertMethodProviderCombo("BANK_TRANSFER", "NONE"), {
    paymentMethod: "BANK_TRANSFER",
    paymentProvider: "NONE",
});

assert.strictEqual(
    sm.assertTransition("pendingApproval", "approved"),
    "approved"
);
assert.strictEqual(sm.assertTransition("approved", "processing"), "processing");
assert.strictEqual(sm.assertTransition("processing", "paid"), "paid");
assert.strictEqual(sm.assertTransition("paid", "reversed"), "reversed");
assert.throws(() => sm.assertTransition("paid", "cancelled"));

console.log("✅ Phase 3 supplier payment helper smoke passed.");
