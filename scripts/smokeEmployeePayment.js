/**
 * Phase 7 employee payment helpers smoke (no DB).
 * Run: node scripts/smokeEmployeePayment.js
 */
const assert = require("assert");
const { mapLegacyMethod } = require("../services/employeePaymentService");
const {
    assertMethodProviderCombo,
} = require("../services/paymentFoundationService");
const smPay = require("../services/paymentStateMachine");
const smRun = require("../services/payrollRunStateMachine");
const { assertNotOverpaying, toMinor } = require("../utils/money");

assert.strictEqual(mapLegacyMethod("Cash"), "CASH");
assert.strictEqual(mapLegacyMethod("Bank Transfer"), "BANK_TRANSFER");
assert.strictEqual(mapLegacyMethod("Cheque"), "CHECK");

assert.deepStrictEqual(assertMethodProviderCombo("ACH", "BANK"), {
    paymentMethod: "ACH",
    paymentProvider: "BANK",
});

// Payment SM for employee flows
assert.strictEqual(
    smPay.assertTransition("pendingApproval", "approved"),
    "approved"
);
assert.strictEqual(smPay.assertTransition("approved", "processing"), "processing");
assert.strictEqual(smPay.assertTransition("processing", "paid"), "paid");
assert.strictEqual(smPay.assertTransition("paid", "reversed"), "reversed");

// Payroll run: locked → paid → locked (reverse unlock)
assert.strictEqual(smRun.assertTransition("locked", "paid"), "paid");
assert.strictEqual(smRun.assertTransition("paid", "locked"), "locked");

// Salary / advance overpay hard reject
const net = toMinor(2500);
assert.doesNotThrow(() => assertNotOverpaying(net, net, "Salary payment"));
assert.throws(
    () => assertNotOverpaying(net + 1, net, "Salary payment"),
    /exceeds outstanding/
);

const approved = toMinor(800);
assert.doesNotThrow(() =>
    assertNotOverpaying(approved, approved, "Advance disbursement")
);
assert.throws(
    () => assertNotOverpaying(approved + 1, approved, "Advance disbursement"),
    /exceeds outstanding/
);

console.log("✅ Phase 7 employee payment helper smoke passed.");
