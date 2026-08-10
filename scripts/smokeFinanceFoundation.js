/**
 * Offline smoke checks for Phase 1 finance foundation (no DB required).
 * Run: node scripts/smokeFinanceFoundation.js
 */
const assert = require("assert");
const money = require("../utils/money");
const sm = require("../services/paymentStateMachine");
const foundation = require("../services/paymentFoundationService");
const { getPaymentProvider } = require("../services/paymentProviders");

// Money
assert.strictEqual(money.toMinor(100.25), 10025);
assert.strictEqual(money.toMajor(10025), 100.25);
assert.strictEqual(money.toMinor(0.1 + 0.2), 30); // avoid 0.30000000004 as cents
assert.throws(() => money.assertNotOverpaying(12000, 10000), /exceeds outstanding/);
assert.doesNotThrow(() => money.assertNotOverpaying(10000, 10000));

// State machine
assert.strictEqual(sm.assertTransition("draft", "pendingApproval"), "pendingApproval");
assert.strictEqual(sm.assertTransition("approved", "paid"), "paid");
assert.throws(() => sm.assertTransition("paid", "draft"), /Invalid payment status transition/);
assert.throws(() => sm.assertTransition("cancelled", "approved"), /Invalid payment status transition/);

// Method / provider
assert.strictEqual(foundation.assertPaymentMethod("check"), "CHECK");
assert.strictEqual(foundation.assertPaymentMethod("Cheque"), "CHECK");
assert.deepStrictEqual(
    foundation.assertMethodProviderCombo("CARD", "STRIPE"),
    { paymentMethod: "CARD", paymentProvider: "STRIPE" }
);
assert.throws(
    () => foundation.assertMethodProviderCombo("APPLE_PAY", "NONE"),
    /requires a payment provider/
);

const amount = foundation.resolveAmountMinor({ amount: 12.5 }, "USD");
assert.strictEqual(amount.amountMinor, 1250);

const none = getPaymentProvider("NONE");
assert.strictEqual(none.name, "NONE");

console.log("✅ Phase 1 finance foundation smoke checks passed.");
