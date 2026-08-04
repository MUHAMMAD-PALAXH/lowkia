/**
 * Fulfillment cycle helpers — keep multi-phase send/receive, catch-up,
 * damage return, and replacement loops on one maintainable path.
 *
 * Invariant: only accepted OK qty fulfills ordered qty.
 * Extra waves are real schedule phases (CatchUp / Replacement), not hacks
 * that reuse the last phase number.
 */
const AppError = require("../utils/appError");

const PHASE_KINDS = Object.freeze(["Plan", "CatchUp", "Replacement"]);
const SHIP_KINDS = Object.freeze([
    "PlanPhase",
    "CatchUp",
    "Replacement",
    "ReturnToSupplier"
]);
const DAMAGE_STATUSES = Object.freeze([
    "BuyerHold",
    "ReturnShipped",
    "SupplierReceived",
    "Closed"
]);

const lineMatchKey = (row = {}) => {
    const pid = row.productId?._id || row.productId?.id || row.productId || "";
    const vid =
        row.productVariantId?._id ||
        row.productVariantId?.id ||
        row.productVariantId ||
        "";
    return `${String(pid)}|${String(vid)}|${String(row.sku || "")}|${String(
        row.variantLabel || ""
    )}`;
};

const softMatchKey = (row = {}) => {
    const pid = row.productId?._id || row.productId?.id || row.productId || "";
    const vid =
        row.productVariantId?._id ||
        row.productVariantId?.id ||
        row.productVariantId ||
        "";
    return `${String(pid)}|${String(vid)}`;
};

const remainingToSend = (item = {}) => {
    const ordered = Math.max(0, Number(item.quantity) || 0);
    const damaged = Math.max(0, Number(item.damagedQuantity) || 0);
    const sent = Math.max(0, Number(item.supplierSentQuantity) || 0);
    return Math.max(ordered + damaged - sent, 0);
};

const okShortfall = (item = {}) => {
    const ordered = Math.max(0, Number(item.quantity) || 0);
    const accepted = Math.max(0, Number(item.receivedQuantity) || 0);
    return Math.max(ordered - accepted, 0);
};

const nextPhaseNumber = (po) => {
    let max = 0;
    for (const p of po.supplierPartialSchedule || []) {
        const n = Number(p.phase) || 0;
        if (n > max) max = n;
    }
    return max + 1;
};

const buildRemainingAllocations = (po) => {
    const rows = [];
    for (const item of po.items || []) {
        const qty = remainingToSend(item);
        if (qty <= 0.0001) continue;
        rows.push({
            productId: item.productId || null,
            productVariantId: item.productVariantId || null,
            productName: item.productName || "",
            variantLabel: item.variantLabel || "",
            sku: item.sku || "",
            quantity: qty,
            sentQuantity: 0
        });
    }
    return rows;
};

const findOpenPhaseIndex = (po) =>
    (po.supplierPartialSchedule || []).findIndex((p) => !p.isCompleted);

/**
 * Ensure there is an open delivery phase covering remaining send qty.
 * Used when planned phases are exhausted but OK shortfall / damage debt remains,
 * or when mid-schedule under-sends need a catch-up wave.
 */
const ensureOpenFulfillmentPhase = (po, opts = {}) => {
    if (!Array.isArray(po.supplierPartialSchedule)) {
        po.supplierPartialSchedule = [];
    }
    const openIdx = findOpenPhaseIndex(po);
    if (openIdx >= 0) {
        return po.supplierPartialSchedule[openIdx];
    }

    const allocations = buildRemainingAllocations(po);
    if (!allocations.length) return null;

    const kind = PHASE_KINDS.includes(opts.kind) ? opts.kind : "CatchUp";
    const phase = {
        phase: nextPhaseNumber(po),
        amount: 0,
        amountType: "Fixed",
        daysFrom: 0,
        daysTo: 0,
        days: 0,
        dateFrom: null,
        dateTo: null,
        dueDate: null,
        note:
            String(opts.note || "").trim() ||
            (kind === "Replacement"
                ? "Replacement / remaining send after damage or shortfall"
                : "Catch-up send for under-sent or leftover qty"),
        kind,
        isCompleted: false,
        completedAt: null,
        lineAllocations: allocations
    };
    po.supplierPartialSchedule.push(phase);
    if (typeof po.markModified === "function") {
        po.markModified("supplierPartialSchedule");
    }
    return phase;
};

const mergeAllocationsIntoPhase = (phase, extras = []) => {
    if (!Array.isArray(phase.lineAllocations)) phase.lineAllocations = [];
    for (const extra of extras) {
        const qty = Math.max(0, Number(extra.quantity) || 0);
        if (qty <= 0.0001) continue;
        const key = lineMatchKey(extra);
        const soft = softMatchKey(extra);
        let alloc = phase.lineAllocations.find(
            (a) => lineMatchKey(a) === key
        );
        if (!alloc) {
            alloc = phase.lineAllocations.find(
                (a) => softMatchKey(a) === soft && soft !== "|"
            );
        }
        if (alloc) {
            alloc.quantity = Math.max(0, Number(alloc.quantity) || 0) + qty;
        } else {
            phase.lineAllocations.push({
                productId: extra.productId || null,
                productVariantId: extra.productVariantId || null,
                productName: extra.productName || "",
                variantLabel: extra.variantLabel || "",
                sku: extra.sku || "",
                quantity: qty,
                sentQuantity: 0
            });
        }
    }
};

/**
 * When a planned phase closes short, roll unsent qty into the next open phase
 * or append a CatchUp phase so leftover product is never stranded.
 */
const rollPhaseShortfallToCatchUp = (po, closedPhase, shipmentLines = []) => {
    const shortfalls = [];
    for (const row of shipmentLines) {
        const expected = Math.max(0, Number(row.expectedQuantity) || 0);
        const sent = Math.max(0, Number(row.quantity) || 0);
        const short = expected - sent;
        if (short <= 0.0001) continue;
        const src = row.meta?.item || row.meta?.alloc || {};
        shortfalls.push({
            productId: src.productId || null,
            productVariantId: src.productVariantId || null,
            productName: row.meta?.productName || src.productName || "",
            variantLabel: row.meta?.variantLabel || src.variantLabel || "",
            sku: row.meta?.sku || src.sku || "",
            quantity: short
        });
    }
    if (!shortfalls.length) return null;

    const schedule = po.supplierPartialSchedule || [];
    const nextOpen = schedule.find(
        (p) => p !== closedPhase && !p.isCompleted
    );
    if (nextOpen) {
        mergeAllocationsIntoPhase(nextOpen, shortfalls);
        if (!nextOpen.note) {
            nextOpen.note = "Includes catch-up from earlier under-send";
        }
        if (typeof po.markModified === "function") {
            po.markModified("supplierPartialSchedule");
        }
        return nextOpen;
    }

    if (!Array.isArray(po.supplierPartialSchedule)) {
        po.supplierPartialSchedule = [];
    }
    const catchUp = {
        phase: nextPhaseNumber(po),
        amount: 0,
        amountType: "Fixed",
        daysFrom: 0,
        daysTo: 0,
        days: 0,
        dateFrom: null,
        dateTo: null,
        dueDate: null,
        note: `Catch-up for under-sent phase ${closedPhase?.phase || ""}`.trim(),
        kind: "CatchUp",
        isCompleted: false,
        completedAt: null,
        lineAllocations: shortfalls.map((s) => ({
            ...s,
            sentQuantity: 0
        }))
    };
    po.supplierPartialSchedule.push(catchUp);
    if (typeof po.markModified === "function") {
        po.markModified("supplierPartialSchedule");
    }
    return catchUp;
};

const nextDamageCaseNo = (po) => {
    const n = (po.damageCases || []).length + 1;
    return `DMG-${String(n).padStart(3, "0")}`;
};

/**
 * Create BuyerHold damage cases from a GRN receive batch so returns and
 * replacements stay trackable across repeated damage cycles.
 */
const createDamageCasesFromReceive = (po, grn, batch = {}) => {
    if (!Array.isArray(po.damageCases)) po.damageCases = [];
    const created = [];
    for (const line of batch.lines || []) {
        const qty = Math.max(0, Number(line.damagedQuantity) || 0);
        if (qty <= 0.0001) continue;
        const entry = {
            caseNo: nextDamageCaseNo(po),
            purchaseOrderItemId: line.purchaseOrderItemId || null,
            productId: line.productId || null,
            productVariantId: line.productVariantId || null,
            productName: line.productName || "",
            variantLabel: line.variantLabel || "",
            sku: line.sku || "",
            quantity: qty,
            status: "BuyerHold",
            grnId: grn?._id || null,
            receiveBatchNo: batch.batchNo || "",
            phase: batch.phase == null ? null : Number(batch.phase),
            createdAt: batch.receivedAt || new Date(),
            returnedAt: null,
            supplierReceivedAt: null,
            returnNote: "",
            receiveNote: "",
            imeis: Array.isArray(line.imeis) ? line.imeis.slice() : []
        };
        po.damageCases.push(entry);
        created.push(entry);
    }
    if (created.length && typeof po.markModified === "function") {
        po.markModified("damageCases");
    }
    return created;
};

const openDamageHoldQtyByKey = (po) => {
    const map = {};
    for (const c of po.damageCases || []) {
        if (c.status !== "BuyerHold") continue;
        const key = lineMatchKey(c);
        map[key] = (map[key] || 0) + Math.max(0, Number(c.quantity) || 0);
    }
    return map;
};

const damageCasesSummary = (po) => {
    const cases = po.damageCases || [];
    const byStatus = {};
    for (const s of DAMAGE_STATUSES) byStatus[s] = 0;
    let openQty = 0;
    let returnShippedQty = 0;
    for (const c of cases) {
        const st = c.status || "BuyerHold";
        byStatus[st] = (byStatus[st] || 0) + 1;
        const q = Math.max(0, Number(c.quantity) || 0);
        if (st === "BuyerHold") openQty += q;
        if (st === "ReturnShipped") returnShippedQty += q;
    }
    // Fallback: PO damaged counters when cases were never created
    let damagedOnPo = 0;
    for (const item of po.items || []) {
        damagedOnPo += Math.max(0, Number(item.damagedQuantity) || 0);
    }
    const tracked = openQty + returnShippedQty;
    if (damagedOnPo > tracked + 0.0001) {
        openQty += damagedOnPo - tracked;
    }
    return {
        totalCases: cases.length,
        openBuyerHoldQty: openQty,
        returnShippedQty,
        awaitingSupplierReceive: cases.filter((c) => c.status === "ReturnShipped")
            .length,
        byStatus,
        cases: cases.map((c) => ({
            id: c._id || c.id || null,
            caseNo: c.caseNo || "",
            productId: c.productId || null,
            productVariantId: c.productVariantId || null,
            productName: c.productName || "",
            variantLabel: c.variantLabel || "",
            sku: c.sku || "",
            quantity: Math.max(0, Number(c.quantity) || 0),
            status: c.status || "BuyerHold",
            phase: c.phase == null ? null : Number(c.phase),
            createdAt: c.createdAt || null,
            returnedAt: c.returnedAt || null,
            supplierReceivedAt: c.supplierReceivedAt || null
        }))
    };
};

/**
 * After receive creates damage / OK shortfall, make sure schedule allocations
 * cover remaining send qty — merge into the current open phase or append
 * a Replacement / CatchUp phase so GRN sequential receive stays consistent.
 */
const ensureReplacementPhaseAfterReceive = (po) => {
    if (po.supplierDeliveryType !== "Partial") {
        // Full delivery uses item remainingToSend on the next supplier-send
        return null;
    }
    const needed = buildRemainingAllocations(po);
    if (!needed.length) return null;

    if (!Array.isArray(po.supplierPartialSchedule)) {
        po.supplierPartialSchedule = [];
    }

    // How much is already allocated (unsent) across incomplete phases?
    const covered = {};
    for (const phase of po.supplierPartialSchedule) {
        if (phase.isCompleted) continue;
        for (const a of phase.lineAllocations || []) {
            const left =
                Math.max(0, Number(a.quantity) || 0) -
                Math.max(0, Number(a.sentQuantity) || 0);
            if (left <= 0) continue;
            const key = lineMatchKey(a);
            covered[key] = (covered[key] || 0) + left;
        }
    }

    const uncovered = [];
    for (const row of needed) {
        const key = lineMatchKey(row);
        const need = Math.max(0, Number(row.quantity) || 0);
        const have = Math.max(0, Number(covered[key]) || 0);
        const gap = need - have;
        if (gap > 0.0001) {
            uncovered.push({ ...row, quantity: gap, sentQuantity: 0 });
        }
    }
    if (!uncovered.length) return null;

    const openIdx = findOpenPhaseIndex(po);
    if (openIdx >= 0) {
        const open = po.supplierPartialSchedule[openIdx];
        mergeAllocationsIntoPhase(open, uncovered);
        if (open.kind === "Plan") {
            // Keep Plan as plan; note that catch-up qty was folded in
            if (!String(open.note || "").includes("catch-up")) {
                open.note = [open.note, "Includes catch-up / replacement qty"]
                    .filter(Boolean)
                    .join(" · ");
            }
        }
        if (typeof po.markModified === "function") {
            po.markModified("supplierPartialSchedule");
        }
        return open;
    }

    return ensureOpenFulfillmentPhase(po, {
        kind: "Replacement",
        note: "Additional phase for remaining / damaged replacement"
    });
};

module.exports = {
    PHASE_KINDS,
    SHIP_KINDS,
    DAMAGE_STATUSES,
    lineMatchKey,
    softMatchKey,
    remainingToSend,
    okShortfall,
    nextPhaseNumber,
    buildRemainingAllocations,
    findOpenPhaseIndex,
    ensureOpenFulfillmentPhase,
    mergeAllocationsIntoPhase,
    rollPhaseShortfallToCatchUp,
    createDamageCasesFromReceive,
    openDamageHoldQtyByKey,
    damageCasesSummary,
    ensureReplacementPhaseAfterReceive
};
