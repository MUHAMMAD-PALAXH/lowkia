/**
 * Offline smoke for Supplier Payable hybrid math (Phase 2).
 * Run: node scripts/smokeSupplierPayable.js
 */
const assert = require("assert");
const {
    recomputeHybridBalances,
} = require("../services/supplierPayableService");

const run = (seed) => {
    const p = { status: "open", ...seed };
    recomputeHybridBalances(p);
    return p;
};

// Example from architecture:
// PO 100000, Advance 20000, GRN 70000, Payment1 30000, Payment2 20000
{
    const p = run({
        poCommitmentMinor: 10000000,
        advancePaidMinor: 2000000,
        grnReceivedValueMinor: 7000000,
        paidAgainstPayableMinor: 5000000, // 30k + 20k
    });
    assert.strictEqual(p.advanceAppliedMinor, 2000000);
    assert.strictEqual(p.advanceUnappliedMinor, 0);
    // due = 70000 - 20000 advance - 50000 paid = 0
    assert.strictEqual(p.payableDueMinor, 0);
    assert.strictEqual(p.outstandingMinor, 0);
    assert.strictEqual(p.remainingExposureMinor, 3000000); // 100k-70k unreceived
    assert.strictEqual(p.status, "partial"); // still exposed on unreceived goods
}

// Advance before GRN
{
    const p = run({
        poCommitmentMinor: 10000000,
        advancePaidMinor: 2000000,
        grnReceivedValueMinor: 0,
        paidAgainstPayableMinor: 0,
    });
    assert.strictEqual(p.advanceUnappliedMinor, 2000000);
    assert.strictEqual(p.payableDueMinor, 0);
    assert.strictEqual(p.remainingExposureMinor, 8000000); // 100k - 20k advance
    assert.strictEqual(p.status, "partial");
}

// GRN without enough payments
{
    const p = run({
        poCommitmentMinor: 10000000,
        advancePaidMinor: 2000000,
        grnReceivedValueMinor: 7000000,
        paidAgainstPayableMinor: 3000000,
    });
    // due = 70k - 20k - 30k = 20k
    assert.strictEqual(p.payableDueMinor, 2000000);
    assert.strictEqual(p.outstandingMinor, 2000000);
    assert.strictEqual(p.status, "partial");
}

// Overpay protection unit (service assertNotOverpaying tested in phase1)
console.log("✅ Phase 2 supplier payable hybrid math passed.");
