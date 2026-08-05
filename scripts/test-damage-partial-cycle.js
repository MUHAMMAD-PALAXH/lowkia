/**
 * Unit checks for partial / full damage replacement accounting.
 * Run: node scripts/test-damage-partial-cycle.js
 */
const fulfillment = require("../services/fulfillmentCycleService");

const assert = (cond, msg) => {
    if (!cond) {
        console.error("FAIL:", msg);
        process.exitCode = 1;
        throw new Error(msg);
    }
    console.log("OK:", msg);
};

const makePo = (damagedQty, cases) => ({
    items: [
        {
            productId: "p1",
            productVariantId: null,
            productName: "Phone",
            variantLabel: "",
            sku: "SKU1",
            quantity: 10,
            damagedQuantity: damagedQty,
            receivedQuantity: 0
        }
    ],
    damageCases: cases.map((c) => ({ ...c })),
    markModified() {}
});

const item = {
    productId: "p1",
    productVariantId: null,
    productName: "Phone",
    variantLabel: "",
    sku: "SKU1"
};

// --- Partial replacement send ---
{
    const po = makePo(5, [
        {
            caseNo: "DMG-001",
            productId: "p1",
            productName: "Phone",
            variantLabel: "",
            sku: "SKU1",
            quantity: 5,
            status: "SupplierReceived",
            phase: 1
        }
    ]);
    fulfillment.closeSupplierReceivedDamage(po, item, 3);
    const summary = fulfillment.damageCasesSummary(po);
    assert(summary.openBuyerHoldQty === 0, "partial send: openBuyerHoldQty=0");
    assert(
        summary.supplierReceivedQty === 2,
        `partial send: supplierReceivedQty=2 (got ${summary.supplierReceivedQty})`
    );
    assert(
        summary.closedQty === 3,
        `partial send: closedQty=3 (got ${summary.closedQty})`
    );
    assert(
        summary.replacementOpenQty === 2,
        `partial send: replacementOpenQty=2 (got ${summary.replacementOpenQty})`
    );
    const tracked = po.damageCases.reduce(
        (s, c) => s + Math.max(0, Number(c.quantity) || 0),
        0
    );
    assert(tracked === 5, `partial send: ledger conserved at 5 (got ${tracked})`);
    assert(
        fulfillment.supplierReceivedDamageQty(po, item) === 2,
        "partial send: Damaged max = 2"
    );
}

// --- Full replacement send ---
{
    const po = makePo(5, [
        {
            caseNo: "DMG-001",
            productId: "p1",
            productName: "Phone",
            variantLabel: "",
            sku: "SKU1",
            quantity: 5,
            status: "SupplierReceived",
            phase: 1
        }
    ]);
    fulfillment.closeSupplierReceivedDamage(po, item, 5);
    const summary = fulfillment.damageCasesSummary(po);
    assert(summary.openBuyerHoldQty === 0, "full send: openBuyerHoldQty=0");
    assert(summary.supplierReceivedQty === 0, "full send: supplierReceivedQty=0");
    assert(summary.closedQty === 5, "full send: closedQty=5");
    assert(summary.replacementOpenQty === 0, "full send: replacementOpenQty=0");
}

// --- BuyerHold still shows correctly ---
{
    const po = makePo(4, [
        {
            caseNo: "DMG-002",
            productId: "p1",
            productName: "Phone",
            variantLabel: "",
            sku: "SKU1",
            quantity: 4,
            status: "BuyerHold",
            phase: 2
        }
    ]);
    const summary = fulfillment.damageCasesSummary(po);
    assert(summary.openBuyerHoldQty === 4, "buyer hold: openBuyerHoldQty=4");
    assert(
        summary.byPhase.some((p) => p.phase === 2 && p.buyerHoldQty === 4),
        "buyer hold: byPhase phase 2 qty 4"
    );
}

// --- Never invent BuyerHold from lifetime vs shrunk cases (old bug path) ---
{
    // Simulate OLD bug state: case shrunk to 2 without Closed sibling, lifetime 5
    const po = makePo(5, [
        {
            caseNo: "DMG-001",
            productId: "p1",
            productName: "Phone",
            variantLabel: "",
            sku: "SKU1",
            quantity: 2,
            status: "SupplierReceived",
            phase: 1
        }
    ]);
    const summary = fulfillment.damageCasesSummary(po);
    assert(
        summary.openBuyerHoldQty === 0,
        "legacy shrink: must NOT invent openBuyerHold from lifetime gap"
    );
    assert(summary.supplierReceivedQty === 2, "legacy shrink: due=2");
}

console.log("\nAll damage cycle checks passed.");
