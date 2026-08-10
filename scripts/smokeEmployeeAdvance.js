/**
 * Phase 6 employee advance state machine + overpay smoke (no DB).
 * Run: node scripts/smokeEmployeeAdvance.js
 */
const assert = require("assert");
const sm = require("../services/employeeAdvanceStateMachine");
const { assertNotOverpaying, toMinor } = require("../utils/money");

assert.strictEqual(
    sm.assertTransition("draft", "pendingApproval"),
    "pendingApproval"
);
assert.strictEqual(
    sm.assertTransition("pendingApproval", "approved"),
    "approved"
);
assert.strictEqual(sm.assertTransition("approved", "disbursed"), "disbursed");
assert.strictEqual(
    sm.assertTransition("disbursed", "recovering"),
    "recovering"
);
assert.strictEqual(sm.assertTransition("recovering", "settled"), "settled");
assert.strictEqual(sm.assertTransition("approved", "reversed"), "reversed");
assert.strictEqual(sm.assertTransition("disbursed", "reversed"), "reversed");

assert.throws(() => sm.assertTransition("settled", "disbursed"));
assert.throws(() => sm.assertTransition("rejected", "approved"));
assert.throws(() => sm.assertTransition("disbursed", "cancelled"));

assert.strictEqual(sm.isEditable("draft"), true);
assert.strictEqual(sm.isEditable("pendingApproval"), true);
assert.strictEqual(sm.isEditable("approved"), false);
assert.strictEqual(sm.isTerminal("settled"), true);
assert.strictEqual(sm.isTerminal("rejected"), true);

// Overpay hard reject (recovery)
const outstanding = toMinor(500);
assert.doesNotThrow(() =>
    assertNotOverpaying(toMinor(500), outstanding, "Recovery")
);
assert.throws(
    () => assertNotOverpaying(toMinor(500.01), outstanding, "Recovery"),
    /exceeds outstanding/
);

// Partial recovery math (document-level)
let out = toMinor(1000);
const recover1 = toMinor(400);
assertNotOverpaying(recover1, out, "Recovery");
out -= recover1;
assert.strictEqual(out, toMinor(600));
const recover2 = toMinor(600);
assertNotOverpaying(recover2, out, "Recovery");
out -= recover2;
assert.strictEqual(out, 0);

console.log("✅ Phase 6 employee advance smoke passed.");
