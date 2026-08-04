/**
 * Simulate Phase1 receive → Phase2 send → buildLinesFromPo receivable.
 * Run: node scripts/_sim_phase2_line_rebuild.js
 */
const asNonNeg = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
};
const idStr = (v) => String(v?._id || v?.id || v || "");
const lineMatchKey = (row = {}) =>
    `${idStr(row.productId)}|${idStr(row.productVariantId)}|${String(row.sku || "")}|${String(row.variantLabel || "")}`;
const softMatchKey = (row = {}) =>
    `${idStr(row.productId)}|${idStr(row.productVariantId)}`;
const linesLooselyMatch = (a = {}, b = {}) => {
    const sa = softMatchKey(a);
    const sb = softMatchKey(b);
    if (sa !== "|" && sa === sb) return true;
    const nameA = String(a.productName || "").trim().toLowerCase();
    const nameB = String(b.productName || "").trim().toLowerCase();
    const varA = String(a.variantLabel || "").trim().toLowerCase();
    const varB = String(b.variantLabel || "").trim().toLowerCase();
    if (nameA && nameA === nameB && varA === varB) return true;
    return false;
};

const effectiveSupplierSentForItem = (po, item) => {
    let sent = Math.max(Number(item.supplierSentQuantity) || 0, 0);
    let fromSchedule = 0;
    for (const phase of po.supplierPartialSchedule || []) {
        for (const alloc of phase.lineAllocations || []) {
            if (
                !linesLooselyMatch(alloc, item) &&
                lineMatchKey(alloc) !== lineMatchKey(item)
            ) {
                continue;
            }
            fromSchedule += asNonNeg(alloc.sentQuantity);
        }
    }
    let fromShipments = 0;
    for (const ship of po.supplierShipments || []) {
        for (const line of ship.lines || []) {
            if (
                linesLooselyMatch(line, item) ||
                lineMatchKey(line) === lineMatchKey(item)
            ) {
                fromShipments += asNonNeg(line.quantity);
            }
        }
    }
    return Math.max(sent, fromSchedule, fromShipments);
};

const buildLines = (po) => {
    const lines = [];
    for (const item of po.items || []) {
        const ordered = Math.max(Number(item.quantity) || 0, 0);
        const received = Math.max(Number(item.receivedQuantity) || 0, 0);
        const damaged = Math.max(Number(item.damagedQuantity) || 0, 0);
        const sent = effectiveSupplierSentForItem(po, item);
        const handled = received + damaged;
        const orderedPending = Math.max(ordered - handled, 0);
        if (orderedPending <= 0) continue;
        const sentPending = Math.max(sent - handled, 0);
        const receivable = Math.min(orderedPending, sentPending);
        if (receivable <= 0) continue;
        lines.push({
            productName: item.productName,
            ordered,
            sent,
            handled,
            receivable
        });
    }
    return lines;
};

// After phase1: 6 ordered, sent was 6, got 5 + dmg 1. Phase2 then sent +4 on schedule
// but item.supplierSentQuantity stuck at 6 (bug case).
const poStaleItemSent = {
    supplierId: "s1",
    items: [
        {
            _id: "poi1",
            productId: "p1",
            productName: "1st regular",
            quantity: 10,
            receivedQuantity: 5,
            damagedQuantity: 1,
            supplierSentQuantity: 6 // stale — should still rebuild from schedule
        }
    ],
    supplierPartialSchedule: [
        {
            phase: 1,
            lineAllocations: [
                {
                    productId: "p1",
                    productName: "1st regular",
                    quantity: 6,
                    sentQuantity: 6
                }
            ]
        },
        {
            phase: 2,
            lineAllocations: [
                {
                    productId: "p1",
                    productName: "1st regular",
                    quantity: 4,
                    sentQuantity: 4
                }
            ]
        }
    ],
    supplierShipments: [
        {
            phase: 2,
            lines: [
                { productId: "p1", productName: "1st regular", quantity: 4 }
            ]
        }
    ]
};

const lines = buildLines(poStaleItemSent);
console.log("rebuilt lines:", lines);
if (lines.length !== 1 || lines[0].receivable !== 4) {
    console.error("FAIL: expected receivable 4 for phase 2");
    process.exit(1);
}
console.log("OK: phase 2 receivable rebuilt from schedule/shipments");
