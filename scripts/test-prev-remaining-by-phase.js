/**
 * Unit checks for per-phase previous remaining send/clear.
 * Run: node scripts/test-prev-remaining-by-phase.js
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

const item = {
    productId: "p1",
    productVariantId: null,
    productName: "Phone",
    variantLabel: "",
    sku: "SKU1"
};

const makePo = () => ({
    items: [{ ...item, quantity: 20, supplierSentQuantity: 8 }],
    supplierPartialSchedule: [
        {
            phase: 1,
            isCompleted: true,
            lineAllocations: [
                {
                    ...item,
                    quantity: 5, // agreed was 10, sent 5, rem 5 → then shrunk display
                    sentQuantity: 5
                }
            ]
        },
        {
            phase: 2,
            isCompleted: true,
            lineAllocations: [
                {
                    ...item,
                    quantity: 5,
                    sentQuantity: 3 // rem 2
                }
            ]
        },
        {
            phase: 3,
            isCompleted: false,
            lineAllocations: [
                {
                    ...item,
                    quantity: 4,
                    sentQuantity: 0
                }
            ]
        }
    ],
    markModified() {}
});

{
    const po = makePo();
    // Fix phase 1 remaining: quantity 10 sent 5 → rem 5
    po.supplierPartialSchedule[0].lineAllocations[0].quantity = 10;
    const byPhase = fulfillment.completedPhaseRemainingByPhase(po, item);
    assert(byPhase.length === 2, `byPhase length 2 (got ${byPhase.length})`);
    assert(byPhase[0].phase === 1 && byPhase[0].remaining === 5, "phase 1 rem 5");
    assert(byPhase[1].phase === 2 && byPhase[1].remaining === 2, "phase 2 rem 2");
    assert(
        fulfillment.completedPhaseRemainingQty(po, item) === 7,
        "total prev rem 7"
    );
}

{
    const po = makePo();
    po.supplierPartialSchedule[0].lineAllocations[0].quantity = 10;
    // Clear only phase 1 rem of 3
    const left = fulfillment.applyQtyToCompletedPhases(po, item, 3, [
        { phase: 1, qty: 3 }
    ]);
    assert(left === 0, "explicit clear left=0");
    const a1 = po.supplierPartialSchedule[0].lineAllocations[0];
    assert(
        a1.quantity === 7 && a1.sentQuantity === 5,
        `phase1 after clear qty=7 sent=5 (got qty=${a1.quantity} sent=${a1.sentQuantity})`
    );
    const a2 = po.supplierPartialSchedule[1].lineAllocations[0];
    assert(
        a2.quantity === 5 && a2.sentQuantity === 3,
        "phase2 untouched"
    );
    const rem = fulfillment.completedPhaseRemainingByPhase(po, item);
    assert(rem[0].remaining === 2, "phase1 rem now 2");
    assert(rem[1].remaining === 2, "phase2 rem still 2");
}

{
    const po = makePo();
    po.supplierPartialSchedule[0].lineAllocations[0].quantity = 10;
    // Send phase1=2 + phase2=2 explicitly
    fulfillment.applyQtyToCompletedPhases(po, item, 4, [
        { phase: 1, qty: 2 },
        { phase: 2, qty: 2 }
    ]);
    const rem = fulfillment.completedPhaseRemainingByPhase(po, item);
    assert(rem.length === 1 && rem[0].phase === 1 && rem[0].remaining === 3, "only phase1 rem 3 left");
}

console.log("\nAll previous-remaining-by-phase checks passed.");
