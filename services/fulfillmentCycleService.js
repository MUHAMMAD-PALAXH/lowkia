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

/** Plan qty still owed (ordered − sent). Damage replacements are tracked separately. */
const planRemainingToSend = (item = {}) => {
    const ordered = Math.max(0, Number(item.quantity) || 0);
    const sent = Math.max(0, Number(item.supplierSentQuantity) || 0);
    return Math.max(ordered - sent, 0);
};

/**
 * Total still sendable including all recorded damage (legacy).
 * Prefer planRemainingToSend + supplierReceivedDamageQty for send UI gating.
 */
const remainingToSend = (item = {}) => {
    const ordered = Math.max(0, Number(item.quantity) || 0);
    const damaged = Math.max(0, Number(item.damagedQuantity) || 0);
    const sent = Math.max(0, Number(item.supplierSentQuantity) || 0);
    return Math.max(ordered + damaged - sent, 0);
};

const softItemMatch = (a = {}, b = {}) => {
    const softA = softMatchKey(a);
    const softB = softMatchKey(b);
    if (softA !== "|" && softA === softB) return true;
    if (lineMatchKey(a) === lineMatchKey(b)) return true;
    // Name / SKU fallback (allocations sometimes lack productId)
    const nameA = String(a.productName || "")
        .trim()
        .toLowerCase();
    const nameB = String(b.productName || "")
        .trim()
        .toLowerCase();
    if (!nameA || !nameB || nameA !== nameB) return false;
    const varA = String(a.variantLabel || "")
        .trim()
        .toLowerCase();
    const varB = String(b.variantLabel || "")
        .trim()
        .toLowerCase();
    if (varA === varB) return true;
    const skuA = String(a.sku || "")
        .trim()
        .toLowerCase();
    const skuB = String(b.sku || "")
        .trim()
        .toLowerCase();
    return !!(skuA && skuB && skuA === skuB);
};

/** Damaged qty supplier may send only after they confirmed receive of returned goods. */
const supplierReceivedDamageQty = (po, item = {}) => {
    let sum = 0;
    for (const c of po.damageCases || []) {
        if (c.status !== "SupplierReceived") continue;
        if (!softItemMatch(c, item)) continue;
        sum += Math.max(0, Number(c.quantity) || 0);
    }
    return sum;
};

/** Under-send leftover sitting on completed phases (previous remaining field). */
const completedPhaseRemainingQty = (po, item = {}) => {
    let sum = 0;
    for (const phase of po.supplierPartialSchedule || []) {
        if (!phase.isCompleted) continue;
        for (const a of phase.lineAllocations || []) {
            if (!softItemMatch(a, item)) continue;
            const left =
                Math.max(0, Number(a.quantity) || 0) -
                Math.max(0, Number(a.sentQuantity) || 0);
            if (left > 0) sum += left;
        }
    }
    return sum;
};

const applyQtyToCompletedPhases = (po, item = {}, qty = 0) => {
    let left = Math.max(0, Number(qty) || 0);
    if (left <= 0.0001) return 0;
    for (const phase of po.supplierPartialSchedule || []) {
        if (!phase.isCompleted || left <= 0.0001) continue;
        for (const a of phase.lineAllocations || []) {
            if (!softItemMatch(a, item)) continue;
            const rem =
                Math.max(0, Number(a.quantity) || 0) -
                Math.max(0, Number(a.sentQuantity) || 0);
            if (rem <= 0.0001) continue;
            const take = Math.min(rem, left);
            a.sentQuantity = Math.max(0, Number(a.sentQuantity) || 0) + take;
            left -= take;
        }
    }
    return left;
};

/** Mark SupplierReceived cases Closed as replacement qty is sent. */
const closeSupplierReceivedDamage = (po, item = {}, qty = 0) => {
    let left = Math.max(0, Number(qty) || 0);
    if (left <= 0.0001) return;
    for (const c of po.damageCases || []) {
        if (left <= 0.0001) break;
        if (c.status !== "SupplierReceived") continue;
        if (!softItemMatch(c, item)) continue;
        const q = Math.max(0, Number(c.quantity) || 0);
        if (q <= left + 0.0001) {
            c.status = "Closed";
            left -= q;
        } else {
            c.quantity = q - left;
            left = 0;
        }
    }
    if (typeof po.markModified === "function") {
        po.markModified("damageCases");
    }
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

/** Open-phase coverage uses plan qty only — never fold damage into Plan phases. */
const buildRemainingAllocations = (po) => {
    const rows = [];
    for (const item of po.items || []) {
        const qty = planRemainingToSend(item);
        // Subtract qty already sitting on completed phases (previous remaining)
        const onCompleted = completedPhaseRemainingQty(po, item);
        const openNeed = Math.max(qty - onCompleted, 0);
        if (openNeed <= 0.0001) continue;
        rows.push({
            productId: item.productId || null,
            productVariantId: item.productVariantId || null,
            productName: item.productName || "",
            variantLabel: item.variantLabel || "",
            sku: item.sku || "",
            quantity: openNeed,
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
        const soft = softMatchKey(extra);
        let alloc = phase.lineAllocations.find(
            (a) => softMatchKey(a) === soft && soft !== "|"
        );
        if (!alloc) {
            alloc = phase.lineAllocations.find(
                (a) => lineMatchKey(a) === lineMatchKey(extra)
            );
        }
        if (alloc) {
            alloc.quantity = Math.max(0, Number(alloc.quantity) || 0) + qty;
            // Prefer richer identity from the PO item when merging
            if (!alloc.productId && extra.productId) alloc.productId = extra.productId;
            if (!alloc.productVariantId && extra.productVariantId) {
                alloc.productVariantId = extra.productVariantId;
            }
            if (!alloc.sku && extra.sku) alloc.sku = extra.sku;
            if (!alloc.variantLabel && extra.variantLabel) {
                alloc.variantLabel = extra.variantLabel;
            }
            if (!alloc.productName && extra.productName) {
                alloc.productName = extra.productName;
            }
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
    coalescePhaseAllocations(phase);
};

/** One allocation row per product+variant — prevents duplicate send lines. */
const coalescePhaseAllocations = (phase) => {
    if (!phase || !Array.isArray(phase.lineAllocations)) return phase;
    const map = new Map();
    for (const a of phase.lineAllocations) {
        const soft = softMatchKey(a);
        const key = soft !== "|" ? soft : lineMatchKey(a);
        const prev = map.get(key);
        const qty = Math.max(0, Number(a.quantity) || 0);
        const sent = Math.max(0, Number(a.sentQuantity) || 0);
        if (!prev) {
            map.set(key, {
                productId: a.productId || null,
                productVariantId: a.productVariantId || null,
                productName: a.productName || "",
                variantLabel: a.variantLabel || "",
                sku: a.sku || "",
                quantity: qty,
                sentQuantity: sent
            });
            continue;
        }
        prev.quantity += qty;
        prev.sentQuantity += sent;
        if (!prev.productId && a.productId) prev.productId = a.productId;
        if (!prev.productVariantId && a.productVariantId) {
            prev.productVariantId = a.productVariantId;
        }
        if (!prev.sku && a.sku) prev.sku = a.sku;
        if (!prev.variantLabel && a.variantLabel) {
            prev.variantLabel = a.variantLabel;
        }
        if (!prev.productName && a.productName) prev.productName = a.productName;
    }
    phase.lineAllocations = [...map.values()].filter(
        (a) => Math.max(0, Number(a.quantity) || 0) > 0.0001
    );
    return phase;
};

const coalesceAllOpenPhases = (po) => {
    for (const phase of po.supplierPartialSchedule || []) {
        if (phase.isCompleted) continue;
        coalescePhaseAllocations(phase);
    }
    if (typeof po.markModified === "function") {
        po.markModified("supplierPartialSchedule");
    }
};

/**
 * Under-send leftover stays on the closed phase as "previous remaining".
 * Do NOT merge into the next phase — current phase qty and prev remaining
 * must stay separate fields on the supplier send form.
 */
const rollPhaseShortfallToCatchUp = (po, closedPhase, shipmentLines = []) => {
    // Intentional no-op: shortfall remains on closedPhase allocations
    // (quantity − sentQuantity) for the previous-remaining send bucket.
    if (closedPhase && !closedPhase.note) {
        closedPhase.note = "Under-sent — leftover stays as previous remaining";
    }
    return null;
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
    // Fallback: PO damaged counters only when NO damage cases exist yet
    let damagedOnPo = 0;
    for (const item of po.items || []) {
        damagedOnPo += Math.max(0, Number(item.damagedQuantity) || 0);
    }
    const trackedAll = cases.reduce(
        (s, c) => s + Math.max(0, Number(c.quantity) || 0),
        0
    );
    // Never re-open BuyerHold for qty already ReturnShipped / SupplierReceived / Closed
    if (cases.length === 0 && damagedOnPo > 0.0001) {
        openQty = damagedOnPo;
    } else if (damagedOnPo > trackedAll + 0.0001) {
        openQty += damagedOnPo - trackedAll;
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
 * After receive, do not fold leftover / damage into an agreed Plan phase.
 * Previous remaining stays on completed phases; damage uses SupplierReceived
 * cases on the send form. Only append a new phase when plan qty is not
 * covered by open + completed leftovers.
 */
const ensureReplacementPhaseAfterReceive = (po) => {
    if (po.supplierDeliveryType !== "Partial") {
        return null;
    }
    coalesceAllOpenPhases(po);

    if (!Array.isArray(po.supplierPartialSchedule)) {
        po.supplierPartialSchedule = [];
    }

    // Coverage = open remaining + completed remaining (previous leftover)
    const covered = {};
    for (const phase of po.supplierPartialSchedule) {
        for (const a of phase.lineAllocations || []) {
            const left =
                Math.max(0, Number(a.quantity) || 0) -
                Math.max(0, Number(a.sentQuantity) || 0);
            if (left <= 0) continue;
            const soft = softMatchKey(a);
            const key = soft !== "|" ? soft : lineMatchKey(a);
            covered[key] = (covered[key] || 0) + left;
        }
    }

    const uncovered = [];
    for (const item of po.items || []) {
        const need = planRemainingToSend(item);
        if (need <= 0.0001) continue;
        const soft = softMatchKey(item);
        const key = soft !== "|" ? soft : lineMatchKey(item);
        const have = Math.max(0, Number(covered[key]) || 0);
        const gap = need - have;
        if (gap > 0.0001) {
            uncovered.push({
                productId: item.productId || null,
                productVariantId: item.productVariantId || null,
                productName: item.productName || "",
                variantLabel: item.variantLabel || "",
                sku: item.sku || "",
                quantity: gap,
                sentQuantity: 0
            });
        }
    }
    if (!uncovered.length) return null;

    // Never inflate an existing Plan phase — append CatchUp only when needed
    const openIdx = findOpenPhaseIndex(po);
    if (openIdx >= 0) {
        const open = po.supplierPartialSchedule[openIdx];
        if (open.kind && open.kind !== "Plan") {
            mergeAllocationsIntoPhase(open, uncovered);
            if (typeof po.markModified === "function") {
                po.markModified("supplierPartialSchedule");
            }
            return open;
        }
    }

    return ensureOpenFulfillmentPhase(po, {
        kind: "CatchUp",
        note: "Additional phase for uncovered plan qty"
    });
};

module.exports = {
    PHASE_KINDS,
    SHIP_KINDS,
    DAMAGE_STATUSES,
    lineMatchKey,
    softMatchKey,
    softItemMatch,
    planRemainingToSend,
    remainingToSend,
    supplierReceivedDamageQty,
    completedPhaseRemainingQty,
    applyQtyToCompletedPhases,
    closeSupplierReceivedDamage,
    okShortfall,
    nextPhaseNumber,
    buildRemainingAllocations,
    findOpenPhaseIndex,
    ensureOpenFulfillmentPhase,
    mergeAllocationsIntoPhase,
    coalescePhaseAllocations,
    coalesceAllOpenPhases,
    rollPhaseShortfallToCatchUp,
    createDamageCasesFromReceive,
    openDamageHoldQtyByKey,
    damageCasesSummary,
    ensureReplacementPhaseAfterReceive
};
