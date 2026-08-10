/**
 * Smoke: payment security / correctness helpers (Phase payment hardening).
 * Offline — no DB / Stripe network required.
 */
const assert = require("assert");
const {
    assertNotOverpaying,
    toMinor,
    addMinor,
} = require("../utils/money");
const {
    assertTransition,
    canTransition,
} = require("../services/paymentStateMachine");

function section(name) {
    console.log(`\n— ${name}`);
}

section("Overpay hard-reject");
assert.throws(
    () => assertNotOverpaying(10100, 10000, "Customer payment"),
    /overpay/i
);
assert.doesNotThrow(() => assertNotOverpaying(10000, 10000, "Customer payment"));

section("Advance room ceiling (exposure)");
const commitment = toMinor(1000);
const received = toMinor(400);
const advancePaid = toMinor(200);
const advanceApplied = Math.min(advancePaid, received);
const advanceUnapplied = Math.max(0, advancePaid - advanceApplied);
const unreceived = Math.max(0, commitment - received);
const remainingExposure = Math.max(0, unreceived - advanceUnapplied);
assert.strictEqual(remainingExposure, toMinor(600));
assert.throws(
    () => assertNotOverpaying(toMinor(601), remainingExposure, "Advance payment"),
    /overpay/i
);

section("Status machine: processing → paid allowed; cancelled → failed blocked");
assert.ok(canTransition("processing", "paid"));
assert.ok(!canTransition("cancelled", "failed"));
assert.doesNotThrow(() => assertTransition("approved", "processing"));
assert.throws(() => assertTransition("paid", "processing"));

section("Minor math stable");
assert.strictEqual(addMinor(199, 1), 200);

console.log("\n✅ Payment security helper smoke passed.");
