/**
 * GRN Service
 * Locked decisions:
 * - Create only from Ordered / shipped / Partially Received PO (no manual GRN)
 * - First GRN start is from Purchase Order → Create GRN
 * - ONE GRN document per PO (Continue / Receive always reuses it)
 * - Partial receive batches stock inventory; GRN stays Draft until PO fully received
 * - receiveBatches[] stores each receive snapshot (got / damaged / date)
 * - GRN "Receive from PO" only lists POs with an open (not Completed) GRN
 * - IMEI: scan one-by-one + bulk paste
 * - Owner completes freely; Employee needs approval before stock increases
 * - Non-IMEI: received qty (barcode optional)
 * - Stock increases on each receive batch; header Completed only when PO fully received
 */

const mongoose = require("mongoose");
const GRN = require("../model/grn");
const PurchaseOrder = require("../model/purchaseOrder");
const Product = require("../model/product");
const ProductVariant = require("../model/productVariant");
const Inventory = require("../model/inventory");
const ItemTrack = require("../model/itemTrack");
const StockMovement = require("../model/StockMovement");
const Warehouse = require("../model/warehouse");
const {
    generateGRNCode,
    generateStockMovementCode,
    generateProductCode,
    generateProductVariantCode
} = require("./codeGenerator");
const { generateProductBarcode } = require("./barcodeGenerator");
const productService = require("./productService");
const AppError = require("../utils/appError");
const { createTrashOps, isTrashQuery } = require("../utils/softDeleteTrash");

const NOT_DELETED = { isDeleted: { $ne: true } };
const RECEIVABLE_PO = [
    "Ordered",
    "Partially Delivered",
    "Completely Delivered",
    "Partially Received"
];
/** Supplier POs: GRN only after goods have been sent (not merely accepted). */
const SUPPLIER_GRN_READY = [
    "Partially Delivered",
    "Completely Delivered",
    "Partially Received"
];
const NO_SUPPLIER_GRN_READY = [
    "Ordered",
    "Partially Delivered",
    "Completely Delivered",
    "Partially Received"
];
const EDITABLE_GRN = ["Draft", "Pending Approval"];

const trash = createTrashOps(GRN, {
    label: "GRN",
    nameField: "grnNumber",
    statusField: "status",
    restoreStatus: "Draft",
    beforeSoftDelete: async (doc) => {
        if (
            doc.inventoryUpdated ||
            doc.status === "Completed" ||
            doc.purchaseStatus === "Partially Received" ||
            doc.purchaseStatus === "Completed" ||
            (Array.isArray(doc.receiveBatches) && doc.receiveBatches.length > 0)
        ) {
            throw new AppError(
                "GRNs that have stocked inventory (or are completed) cannot be trashed.",
                400
            );
        }
        // Align with PO: Draft and Cancelled may enter trash.
        if (!["Draft", "Cancelled"].includes(doc.status)) {
            throw new AppError(
                `Only Draft or Cancelled GRNs can move to trash (current: ${doc.status}). Cancel Pending Approval first, or complete/reject as needed.`,
                400
            );
        }
    },
    scopeStatusMap: {
        draft: "Draft",
        pendingapproval: "Pending Approval",
        completed: "Completed",
        cancelled: "Cancelled",
        received: "Received",
        verified: "Verified"
    }
});

const toObjectId = (value) => {
    if (!value) return null;
    const id = String(value);
    return mongoose.Types.ObjectId.isValid(id)
        ? new mongoose.Types.ObjectId(id)
        : null;
};

const escapeRegex = (value = "") =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isOwnerActor = (payload = {}) => {
    const type = (payload.actorType || payload.uploadedByType || "")
        .toString()
        .trim();
    return type === "Owner" || payload.autoApprove === true;
};

const normalizeImei = (value) =>
    String(value || "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "");

const resolveFallbackWarehouseId = async () => {
    const warehouse = await Warehouse.findOne({
        isDeleted: { $ne: true },
        $or: [{ status: "Active" }, { status: { $exists: false } }, { status: "" }]
    })
        .sort({ createdAt: 1 })
        .select("_id");
    return warehouse?._id || null;
};

const resolveTrackingType = (raw) => {
    const tt = String(raw || "")
        .trim()
        .toUpperCase();
    if (tt.includes("IMEI") && !tt.includes("NON")) return "IMEI";
    return "Non-IMEI";
};

const populateGrn = (query) =>
    query
        .populate("purchaseOrderId", "purchaseOrderNo status purchaseType items")
        .populate("supplierId", "supplierCode name phone email")
        .populate("warehouseId", "warehouseCode warehouseName city")
        .populate("branchId", "branchCode name city")
        .populate("createdBy", "name email")
        .populate("approvedBy", "name email")
        .populate("items.productId", "name productCode trackingType barcode sku")
        .populate("items.productVariantId", "sku combinationString barcode");

/** After populate, normalize line trackingType and hydrate snapshot fields */
const plannedPaymentAmount = (phase, grandTotal) => {
    const raw = Math.max(Number(phase?.amount) || 0, 0);
    if (String(phase?.amountType || "Fixed") === "Percentage") {
        return Math.max(((Number(grandTotal) || 0) * raw) / 100, 0);
    }
    return raw;
};

const lineMatchKey = (row = {}) => {
    const pid = row.productId?._id || row.productId?.id || row.productId || "";
    const vid =
        row.productVariantId?._id ||
        row.productVariantId?.id ||
        row.productVariantId ||
        "";
    return `${String(pid)}|${String(vid)}|${String(row.sku || "")}|${String(row.variantLabel || "")}`;
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

const linesLooselyMatch = (a = {}, b = {}) => {
    const sa = softMatchKey(a);
    const sb = softMatchKey(b);
    if (sa !== "|" && sa === sb) return true;
    const nameA = String(a.productName || "").trim().toLowerCase();
    const nameB = String(b.productName || "").trim().toLowerCase();
    const varA = String(a.variantLabel || "").trim().toLowerCase();
    const varB = String(b.variantLabel || "").trim().toLowerCase();
    if (nameA && nameA === nameB && varA === varB) return true;
    const skuA = String(a.sku || "").trim().toLowerCase();
    const skuB = String(b.sku || "").trim().toLowerCase();
    if (skuA && skuA === skuB) return true;
    return false;
};

const asNonNeg = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Effective supplier-sent qty for a PO line (item field + schedule + shipments). */
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

const summarizePoProgress = (po, damagedByKey = {}) => {
    let orderedQty = 0;
    let sentQty = 0;
    let receivedQty = 0;
    let damagedQty = 0;
    let orderedValue = 0;
    let sentValue = 0;
    let receivedValue = 0;
    let damagedValue = 0;
    for (const item of po.items || []) {
        const qty = Math.max(Number(item.quantity) || 0, 0);
        const sent = effectiveSupplierSentForItem(po, item);
        const recv = Math.max(Number(item.receivedQuantity) || 0, 0);
        const price = Math.max(Number(item.purchasePrice) || 0, 0);
        const fullKey = lineMatchKey(item);
        const softKey = softMatchKey(item);
        const poiKey =
            item._id || item.id ? `poi:${String(item._id || item.id)}` : null;
        const dmgFromItem = Math.max(Number(item.damagedQuantity) || 0, 0);
        const dmgFromBatches = Math.max(
            Number(damagedByKey[poiKey]) || 0,
            Number(damagedByKey[fullKey]) || 0,
            softKey !== "|" ? Number(damagedByKey[softKey]) || 0 : 0,
            0
        );
        // Prefer persisted PO damaged; fall back to GRN batch aggregation
        const dmg = Math.max(dmgFromItem, dmgFromBatches);
        orderedQty += qty;
        sentQty += sent;
        receivedQty += recv;
        damagedQty += dmg;
        orderedValue += qty * price;
        sentValue += sent * price;
        receivedValue += recv * price;
        damagedValue += dmg * price;
    }
    // Remaining = still need OK units (damaged does NOT fulfill the order)
    const remainingQty = Math.max(orderedQty - receivedQty, 0);
    const handledQty = receivedQty + damagedQty;
    const pendingFromSentQty = Math.max(sentQty - handledQty, 0);
    return {
        orderedQty,
        sentQty,
        receivedQty,
        damagedQty,
        handledQty,
        remainingQty,
        // Damaged units that still leave OK shortfall (need replacement send)
        replacementDueQty: Math.min(damagedQty, remainingQty),
        sentNotReceivedQty: pendingFromSentQty,
        pendingReceiveQty: pendingFromSentQty,
        grossReceivedQty: handledQty,
        orderedValue,
        sentValue,
        receivedValue,
        damagedValue,
        remainingValue: Math.max(orderedValue - receivedValue, 0),
        handledValue: receivedValue + damagedValue
    };
};

/** Aggregate accepted/damaged from GRN receive batches (global + per-phase). */
const aggregateReceiveFromGrns = (grns = []) => {
    const damagedByKey = {};
    const acceptedByKey = {};
    const byPhase = {}; // phase -> { acceptedByKey, damagedByKey }
    const receiveDates = [];

    const bump = (map, key, qty) => {
        if (!key || key === "|" || qty <= 0) return;
        map[key] = (map[key] || 0) + qty;
    };

    for (const grn of grns || []) {
        if (grn.receivedDate) receiveDates.push(grn.receivedDate);
        for (const batch of grn.receiveBatches || []) {
            if (batch.receivedAt) receiveDates.push(batch.receivedAt);
            const phaseNo = Number(batch.phase);
            const phaseBucket =
                Number.isFinite(phaseNo) && phaseNo > 0
                    ? (byPhase[phaseNo] ||
                          (byPhase[phaseNo] = {
                              acceptedByKey: {},
                              damagedByKey: {}
                          }))
                    : null;

            for (const line of batch.lines || []) {
                const key = lineMatchKey(line);
                const poiKey = line.purchaseOrderItemId
                    ? `poi:${String(line.purchaseOrderItemId)}`
                    : null;
                const storeKey = poiKey || key;
                const received = asNonNeg(line.receivedQuantity);
                const damaged = asNonNeg(line.damagedQuantity);
                const accepted = Math.max(
                    asNonNeg(line.acceptedQuantity) || received - damaged,
                    0
                );
                // One canonical key only (prefer PO item id) to avoid double-count.
                bump(acceptedByKey, storeKey, accepted);
                bump(damagedByKey, storeKey, damaged);
                if (phaseBucket) {
                    bump(phaseBucket.acceptedByKey, storeKey, accepted);
                    bump(phaseBucket.damagedByKey, storeKey, damaged);
                }
            }
        }
    }
    receiveDates.sort((a, b) => new Date(a) - new Date(b));
    return {
        damagedByKey,
        acceptedByKey,
        byPhase,
        firstReceivedAt: receiveDates[0] || null,
        lastReceivedAt: receiveDates.length
            ? receiveDates[receiveDates.length - 1]
            : null,
        receiveDates
    };
};

/** @deprecated alias kept for call sites */
const aggregateDamagedFromGrns = (grns = []) => {
    const agg = aggregateReceiveFromGrns(grns);
    return {
        damagedByKey: agg.damagedByKey,
        firstReceivedAt: agg.firstReceivedAt,
        lastReceivedAt: agg.lastReceivedAt,
        receiveDates: agg.receiveDates
    };
};

const findPoItemForAlloc = (alloc, items = []) => {
    const full = lineMatchKey(alloc);
    for (const item of items) {
        if (lineMatchKey(item) === full) return item;
    }
    const soft = softMatchKey(alloc);
    if (soft !== "|") {
        for (const item of items) {
            if (softMatchKey(item) === soft) return item;
        }
    }
    for (const item of items) {
        if (linesLooselyMatch(alloc, item)) return item;
    }
    return null;
};

const shipmentQtyForAlloc = (phaseShipments = [], alloc, item = null) => {
    let sum = 0;
    for (const s of phaseShipments) {
        for (const l of s.lines || []) {
            if (
                linesLooselyMatch(l, alloc) ||
                (item && linesLooselyMatch(l, item))
            ) {
                sum += asNonNeg(l.quantity);
            }
        }
    }
    return sum;
};

const takePool = (poolMap, keys, amount) => {
    const need = Math.max(amount, 0);
    if (need <= 0) return 0;
    // Direct keys first
    for (const key of keys) {
        if (!key || key === "|") continue;
        const avail = Math.max(Number(poolMap[key]) || 0, 0);
        if (avail <= 0) continue;
        const take = Math.min(avail, need);
        poolMap[key] = Math.max(avail - take, 0);
        return take;
    }
    // Soft fallback across map entries
    const softs = keys
        .map((k) => (k.includes("|") ? k.split("|").slice(0, 2).join("|") : k))
        .filter((k) => k && k !== "|");
    for (const [mapKey, availRaw] of Object.entries(poolMap)) {
        const avail = Math.max(Number(availRaw) || 0, 0);
        if (avail <= 0) continue;
        const mapSoft = mapKey.split("|").slice(0, 2).join("|");
        if (!softs.includes(mapSoft)) continue;
        const take = Math.min(avail, need);
        poolMap[mapKey] = Math.max(avail - take, 0);
        return take;
    }
    return 0;
};

const takeTagged = (taggedMap, keys) => {
    if (!taggedMap) return 0;
    for (const key of keys) {
        if (!key || key === "|") continue;
        const qty = asNonNeg(taggedMap[key]);
        if (qty <= 0) continue;
        taggedMap[key] = 0;
        return qty;
    }
    const softs = keys
        .map((k) => (k.includes("|") ? k.split("|").slice(0, 2).join("|") : k))
        .filter((k) => k && k !== "|");
    for (const [mapKey, availRaw] of Object.entries(taggedMap)) {
        const qty = asNonNeg(availRaw);
        if (qty <= 0) continue;
        const mapSoft = mapKey.split("|").slice(0, 2).join("|");
        if (!softs.includes(mapSoft)) continue;
        taggedMap[mapKey] = 0;
        return qty;
    }
    return 0;
};

/**
 * Build agreed delivery phases with ordered / sent / received / damaged.
 * Sent prefers alloc.sentQuantity, then shipment lines, then PO item sent.
 * Received/damaged prefer phase-tagged GRN batches, else FIFO against sent caps.
 */
const buildDeliveryPhases = (po, receiveAgg = {}) => {
    const items = po.items || [];
    const damagedByKey = receiveAgg.damagedByKey || {};
    const byPhase = receiveAgg.byPhase || {};

    const remainingRecv = {};
    const remainingDmg = {};
    for (const item of items) {
        const full = lineMatchKey(item);
        const soft = softMatchKey(item);
        const poiKey = item?._id || item?.id
            ? `poi:${String(item._id || item.id)}`
            : null;
        const storeKey = poiKey || full;
        const recv = asNonNeg(item.receivedQuantity);
        let dmg = asNonNeg(item.damagedQuantity);
        if (dmg <= 0) {
            dmg =
                asNonNeg(damagedByKey[storeKey]) ||
                asNonNeg(damagedByKey[full]) ||
                (() => {
                    for (const [k, v] of Object.entries(damagedByKey)) {
                        if (k.split("|").slice(0, 2).join("|") === soft) {
                            return asNonNeg(v);
                        }
                    }
                    return 0;
                })();
        }
        remainingRecv[storeKey] = (remainingRecv[storeKey] || 0) + recv;
        remainingDmg[storeKey] = (remainingDmg[storeKey] || 0) + dmg;
    }

    let phases = Array.isArray(po.supplierPartialSchedule)
        ? po.supplierPartialSchedule
        : [];

    if (!phases.length) {
        phases = [
            {
                phase: 1,
                dateFrom:
                    po.supplierExpectedDeliveryDate ||
                    po.expectedDeliveryDate ||
                    null,
                dateTo:
                    po.supplierExpectedDeliveryDate ||
                    po.expectedDeliveryDate ||
                    null,
                dueDate:
                    po.supplierExpectedDeliveryDate ||
                    po.expectedDeliveryDate ||
                    null,
                note:
                    po.supplierDeliveryType === "Partial"
                        ? ""
                        : "Complete delivery",
                isCompleted: items.every(
                    (i) =>
                        asNonNeg(i.supplierSentQuantity) + 0.0001 >=
                        asNonNeg(i.quantity)
                ),
                lineAllocations: items.map((i) => ({
                    productId: i.productId || null,
                    productVariantId: i.productVariantId || null,
                    productName: i.productName || "",
                    variantLabel: i.variantLabel || "",
                    sku: i.sku || "",
                    quantity: asNonNeg(i.quantity),
                    sentQuantity: asNonNeg(i.supplierSentQuantity)
                }))
            }
        ];
    }

    const shipments = Array.isArray(po.supplierShipments)
        ? po.supplierShipments
        : [];

    return phases.map((phase, idx) => {
        const phaseNo = Number(phase.phase) || idx + 1;
        const phaseShipments = shipments.filter(
            (s) =>
                Number(s.phase) === phaseNo ||
                (s.phase == null && phases.length === 1)
        );
        const phaseTagged = byPhase[phaseNo] || null;
        const lines = [];
        let agreedQty = 0;
        let sentQty = 0;
        let receivedQty = 0;
        let damagedQty = 0;
        let grossReceivedQty = 0;
        let pendingReceiveQty = 0;
        let agreedValue = 0;
        let sentValue = 0;
        let receivedValue = 0;
        let damagedValue = 0;

        for (const alloc of phase.lineAllocations || []) {
            const item = findPoItemForAlloc(alloc, items);
            const fullKey = item ? lineMatchKey(item) : lineMatchKey(alloc);
            const softKey = item ? softMatchKey(item) : softMatchKey(alloc);
            const poiKey = item?._id || item?.id
                ? `poi:${String(item._id || item.id)}`
                : null;
            const lookupKeys = [poiKey, fullKey, softKey].filter(
                (k, i, arr) => k && k !== "|" && arr.indexOf(k) === i
            );
            const price = Math.max(
                Number(item?.purchasePrice) || Number(alloc.purchasePrice) || 0,
                0
            );
            const agreed = asNonNeg(alloc.quantity);

            let sent = asNonNeg(alloc.sentQuantity);
            if (sent <= 0) {
                sent = shipmentQtyForAlloc(phaseShipments, alloc, item);
            }
            if (sent <= 0 && phases.length === 1 && item) {
                sent = asNonNeg(item.supplierSentQuantity);
            }
            // Never attribute more than agreed on this phase
            if (agreed > 0) sent = Math.min(sent, agreed);

            let recv = 0;
            let dmg = 0;
            if (phaseTagged) {
                recv = takeTagged(phaseTagged.acceptedByKey, lookupKeys);
                dmg = takeTagged(phaseTagged.damagedByKey, lookupKeys);
                // CRITICAL: if tagged keys miss (null productId / sku drift),
                // fall back to FIFO against PO accepted+damaged pools.
                if (recv <= 0 && dmg <= 0) {
                    const receiveCap = sent;
                    recv = takePool(remainingRecv, lookupKeys, receiveCap);
                    dmg = takePool(
                        remainingDmg,
                        lookupKeys,
                        Math.max(receiveCap - recv, 0)
                    );
                } else {
                    const grossTagged = recv + dmg;
                    if (sent > 0 && grossTagged > sent + 0.0001) {
                        const scale = sent / grossTagged;
                        recv *= scale;
                        dmg *= scale;
                    }
                    takePool(remainingRecv, lookupKeys, recv);
                    takePool(remainingDmg, lookupKeys, dmg);
                }
            } else {
                const receiveCap = sent;
                recv = takePool(remainingRecv, lookupKeys, receiveCap);
                dmg = takePool(
                    remainingDmg,
                    lookupKeys,
                    Math.max(receiveCap - recv, 0)
                );
            }

            const gross = recv + dmg;
            const pending = Math.max(sent - gross, 0);
            const remaining = Math.max(agreed - gross, 0);

            agreedQty += agreed;
            sentQty += sent;
            receivedQty += recv;
            damagedQty += dmg;
            grossReceivedQty += gross;
            pendingReceiveQty += pending;
            agreedValue += agreed * price;
            sentValue += sent * price;
            receivedValue += recv * price;
            damagedValue += dmg * price;

            lines.push({
                purchaseOrderItemId: item?._id || item?.id || null,
                productId: alloc.productId || item?.productId || null,
                productVariantId:
                    alloc.productVariantId || item?.productVariantId || null,
                productName: alloc.productName || item?.productName || "",
                variantLabel: alloc.variantLabel || item?.variantLabel || "",
                sku: alloc.sku || item?.sku || "",
                purchasePrice: price,
                agreedQty: agreed,
                sentQty: sent,
                receivedQty: recv,
                damagedQty: dmg,
                grossReceivedQty: gross,
                pendingReceiveQty: pending,
                remainingQty: remaining,
                agreedValue: agreed * price,
                sentValue: sent * price,
                receivedValue: recv * price,
                damagedValue: dmg * price
            });
        }

        const shipmentQty = phaseShipments.reduce((sum, s) => {
            for (const l of s.lines || []) {
                sum += asNonNeg(l.quantity);
            }
            return sum;
        }, 0);
        const effectiveSent =
            sentQty > 0 ? sentQty : Math.min(shipmentQty, agreedQty || shipmentQty);
        const isReceiveComplete =
            effectiveSent > 0 &&
            grossReceivedQty + 0.0001 >= effectiveSent &&
            pendingReceiveQty <= 0.0001;

        return {
            phase: phaseNo,
            dateFrom: phase.dateFrom || null,
            dateTo: phase.dateTo || phase.dueDate || null,
            dueDate: phase.dueDate || phase.dateTo || null,
            note: phase.note || "",
            isSentCompleted: !!phase.isCompleted,
            isReceiveComplete,
            completedAt: phase.completedAt || null,
            lines,
            shipments: phaseShipments.map((s) => ({
                sentAt: s.sentAt || null,
                transferDaysMin: Number(s.transferDaysMin) || 0,
                transferDaysMax: Number(s.transferDaysMax) || 0,
                deliveryMode: s.deliveryMode || "",
                phase: s.phase == null ? phaseNo : Number(s.phase),
                note: s.note || "",
                varianceReason: s.varianceReason || "",
                quantity: (s.lines || []).reduce(
                    (n, l) => n + asNonNeg(l.quantity),
                    0
                ),
                lines: s.lines || []
            })),
            totals: {
                agreedQty,
                orderedQty: agreedQty,
                sentQty: effectiveSent,
                receivedQty,
                damagedQty,
                grossReceivedQty,
                pendingReceiveQty,
                remainingQty: Math.max(agreedQty - grossReceivedQty, 0),
                sentNotReceivedQty: pendingReceiveQty,
                agreedValue,
                sentValue,
                receivedValue,
                damagedValue,
                remainingValue: Math.max(
                    agreedValue - receivedValue - damagedValue,
                    0
                )
            }
        };
    });
};

const buildPoContext = (po, grns = []) => {
    if (!po) return null;
    const plain = typeof po.toObject === "function" ? po.toObject() : po;
    const supplier =
        plain.supplierId && typeof plain.supplierId === "object"
            ? {
                  id: String(plain.supplierId._id || plain.supplierId.id || ""),
                  name: plain.supplierId.name || "",
                  supplierCode: plain.supplierId.supplierCode || ""
              }
            : {
                  id: plain.supplierId ? String(plain.supplierId) : "",
                  name: "",
                  supplierCode: ""
              };

    const grandTotal = Math.max(Number(plain.grandTotal) || 0, 0);
    const schedule = Array.isArray(plain.supplierPaymentSchedule)
        ? plain.supplierPaymentSchedule.map((p) => {
              const planned = plannedPaymentAmount(p, grandTotal);
              const paidAmt = Math.max(Number(p.paidAmount) || 0, 0);
              const isPaid =
                  p.isPaid === true || (planned > 0 && paidAmt + 0.0001 >= planned);
              return {
                  phase: Number(p.phase) || 1,
                  amount: Number(p.amount) || 0,
                  amountType: p.amountType || "Fixed",
                  plannedAmount: planned,
                  paidAmount: paidAmt,
                  remainingAmount: Math.max(planned - paidAmt, 0),
                  isPaid,
                  method: p.method || "",
                  dueDate: p.dueDate || null,
                  note: p.note || "",
                  paymentRef: p.paymentRef || "",
                  paidAt: p.paidAt || null
              };
          })
        : [];

    const receiveAgg = aggregateReceiveFromGrns(grns);
    const { damagedByKey, firstReceivedAt, lastReceivedAt, receiveDates } =
        receiveAgg;
    const progress = summarizePoProgress(plain, damagedByKey);
    const deliveryPhases = buildDeliveryPhases(plain, receiveAgg);

    return {
        purchaseOrderId: String(plain._id || plain.id || ""),
        purchaseOrderNo: plain.purchaseOrderNo || "",
        orderDate: plain.orderDate || null,
        expectedDeliveryDate: plain.expectedDeliveryDate || null,
        status: plain.status || "",
        grandTotal,
        paidAmount: Math.max(Number(plain.paidAmount) || 0, 0),
        dueAmount: Math.max(Number(plain.dueAmount) || 0, 0),
        paymentStatus: plain.paymentStatus || "Pending",
        supplier,
        supplierExpectedDeliveryDate: plain.supplierExpectedDeliveryDate || null,
        supplierDeliveryType: plain.supplierDeliveryType || "",
        supplierPaymentType: plain.supplierPaymentType || "",
        supplierPaymentMethod: plain.supplierPaymentMethod || "",
        supplierPartialSchedule: plain.supplierPartialSchedule || [],
        supplierShipments: plain.supplierShipments || [],
        supplierPaymentSchedule: schedule,
        deliveryPhases,
        grnReceivedDates: receiveDates,
        firstGrnReceivedAt: firstReceivedAt,
        lastGrnReceivedAt: lastReceivedAt,
        progress
    };
};

const enrichGrnDoc = (grn, poContext = null) => {
    if (!grn) return grn;
    const obj = typeof grn.toObject === "function" ? grn.toObject() : grn;
    for (const line of obj.items || []) {
        line.trackingType = resolveTrackingType(line.trackingType);
        const product = line.productId;
        if (product && typeof product === "object") {
            if (!line.barcode && product.barcode) line.barcode = product.barcode;
            if (!line.sku && product.sku) line.sku = product.sku;
            if (!line.productName && product.name) line.productName = product.name;
        }
        const variant = line.productVariantId;
        if (variant && typeof variant === "object") {
            if (!line.barcode && variant.barcode) line.barcode = variant.barcode;
            if (!line.sku && variant.sku) line.sku = variant.sku;
        }
        // Prefer explicit receivableNow; fall back to orderedQuantity (session cap).
        if (line.receivableNow == null || line.receivableNow === "") {
            line.receivableNow = Math.max(Number(line.orderedQuantity) || 0, 0);
        }
    }
    if (poContext) {
        obj.context = poContext;
    }
    return obj;
};

const loadPoForGrnContext = async (purchaseOrderId) => {
    if (!purchaseOrderId) return null;
    return PurchaseOrder.findOne({ _id: purchaseOrderId, ...NOT_DELETED })
        .populate("supplierId", "supplierCode name companyName phone")
        .lean();
};

const loadGrnsForPoContext = async (purchaseOrderId) => {
    if (!purchaseOrderId) return [];
    return GRN.find({ purchaseOrderId, ...NOT_DELETED })
        .select("grnNumber status receivedDate receiveBatches")
        .lean();
};

const buildPoContextForId = async (purchaseOrderId) => {
    const po = await loadPoForGrnContext(purchaseOrderId);
    if (!po) return null;
    const grns = await loadGrnsForPoContext(purchaseOrderId);
    return buildPoContext(po, grns);
};

const findGrnOrFail = async (id, session = null) => {
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new AppError("Invalid GRN id.", 400);
    }
    const q = GRN.findOne({ _id: id, ...NOT_DELETED });
    if (session) q.session(session);
    const grn = await q;
    if (!grn) throw new AppError("GRN not found.", 404);
    return grn;
};

const loadProductMeta = async (productId) => {
    if (!productId) return null;
    return Product.findOne({ _id: productId, ...NOT_DELETED })
        .select("name trackingType barcode sku productCode hasVariants")
        .lean();
};

/** Build draft GRN lines from pending PO quantities + shipment context */
const buildLinesFromPo = async (po) => {
    const hasSupplier = Boolean(po.supplierId);
    const lines = [];
    for (const item of po.items || []) {
        const ordered = Math.max(Number(item.quantity) || 0, 0);
        const received = Math.max(Number(item.receivedQuantity) || 0, 0);
        const damaged = Math.max(Number(item.damagedQuantity) || 0, 0);
        const sent = hasSupplier
            ? effectiveSupplierSentForItem(po, item)
            : Math.max(Number(item.supplierSentQuantity) || 0, 0);
        // Only OK units fulfill the order — damaged needs replacement
        const orderedPending = Math.max(ordered - received, 0);
        if (orderedPending <= 0) continue;

        // Physical inspect pending on what was shipped (accepted + damaged)
        const handled = received + damaged;
        let receivable = orderedPending;
        if (hasSupplier) {
            const sentPending = Math.max(sent - handled, 0);
            receivable = Math.min(orderedPending, sentPending);
        }
        if (receivable <= 0) continue;

        const product = await loadProductMeta(item.productId);
        const trackingType = item.trackingType
            ? resolveTrackingType(item.trackingType)
            : resolveTrackingType(product?.trackingType);

        lines.push({
            purchaseOrderItemId: item._id,
            productId: item.productId || null,
            productVariantId: item.productVariantId || null,
            trackingType,
            sku: item.sku || product?.sku || "",
            barcode: product?.barcode || item.barcode || "",
            productName: item.productName,
            variantLabel: item.variantLabel || "",
            // Cap for THIS receive session = shipped-not-yet-handled
            orderedQuantity: receivable,
            poOrderedQuantity: ordered,
            supplierSentQuantity: sent,
            poReceivedQuantity: received,
            receivableNow: receivable,
            receivedQuantity: 0,
            damagedQuantity: 0,
            acceptedQuantity: 0,
            rejectedQuantity: 0,
            purchasePrice: Number(item.purchasePrice) || 0,
            total: 0,
            imeis: [],
            remarks: ""
        });
    }
    return lines;
};

const snapshotReceiveBatch = (grn, actorId, opts = {}) => {
    const lines = [];
    let subtotal = 0;
    for (const item of grn.items || []) {
        const received = Math.max(Number(item.receivedQuantity) || 0, 0);
        const damaged = Math.max(Number(item.damagedQuantity) || 0, 0);
        const accepted = Math.max(
            Number(item.acceptedQuantity) || received - damaged,
            0
        );
        if (received <= 0 && damaged <= 0 && accepted <= 0) continue;
        const price = Math.max(Number(item.purchasePrice) || 0, 0);
        const lineTotal = accepted * price;
        subtotal += lineTotal;
        lines.push({
            purchaseOrderItemId: item.purchaseOrderItemId || null,
            productId: item.productId || null,
            productVariantId: item.productVariantId || null,
            productName: item.productName || "",
            variantLabel: item.variantLabel || "",
            sku: item.sku || "",
            receivedQuantity: received,
            damagedQuantity: damaged,
            acceptedQuantity: accepted,
            purchasePrice: price,
            imeis: Array.isArray(item.imeis)
                ? item.imeis.map((e) => String(e)).filter(Boolean)
                : []
        });
    }
    if (!lines.length) return null;
    const prev = Array.isArray(grn.receiveBatches) ? grn.receiveBatches.length : 0;
    const phaseNo = Number(opts.receivePhase);
    return {
        batchNo: prev + 1,
        receivedAt: new Date(),
        receivedBy: toObjectId(actorId),
        note: String(opts.note || "").trim(),
        phase:
            Number.isFinite(phaseNo) && phaseNo > 0 ? Math.floor(phaseNo) : null,
        lines,
        subtotal,
        grandTotal: subtotal
    };
};

const recalculateGrn = (grn) => {
    let subtotal = 0;
    let totalDamaged = 0;
    let totalAccepted = 0;

    for (const item of grn.items || []) {
        const received = Math.max(Number(item.receivedQuantity) || 0, 0);
        const damaged = Math.max(Number(item.damagedQuantity) || 0, 0);
        const accepted = Math.max(received - damaged, 0);
        item.acceptedQuantity = accepted;
        item.rejectedQuantity = damaged;
        item.total = accepted * (Number(item.purchasePrice) || 0);
        subtotal += item.total;
        totalDamaged += damaged;
        totalAccepted += accepted;
    }

    grn.subtotal = subtotal;
    grn.grandTotal = subtotal;
    grn.totalDamagedQuantity = totalDamaged;
    grn.totalAcceptedQuantity = totalAccepted;
};

const validateDraftLines = (grn) => {
    let anyReceive = false;
    for (const item of grn.items || []) {
        const received = Math.max(Number(item.receivedQuantity) || 0, 0);
        const damaged = Math.max(Number(item.damagedQuantity) || 0, 0);
        const ordered = Math.max(Number(item.orderedQuantity) || 0, 0);
        const alreadyHint = ordered; // remaining validated against PO on complete

        if (received > alreadyHint) {
            // soft: still allow if PO pending was lower — hard check on complete
        }
        if (damaged > received) {
            throw new AppError(
                `Damaged qty cannot exceed received for ${item.productName}.`,
                400
            );
        }
        if (item.trackingType === "IMEI") {
            const imeis = (item.imeis || [])
                .map(normalizeImei)
                .filter(Boolean);
            item.imeis = [...new Set(imeis)];
            const accepted = Math.max(received - damaged, 0);
            // Damaged units never enter ItemTrack — IMEI count must match accepted.
            if (accepted > 0 && item.imeis.length !== accepted) {
                throw new AppError(
                    `IMEI count must equal accepted qty (received − damaged) for ${item.productName} (${item.imeis.length}/${accepted}).`,
                    400
                );
            }
            if (accepted <= 0 && item.imeis.length > 0) {
                throw new AppError(
                    `Remove IMEIs for ${item.productName} when accepted qty is 0.`,
                    400
                );
            }
        }
        if (received > 0) anyReceive = true;
    }
    if (!anyReceive) {
        throw new AppError("Enter received quantity for at least one line.", 400);
    }
};

const assertImeiUnique = async (imeis, session) => {
    if (!imeis.length) return;
    const existing = await ItemTrack.find({
        imei: { $in: imeis },
        status: { $ne: "deleted" }
    })
        .session(session)
        .select("imei")
        .lean();
    if (existing.length) {
        throw new AppError(
            `Duplicate IMEI: ${existing.map((e) => e.imei).join(", ")}`,
            400
        );
    }
};

const upsertInventory = async ({
    warehouseId,
    branchId,
    productId,
    productVariantId,
    qty,
    purchasePrice,
    grnId,
    session
}) => {
    if (!productId || qty <= 0) return null;

    const filter = {
        warehouseId,
        productId,
        productVariantId: productVariantId || null,
        isDeleted: { $ne: true }
    };

    let inv = await Inventory.findOne(filter).session(session);
    if (!inv) {
        // Prefer reactivating a soft-deleted row over unique-index clash
        const soft = await Inventory.findOne({
            warehouseId,
            productId,
            productVariantId: productVariantId || null,
            isDeleted: true
        }).session(session);
        if (soft) {
            soft.isDeleted = false;
            soft.deletedAt = null;
            soft.deletedBy = null;
            soft.status = "Active";
            inv = soft;
        }
    }
    if (!inv) {
        inv = new Inventory({
            warehouseId,
            branchId: branchId || null,
            productId,
            productVariantId: productVariantId || null,
            currentStock: 0,
            availableStock: 0,
            reservedStock: 0
        });
    } else if (branchId && !inv.branchId) {
        inv.branchId = branchId;
    }

    const previous = Number(inv.currentStock) || 0;
    inv.currentStock = previous + qty;
    inv.availableStock =
        Math.max(Number(inv.availableStock) || 0, 0) + qty;
    inv.lastPurchasePrice = purchasePrice;
    inv.lastStockInDate = new Date();
    inv.lastGRN = grnId;
    if (!inv.averageCost || previous <= 0) {
        inv.averageCost = purchasePrice;
    } else {
        inv.averageCost =
            (inv.averageCost * previous + purchasePrice * qty) /
            (previous + qty);
    }
    // Value after averageCost is updated
    inv.inventoryValue =
        (Number(inv.averageCost) || purchasePrice) * inv.currentStock;

    const avail = Number(inv.availableStock) || 0;
    const reorder = Number(inv.reorderLevel) || 0;
    if (avail <= 0) inv.stockStatus = "Out Of Stock";
    else if (reorder > 0 && avail <= reorder) inv.stockStatus = "Low Stock";
    else inv.stockStatus = "In Stock";

    await inv.save({ session });
    return { inv, previous, current: inv.currentStock };
};

const createStockMovement = async ({
    warehouseId,
    branchId,
    productId,
    productVariantId,
    sku,
    productName,
    qty,
    previousStock,
    currentStock,
    purchasePrice,
    grnId,
    actorId,
    session
}) => {
    if (!productId || qty <= 0) return null;
    const movementNumber = await generateStockMovementCode();
    const [doc] = await StockMovement.create(
        [
            {
                movementNumber,
                movementDate: new Date(),
                warehouseId,
                branchId: branchId || null,
                productId,
                productVariantId: productVariantId || null,
                sku: sku || "",
                productName,
                movementType: "Purchase",
                movementDirection: "IN",
                quantity: qty,
                previousStock,
                currentStock,
                unitCost: purchasePrice,
                totalCost: purchasePrice * qty,
                referenceType: "GRN",
                grnId,
                remarks: "Stock in from GRN",
                createdBy: actorId || null
            }
        ],
        { session }
    );
    return doc;
};

/**
 * New-product PO lines may arrive without productId.
 * On GRN complete, create (or reuse by name) a catalog product and link it.
 */
const ensureProductForGrnLine = async (
    line,
    actorId,
    purchaseOrderId,
    purchaseOrderNo,
    session
) => {
    if (line.productId) {
        // If IMEI and variant missing, create a default variant under existing product
        if (
            resolveTrackingType(line.trackingType) === "IMEI" &&
            !line.productVariantId
        ) {
            const variant = await createDefaultVariantForProduct(
                line.productId,
                line,
                session
            );
            line.productVariantId = variant._id;
            if (!line.sku && variant.sku) line.sku = variant.sku;
        }
        return line;
    }

    const name = String(line.productName || "").trim();
    if (!name) {
        throw new AppError(
            "Cannot complete GRN: a line has no product name and no productId.",
            400
        );
    }

    const trackingType = resolveTrackingType(line.trackingType);
    const purchasePrice = Math.max(Number(line.purchasePrice) || 0, 0);

    // Reuse existing catalog product with same name when possible
    let product = await Product.findOne({
        name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
        ...NOT_DELETED
    }).session(session);

    if (!product) {
        const productCode = await generateProductCode();
        let barcode = "";
        let barcodeType = "None";
        if (trackingType === "Non-IMEI") {
            barcode = await generateProductBarcode();
            barcodeType = "EAN13";
        }

        const [created] = await Product.create(
            [
                {
                    name,
                    productCode,
                    sku: (line.sku || "").toString().trim().toUpperCase(),
                    slug: name
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "-")
                        .replace(/(^-|-$)/g, ""),
                    trackingType,
                    productType: trackingType === "IMEI" ? "Variant" : "Simple",
                    hasVariants: trackingType === "IMEI",
                    barcode,
                    barcodeType,
                    barcodeGeneratedAt: barcode ? new Date() : null,
                    purchasePrice,
                    sellingPrice: purchasePrice,
                    approvalStatus: "Approved",
                    approvalRequired: false,
                    approvedAt: new Date(),
                    approvedBy: toObjectId(actorId),
                    createdBy: toObjectId(actorId),
                    vendorId: toObjectId(actorId),
                    uploadedByType: "Owner",
                    uploadedById: toObjectId(actorId),
                    uploadedAt: new Date(),
                    productSourceType: "PurchaseOrder",
                    ownershipType: "Owned",
                    sourcePurchaseOrderId: purchaseOrderId || null,
                    sourcePurchaseOrderItemId: line.purchaseOrderItemId || null,
                    sourcePurchaseOrderNo: purchaseOrderNo || ""
                }
            ],
            { session }
        );
        product = created;
    }

    line.productId = product._id;
    if (!line.sku && product.sku) line.sku = product.sku;
    if (!line.barcode && product.barcode) line.barcode = product.barcode;
    line.trackingType = trackingType;

    if (trackingType === "IMEI" && !line.productVariantId) {
        const variant = await createDefaultVariantForProduct(
            product._id,
            line,
            session
        );
        line.productVariantId = variant._id;
        if (!line.sku && variant.sku) line.sku = variant.sku;
    }

    return line;
};

const createDefaultVariantForProduct = async (productId, line, session) => {
    // Prefer an existing default / only variant
    const existing = await ProductVariant.findOne({
        productId,
        isDeleted: { $ne: true }
    })
        .sort({ createdAt: 1 })
        .session(session);
    if (existing) return existing;

    const purchasePrice = Math.max(Number(line.purchasePrice) || 0, 0);
    const sku =
        (line.sku || "").toString().trim().toUpperCase() ||
        (await generateProductVariantCode());

    const [variant] = await ProductVariant.create(
        [
            {
                productId,
                attributes: [],
                combinationString: "Default",
                sku,
                purchasePrice,
                costPrice: purchasePrice,
                sellingPrice: purchasePrice,
                price: purchasePrice,
                quantity: 0
            }
        ],
        { session }
    );

    await Product.updateOne(
        { _id: productId },
        {
            $set: {
                hasVariants: true,
                productType: "Variant"
            }
        },
        { session }
    );

    return variant;
};

const applyInventoryForGrn = async (grn, actorId, session) => {
    const productIds = new Set();
    const allImeis = [];

    // Link / create products for New-product lines before stock update
    for (const item of grn.items || []) {
        const accepted = Math.max(Number(item.acceptedQuantity) || 0, 0);
        if (accepted <= 0) continue;
        await ensureProductForGrnLine(
            item,
            actorId,
            grn.purchaseOrderId || null,
            grn.purchaseOrderNo || "",
            session
        );
    }

    for (const item of grn.items || []) {
        const accepted = Math.max(Number(item.acceptedQuantity) || 0, 0);
        if (accepted <= 0) continue;

        if (item.trackingType === "IMEI") {
            const imeis = (item.imeis || []).map(normalizeImei).filter(Boolean);
            if (imeis.length !== accepted) {
                throw new AppError(
                    `IMEI count mismatch for ${item.productName}.`,
                    400
                );
            }
            allImeis.push(...imeis);
        }
    }

    await assertImeiUnique(allImeis, session);

    for (const item of grn.items || []) {
        const accepted = Math.max(Number(item.acceptedQuantity) || 0, 0);
        if (accepted <= 0) continue;
        if (!item.productId) {
            throw new AppError(
                `Product link missing for ${item.productName}. Create or link a product on this line, then complete again.`,
                400
            );
        }

        const stockResult = await upsertInventory({
            warehouseId: grn.warehouseId,
            branchId: grn.branchId,
            productId: item.productId,
            productVariantId: item.productVariantId,
            qty: accepted,
            purchasePrice: Number(item.purchasePrice) || 0,
            grnId: grn._id,
            session
        });

        await createStockMovement({
            warehouseId: grn.warehouseId,
            branchId: grn.branchId,
            productId: item.productId,
            productVariantId: item.productVariantId,
            sku: item.sku,
            productName: item.productName,
            qty: accepted,
            previousStock: stockResult?.previous || 0,
            currentStock: stockResult?.current || accepted,
            purchasePrice: Number(item.purchasePrice) || 0,
            grnId: grn._id,
            actorId,
            session
        });

        if (item.trackingType === "IMEI") {
            const imeis = (item.imeis || []).map(normalizeImei).filter(Boolean);
            if (!item.productVariantId) {
                throw new AppError(
                    `Variant required for IMEI product ${item.productName}.`,
                    400
                );
            }
            const rows = imeis.map((imei) => ({
                imei,
                productId: item.productId,
                variantId: item.productVariantId,
                vendorId: actorId,
                currentBranchId: grn.branchId || null,
                status: "available",
                history: [
                    {
                        status: "available",
                        branchId: grn.branchId || null,
                        updatedBy: actorId,
                        date: new Date(),
                        notes: `GRN ${grn.grnNumber}`
                    }
                ]
            }));
            await ItemTrack.insertMany(rows, { session });
        }

        productIds.add(String(item.productId));
    }

    // Persist any newly linked productIds on the GRN document
    await grn.save({ session });

    // Also back-fill PO lines so future GRNs inherit the product link
    if (grn.purchaseOrderId) {
        const po = await PurchaseOrder.findOne({
            _id: grn.purchaseOrderId,
            ...NOT_DELETED
        }).session(session);
        if (po) {
            let poDirty = false;
            for (const gItem of grn.items || []) {
                if (!gItem.productId || !gItem.purchaseOrderItemId) continue;
                const poItem = (po.items || []).id(gItem.purchaseOrderItemId);
                if (!poItem) continue;
                if (!poItem.productId) {
                    poItem.productId = gItem.productId;
                    poDirty = true;
                }
                if (!poItem.productVariantId && gItem.productVariantId) {
                    poItem.productVariantId = gItem.productVariantId;
                    poDirty = true;
                }
                if (gItem.trackingType && !poItem.trackingType) {
                    poItem.trackingType = gItem.trackingType;
                    poDirty = true;
                }
            }
            if (poDirty) await po.save({ session });
        }
    }

    return [...productIds];
};

const applyPoReceiving = async (grn, session) => {
    const po = await PurchaseOrder.findOne({
        _id: grn.purchaseOrderId,
        ...NOT_DELETED
    }).session(session);
    if (!po) throw new AppError("Linked purchase order not found.", 404);

    for (const gItem of grn.items || []) {
        const received = Math.max(Number(gItem.receivedQuantity) || 0, 0);
        const damaged = Math.max(Number(gItem.damagedQuantity) || 0, 0);
        const accepted = Math.max(
            Number(gItem.acceptedQuantity) || received - damaged,
            0
        );
        if (accepted <= 0 && damaged <= 0) continue;

        let poItem = null;
        if (gItem.purchaseOrderItemId) {
            poItem = (po.items || []).find(
                (i) => String(i._id) === String(gItem.purchaseOrderItemId)
            );
        }
        if (!poItem) {
            poItem = (po.items || []).find(
                (i) =>
                    String(i.productId) === String(gItem.productId) &&
                    String(i.productVariantId || "") ===
                        String(gItem.productVariantId || "")
            );
        }
        if (!poItem) {
            throw new AppError(
                `PO line not found for ${gItem.productName}.`,
                400
            );
        }

        const prevRecv = Math.max(Number(poItem.receivedQuantity) || 0, 0);
        const prevDmg = Math.max(Number(poItem.damagedQuantity) || 0, 0);
        const ordered = Math.max(Number(poItem.quantity) || 0, 0);
        const maxAccept = Math.max(ordered - prevRecv, 0);
        if (accepted > maxAccept + 1e-9) {
            throw new AppError(
                `Cannot accept ${accepted} of ${gItem.productName}; only ${maxAccept} OK units still needed on PO.`,
                400
            );
        }

        poItem.receivedQuantity = prevRecv + accepted;
        poItem.damagedQuantity = prevDmg + damaged;
        // Pending OK units still owed (damaged does not fulfill ordered qty)
        poItem.pendingQuantity = Math.max(
            ordered - poItem.receivedQuantity,
            0
        );
    }

    if (!po.grnIds) po.grnIds = [];
    if (!po.grnIds.some((id) => String(id) === String(grn._id))) {
        po.grnIds.push(grn._id);
    }

    let totalQty = 0;
    let acceptedQty = 0;
    let damagedQty = 0;
    let receivedAmount = 0;
    for (const item of po.items || []) {
        const ordered = Number(item.quantity) || 0;
        const recv = Number(item.receivedQuantity) || 0;
        const dmg = Number(item.damagedQuantity) || 0;
        totalQty += ordered;
        acceptedQty += recv;
        damagedQty += dmg;
        receivedAmount += recv * (Number(item.purchasePrice) || 0);
    }
    po.totalReceivedAmount = receivedAmount;

    // Complete only when all ordered units are Received OK (not damaged)
    if (acceptedQty <= 0 && damagedQty <= 0) {
        po.status = po.supplierId ? "Agreed" : "Ordered";
        po.isFullyReceived = false;
        grn.purchaseStatus = "Pending";
    } else if (acceptedQty + 0.0001 < totalQty) {
        po.status = "Partially Received";
        po.isFullyReceived = false;
        grn.purchaseStatus = "Partially Received";
    } else {
        po.status = "Completed";
        po.isFullyReceived = true;
        grn.purchaseStatus = "Completed";
    }

    await po.save({ session });
    return po;
};

// ==========================================================
// Public API
// ==========================================================

const listReceivablePurchaseOrders = async (query = {}) => {
    // Only POs with an OPEN GRN (not Completed) — one GRN per PO lifecycle.
    const openGrns = await GRN.find({
        ...NOT_DELETED,
        purchaseOrderId: { $ne: null },
        status: { $in: EDITABLE_GRN },
        inventoryUpdated: { $ne: true }
    })
        .select("grnNumber purchaseOrderId status purchaseStatus")
        .lean();

    if (!openGrns.length) {
        return { items: [] };
    }

    const openByPo = new Map(
        openGrns.map((g) => [String(g.purchaseOrderId), g])
    );
    const openPoIds = [...openByPo.keys()].map((id) => toObjectId(id)).filter(Boolean);

    const filter = {
        ...NOT_DELETED,
        status: { $in: RECEIVABLE_PO },
        _id: { $in: openPoIds }
    };
    if (query.search) {
        const search = escapeRegex(String(query.search).trim());
        filter.$or = [
            { purchaseOrderNo: { $regex: search, $options: "i" } },
            { referenceNumber: { $regex: search, $options: "i" } },
            { referenceNo: { $regex: search, $options: "i" } }
        ];
    }

    const items = await PurchaseOrder.find(filter)
        .sort({ orderDate: -1 })
        .limit(Math.min(parseInt(query.limit, 10) || 50, 100))
        .populate("supplierId", "supplierCode name")
        .populate("warehouseId", "warehouseCode warehouseName")
        .lean();

    return {
        items: items
            .map((po) => {
                const open = openByPo.get(String(po._id));
                const hasSupplier = Boolean(po.supplierId);
                const pendingLines = (po.items || []).filter((i) => {
                    const ordered = Math.max(Number(i.quantity) || 0, 0);
                    const received = Math.max(Number(i.receivedQuantity) || 0, 0);
                    const orderedPending = Math.max(ordered - received, 0);
                    if (orderedPending <= 0) return false;
                    if (!hasSupplier) return true;
                    const sent = Math.max(Number(i.supplierSentQuantity) || 0, 0);
                    return sent - received > 0;
                }).length;
                const progress = summarizePoProgress(po);
                return {
                    ...po,
                    pendingLines,
                    openGrnId: open?._id || null,
                    openGrnNumber: open?.grnNumber || null,
                    hasOpenGrn: Boolean(open),
                    grnPurchaseStatus: open?.purchaseStatus || "Pending",
                    sentQty: progress.sentQty,
                    receivedQty: progress.receivedQty,
                    remainingQty: progress.remainingQty
                };
            })
            .filter((po) => po.pendingLines > 0 && po.hasOpenGrn)
    };
};

const createGrnFromPurchaseOrder = async (payload = {}, actorId = null) => {
    const poId = toObjectId(payload.purchaseOrderId || payload.poId);
    if (!poId) throw new AppError("purchaseOrderId is required.", 400);

    const createdBy = toObjectId(actorId) || toObjectId(payload.createdBy);
    if (!createdBy) {
        throw new AppError("Creator (createdBy / auth user) is required.", 400);
    }

    const po = await PurchaseOrder.findOne({ _id: poId, ...NOT_DELETED });
    if (!po) throw new AppError("Purchase order not found.", 404);

    // With supplier: GRN only after goods are sent (not merely accepted).
    // Without supplier: Ordered / receive stages.
    const allowed = po.supplierId ? SUPPLIER_GRN_READY : NO_SUPPLIER_GRN_READY;
    if (!allowed.includes(po.status)) {
        throw new AppError(
            po.supplierId
                ? "GRN can only be created after the supplier sends goods (Partially/Completely Delivered), or when receiving has already started."
                : "GRN can only be created from Ordered or Partially Received purchase orders.",
            400
        );
    }

    if (po.supplierId) {
        const anySent = (po.items || []).some(
            (i) => Math.max(Number(i.supplierSentQuantity) || 0, 0) > 0
        );
        if (!anySent) {
            throw new AppError(
                "Supplier has not sent any products yet. Wait until goods are sent, then create GRN.",
                400
            );
        }
    }

    // One open GRN per PO — reopen Draft / Pending instead of creating duplicates
    const existingOpen = await GRN.findOne({
        purchaseOrderId: poId,
        ...NOT_DELETED,
        status: { $in: EDITABLE_GRN },
        inventoryUpdated: { $ne: true }
    }).sort({ createdAt: -1 });

    const refreshAndReturn = async (grnDoc, { reopen = false } = {}) => {
        const freshLines = await buildLinesFromPo(po);
        const byPoItem = new Map();
        for (const line of grnDoc.items || []) {
            const key = String(line.purchaseOrderItemId || "");
            if (key) byPoItem.set(key, line);
        }

        const merged = [];
        for (const fresh of freshLines) {
            const key = String(fresh.purchaseOrderItemId || "");
            const prev = key ? byPoItem.get(key) : null;
            if (prev && !reopen) {
                const received = Math.max(Number(prev.receivedQuantity) || 0, 0);
                const damaged = Math.max(Number(prev.damagedQuantity) || 0, 0);
                const ordered = Math.max(Number(fresh.orderedQuantity) || 0, 0);
                prev.orderedQuantity = Math.max(ordered, received);
                prev.poOrderedQuantity = fresh.poOrderedQuantity;
                prev.supplierSentQuantity = fresh.supplierSentQuantity;
                prev.poReceivedQuantity = fresh.poReceivedQuantity;
                prev.receivableNow = fresh.receivableNow;
                prev.productId = fresh.productId || prev.productId;
                prev.productVariantId =
                    fresh.productVariantId || prev.productVariantId;
                prev.trackingType = fresh.trackingType || prev.trackingType;
                prev.sku = fresh.sku || prev.sku;
                prev.barcode = fresh.barcode || prev.barcode;
                prev.productName = fresh.productName || prev.productName;
                prev.variantLabel = fresh.variantLabel || prev.variantLabel;
                prev.purchasePrice =
                    Number(fresh.purchasePrice) || Number(prev.purchasePrice) || 0;
                if (damaged > received) prev.damagedQuantity = received;
                if (
                    prev.trackingType === "IMEI" &&
                    Array.isArray(prev.imeis) &&
                    prev.imeis.length
                ) {
                    const accepted = Math.max(
                        received - Math.max(Number(prev.damagedQuantity) || 0, 0),
                        0
                    );
                    if (prev.imeis.length > accepted) {
                        prev.imeis = prev.imeis.slice(0, accepted);
                    }
                }
                merged.push(prev);
                byPoItem.delete(key);
            } else {
                merged.push(fresh);
            }
        }

        if (!reopen) {
            for (const leftover of byPoItem.values()) {
                if ((Number(leftover.receivedQuantity) || 0) > 0) {
                    merged.push(leftover);
                }
            }
        }

        grnDoc.items = merged;
        recalculateGrn(grnDoc);
        await grnDoc.save();

        if (!Array.isArray(po.grnIds)) po.grnIds = [];
        if (!po.grnIds.some((id) => String(id) === String(grnDoc._id))) {
            po.grnIds.push(grnDoc._id);
            await po.save();
        }

        const reused = await populateGrn(GRN.findById(grnDoc._id));
        const ctx = await buildPoContextForId(po._id);
        const plain = enrichGrnDoc(reused, ctx);
        plain.reusedExisting = true;
        return plain;
    };

    if (existingOpen) {
        return refreshAndReturn(existingOpen);
    }

    // Legacy: Completed-but-partial GRN — reopen same doc (never create a second).
    const existingAny = await GRN.findOne({
        purchaseOrderId: poId,
        ...NOT_DELETED,
        status: { $ne: "Cancelled" }
    }).sort({ createdAt: -1 });

    if (existingAny) {
        if (existingAny.status === "Completed" && po.isFullyReceived) {
            throw new AppError(
                "This purchase order already has a completed GRN and is fully received. Only one GRN is allowed per PO.",
                400
            );
        }
        existingAny.status = "Draft";
        existingAny.inventoryUpdated = false;
        existingAny.inventoryUpdatedAt = null;
        existingAny.inventoryUpdatedBy = null;
        const anyRecv = (po.items || []).some(
            (i) => Math.max(Number(i.receivedQuantity) || 0, 0) > 0
        );
        existingAny.purchaseStatus = po.isFullyReceived
            ? "Completed"
            : anyRecv
              ? "Partially Received"
              : "Pending";
        return refreshAndReturn(existingAny, { reopen: true });
    }

    const warehouseId =
        toObjectId(payload.warehouseId) ||
        toObjectId(po.warehouseId) ||
        (await resolveFallbackWarehouseId());
    if (!warehouseId) {
        throw new AppError(
            "No active warehouse was available to assign this GRN.",
            400
        );
    }

    const lines = await buildLinesFromPo(po);
    if (!lines.length) {
        throw new AppError(
            po.supplierId
                ? "Supplier has not sent remaining qty yet. Wait for a shipment, then create GRN."
                : "This purchase order has nothing left to receive.",
            400
        );
    }

    const owner = isOwnerActor(payload);
    const grn = new GRN({
        grnNumber: await generateGRNCode(),
        purchaseOrderId: po._id,
        supplierId: po.supplierId || null,
        warehouseId,
        branchId: toObjectId(payload.branchId) || po.branchId || null,
        referenceNumber: (payload.referenceNumber || "").toString().trim(),
        supplierInvoiceNo: (payload.supplierInvoiceNo || "").toString().trim(),
        receivedDate: payload.receivedDate
            ? new Date(payload.receivedDate)
            : new Date(),
        invoiceDate: payload.invoiceDate ? new Date(payload.invoiceDate) : null,
        items: lines,
        supplierNote: (payload.supplierNote || "").toString().trim(),
        internalNote: (payload.internalNote || "").toString().trim(),
        createdBy,
        status: "Draft",
        requiresApproval: !owner,
        qualityStatus: "Pending",
        purchaseStatus: "Pending"
    });

    recalculateGrn(grn);
    await grn.save();

    // Mark PO as GRN-started so it appears in GRN → Receive from PO list.
    if (!Array.isArray(po.grnIds)) po.grnIds = [];
    if (!po.grnIds.some((id) => String(id) === String(grn._id))) {
        po.grnIds.push(grn._id);
    }
    await po.save();

    const created = await populateGrn(GRN.findById(grn._id));
    const ctx = await buildPoContextForId(po._id);
    return enrichGrnDoc(created, ctx);
};

const getGrns = async (query = {}) => {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const trashMode = isTrashQuery(query);
    const filter = trashMode ? { isDeleted: true } : { ...NOT_DELETED };

    if (query.status) filter.status = query.status;
    if (query.purchaseOrderId) {
        filter.purchaseOrderId = toObjectId(query.purchaseOrderId);
    }
    if (query.warehouseId) filter.warehouseId = toObjectId(query.warehouseId);
    if (query.supplierId) filter.supplierId = toObjectId(query.supplierId);

    if (query.search) {
        const search = escapeRegex(String(query.search).trim());
        filter.$or = [
            { grnNumber: { $regex: search, $options: "i" } },
            { supplierInvoiceNo: { $regex: search, $options: "i" } },
            { referenceNumber: { $regex: search, $options: "i" } }
        ];
    }

    const sort = trash.resolveEntitySort(query);
    const [items, total] = await Promise.all([
        populateGrn(GRN.find(filter).sort(sort).skip(skip).limit(limit)),
        GRN.countDocuments(filter)
    ]);

    // Badge: supplier sent qty waiting to be received on open GRNs
    const poIds = [
        ...new Set(
            items
                .map((g) => String(g.purchaseOrderId?._id || g.purchaseOrderId || ""))
                .filter(Boolean)
        )
    ];
    const pos =
        poIds.length > 0
            ? await PurchaseOrder.find({
                  _id: { $in: poIds },
                  ...NOT_DELETED
              })
                  .select(
                      "items supplierId supplierPartialSchedule supplierShipments"
                  )
                  .lean()
            : [];
    const poById = new Map(pos.map((p) => [String(p._id), p]));

    const enriched = items.map((grn) => {
        const obj = enrichGrnDoc(grn);
        const status = String(obj.status || "");
        const done =
            status === "Completed" ||
            status === "Cancelled" ||
            obj.inventoryUpdated === true;
        let awaiting = 0;
        if (!done) {
            const poId = String(
                grn.purchaseOrderId?._id || grn.purchaseOrderId || ""
            );
            const po = poById.get(poId);
            if (po) {
                awaiting = awaitingReceiveQtyFromPo(po);
            } else {
                awaiting = (obj.items || []).reduce((s, i) => {
                    const cap = Math.max(
                        Number(i.receivableNow) || 0,
                        Number(i.orderedQuantity) || 0
                    );
                    return s + cap;
                }, 0);
            }
        }
        obj.awaitingReceiveQty = awaiting;
        obj.hasAwaitingReceive = awaiting > 0.0001;
        return obj;
    });

    return {
        items: enriched,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit) || 0
        },
        trash: trashMode
    };
};

/** Qty supplier sent that buyer has not yet handled (accepted + damaged). */
const awaitingReceiveQtyFromPo = (po) => {
    if (!po) return 0;
    const hasSupplier = Boolean(po.supplierId);
    let total = 0;
    for (const item of po.items || []) {
        const ordered = Math.max(Number(item.quantity) || 0, 0);
        const received = Math.max(Number(item.receivedQuantity) || 0, 0);
        const damaged = Math.max(Number(item.damagedQuantity) || 0, 0);
        const sent = hasSupplier
            ? effectiveSupplierSentForItem(po, item)
            : Math.max(Number(item.supplierSentQuantity) || 0, 0);
        const orderedPending = Math.max(ordered - received, 0);
        if (orderedPending <= 0) continue;
        const handled = received + damaged;
        const sentPending = Math.max(sent - handled, 0);
        total += Math.min(orderedPending, sentPending);
    }
    return total;
};

/** Rebuild Draft GRN line caps from current PO sent/received (after later phase sends). */
const syncDraftGrnLinesFromPo = async (grnDoc) => {
    if (!grnDoc) return grnDoc;
    if (!EDITABLE_GRN.includes(grnDoc.status) || grnDoc.inventoryUpdated) {
        return grnDoc;
    }
    const poId = grnDoc.purchaseOrderId?._id || grnDoc.purchaseOrderId;
    if (!poId) return grnDoc;

    const po = await PurchaseOrder.findOne({ _id: poId, ...NOT_DELETED });
    if (!po) return grnDoc;

    const freshLines = await buildLinesFromPo(po);
    const oldCap = (grnDoc.items || []).reduce(
        (s, i) => s + Math.max(Number(i.orderedQuantity) || 0, 0),
        0
    );
    const newCap = freshLines.reduce(
        (s, i) => s + Math.max(Number(i.orderedQuantity) || 0, 0),
        0
    );
    const oldCount = (grnDoc.items || []).length;
    const newCount = freshLines.length;

    // Nothing receivable and already empty — ok
    if (newCount === 0 && oldCount === 0) return grnDoc;

    // Caps / line set changed (typical: next phase sent after previous receive)
    if (
        oldCount !== newCount ||
        Math.abs(oldCap - newCap) > 0.0001 ||
        (newCount > 0 && oldCount === 0)
    ) {
        // Preserve in-progress draft qty for matching PO lines when possible
        const prevByPoItem = new Map();
        for (const line of grnDoc.items || []) {
            const key = String(line.purchaseOrderItemId || "");
            if (key) prevByPoItem.set(key, line);
        }
        grnDoc.items = freshLines.map((fresh) => {
            const prev = prevByPoItem.get(String(fresh.purchaseOrderItemId || ""));
            if (!prev) return fresh;
            const prevRecv = Math.max(Number(prev.receivedQuantity) || 0, 0);
            const prevDmg = Math.max(Number(prev.damagedQuantity) || 0, 0);
            const cap = Math.max(Number(fresh.orderedQuantity) || 0, 0);
            if (prevRecv <= 0 && prevDmg <= 0) return fresh;
            return {
                ...fresh,
                receivedQuantity: Math.min(prevRecv, cap),
                damagedQuantity: Math.min(prevDmg, cap),
                remarks: prev.remarks || "",
                imeis: Array.isArray(prev.imeis) ? prev.imeis : []
            };
        });
        grnDoc.markModified("items");
        recalculateGrn(grnDoc);
        const anyRecv = (po.items || []).some(
            (i) =>
                Math.max(Number(i.receivedQuantity) || 0, 0) +
                    Math.max(Number(i.damagedQuantity) || 0, 0) >
                0
        );
        grnDoc.purchaseStatus = po.isFullyReceived
            ? "Completed"
            : anyRecv
              ? "Partially Received"
              : "Pending";
        await grnDoc.save();
    }
    return grnDoc;
};

/** After supplier ships more, refresh every open Draft GRN for that PO. */
const syncOpenDraftGrnLinesForPo = async (purchaseOrderId) => {
    if (!purchaseOrderId) return;
    const open = await GRN.find({
        purchaseOrderId,
        ...NOT_DELETED,
        status: { $in: EDITABLE_GRN },
        inventoryUpdated: { $ne: true }
    });
    for (const grn of open) {
        await syncDraftGrnLinesFromPo(grn);
    }
};

const getGrnById = async (id, query = {}) => {
    const trashMode = isTrashQuery(query);
    const filter = trashMode
        ? { _id: id, isDeleted: true }
        : { _id: id, ...NOT_DELETED };
    let grn = await populateGrn(GRN.findOne(filter));
    if (!grn) throw new AppError("GRN not found.", 404);
    const poId = grn.purchaseOrderId?._id || grn.purchaseOrderId;
    if (!trashMode) {
        await syncDraftGrnLinesFromPo(grn);
        grn = await populateGrn(GRN.findById(grn._id));
    }
    const ctx = await buildPoContextForId(poId);
    const plain = enrichGrnDoc(grn, ctx);
    const done =
        plain.status === "Completed" ||
        plain.status === "Cancelled" ||
        plain.inventoryUpdated === true;
    const awaiting = done
        ? 0
        : ctx?.progress?.pendingReceiveQty != null
          ? Math.max(Number(ctx.progress.pendingReceiveQty) || 0, 0)
          : awaitingReceiveQtyFromPo(
                await PurchaseOrder.findOne({ _id: poId, ...NOT_DELETED })
                    .select(
                        "items supplierId supplierPartialSchedule supplierShipments"
                    )
                    .lean()
            );
    plain.awaitingReceiveQty = awaiting;
    plain.hasAwaitingReceive = awaiting > 0.0001;
    return plain;
};

const getGrnDeleteCheck = async (id) => {
    const grn = await populateGrn(
        GRN.findOne({ _id: id, ...NOT_DELETED })
    );
    if (!grn) throw new AppError("GRN not found.", 404);

    const hasBatches =
        Array.isArray(grn.receiveBatches) && grn.receiveBatches.length > 0;
    const canDelete =
        !grn.inventoryUpdated &&
        !hasBatches &&
        grn.purchaseStatus !== "Partially Received" &&
        grn.purchaseStatus !== "Completed" &&
        ["Draft", "Cancelled"].includes(grn.status);

    let reason = "";
    if (
        grn.inventoryUpdated ||
        grn.status === "Completed" ||
        hasBatches ||
        grn.purchaseStatus === "Partially Received"
    ) {
        reason =
            "This GRN already updated inventory. It cannot be trashed. Reverse stock via sales return or adjustment if needed.";
    } else if (grn.status === "Pending Approval") {
        reason =
            "Pending Approval GRNs cannot be trashed. Reject (returns to Draft) or Cancel first, then trash.";
    } else if (!canDelete) {
        reason = `Status "${grn.status}" cannot move to trash.`;
    }

    return {
        canDelete,
        status: grn.status,
        inventoryUpdated: !!grn.inventoryUpdated,
        grnNumber: grn.grnNumber || "",
        purchaseOrderId: grn.purchaseOrderId?._id || grn.purchaseOrderId || null,
        purchaseOrderNo:
            grn.purchaseOrderId?.purchaseOrderNo ||
            grn.purchaseOrderNo ||
            "",
        reason,
        how: canDelete
            ? "Safe to move to trash. You can restore later from GRN Trash."
            : reason
    };
};

const getGrnStats = async () => {
    const [rows, trashCount] = await Promise.all([
        GRN.aggregate([
            { $match: { ...NOT_DELETED } },
            {
                $group: {
                    _id: "$status",
                    count: { $sum: 1 },
                    amount: { $sum: "$grandTotal" }
                }
            }
        ]),
        trash.trashCount()
    ]);
    const stats = {
        total: 0,
        draft: 0,
        pendingApproval: 0,
        completed: 0,
        cancelled: 0,
        totalAmount: 0,
        trashCount
    };
    for (const row of rows) {
        stats.total += row.count;
        stats.totalAmount += row.amount || 0;
        if (row._id === "Draft") stats.draft = row.count;
        if (row._id === "Pending Approval") stats.pendingApproval = row.count;
        if (row._id === "Completed" || row._id === "Received" || row._id === "Verified") {
            stats.completed += row.count;
        }
        if (row._id === "Cancelled") stats.cancelled = row.count;
    }
    return stats;
};

const updateGrn = async (id, payload = {}, actorId = null) => {
    const grn = await findGrnOrFail(id);
    if (!EDITABLE_GRN.includes(grn.status)) {
        throw new AppError("Only Draft / Pending Approval GRNs can be edited.", 400);
    }
    if (grn.inventoryUpdated) {
        throw new AppError("Inventory already updated — GRN is locked.", 400);
    }

    // Ensure line caps include latest supplier sends before applying qty
    await syncDraftGrnLinesFromPo(grn);

    if (payload.referenceNumber !== undefined) {
        grn.referenceNumber = String(payload.referenceNumber).trim();
    }
    if (payload.supplierInvoiceNo !== undefined) {
        grn.supplierInvoiceNo = String(payload.supplierInvoiceNo).trim();
    }
    if (payload.supplierNote !== undefined) {
        grn.supplierNote = String(payload.supplierNote).trim();
    }
    if (payload.internalNote !== undefined) {
        grn.internalNote = String(payload.internalNote).trim();
    }
    if (payload.remarks !== undefined) {
        grn.internalNote = String(payload.remarks).trim();
    }
    if (payload.receivedDate) grn.receivedDate = new Date(payload.receivedDate);
    if (payload.invoiceDate !== undefined) {
        grn.invoiceDate = payload.invoiceDate
            ? new Date(payload.invoiceDate)
            : null;
    }
    if (payload.branchId !== undefined) {
        grn.branchId = toObjectId(payload.branchId);
    }

    if (Array.isArray(payload.items)) {
        for (const patch of payload.items) {
            let line =
                grn.items.id(patch._id || patch.id) ||
                grn.items.find(
                    (i) =>
                        String(i.purchaseOrderItemId) ===
                        String(patch.purchaseOrderItemId)
                );
            if (!line && (patch.productId || patch.productName)) {
                line = grn.items.find(
                    (i) =>
                        (patch.productId &&
                            String(i.productId) === String(patch.productId) &&
                            String(i.productVariantId || "") ===
                                String(patch.productVariantId || "")) ||
                        (patch.productName &&
                            String(i.productName) === String(patch.productName) &&
                            String(i.variantLabel || "") ===
                                String(patch.variantLabel || ""))
                );
            }
            if (!line) continue;

            if (patch.receivedQuantity !== undefined) {
                line.receivedQuantity = Math.max(
                    Number(patch.receivedQuantity) || 0,
                    0
                );
            }
            if (patch.damagedQuantity !== undefined) {
                line.damagedQuantity = Math.max(
                    Number(patch.damagedQuantity) || 0,
                    0
                );
            }
            if (patch.remarks !== undefined) {
                line.remarks = String(patch.remarks).trim();
            }
            if (Array.isArray(patch.imeis)) {
                line.imeis = [
                    ...new Set(patch.imeis.map(normalizeImei).filter(Boolean))
                ];
                if (line.trackingType === "IMEI" && line.imeis.length) {
                    const damaged = Math.max(Number(line.damagedQuantity) || 0, 0);
                    // IMEIs represent accepted units; received = accepted + damaged.
                    line.receivedQuantity = line.imeis.length + damaged;
                }
            }
            if (patch.barcode !== undefined) {
                line.barcode = String(patch.barcode).trim();
            }
        }
    }

    recalculateGrn(grn);
    grn.updatedBy = toObjectId(actorId) || grn.updatedBy;
    await grn.save();
    const populated = await populateGrn(GRN.findById(grn._id));
    const poId = populated?.purchaseOrderId?._id || populated?.purchaseOrderId;
    const ctx = await buildPoContextForId(poId);
    return enrichGrnDoc(populated, ctx);
};

const findGrnLine = (grn, payload = {}) => {
    const itemId = payload.itemId || payload.lineId || payload._id;
    const poItemId = payload.purchaseOrderItemId;
    const productId = payload.productId;
    const variantId = payload.productVariantId;

    // Prefer PO line id — most stable across create/reuse
    if (poItemId) {
        const byPo = (grn.items || []).find(
            (i) => String(i.purchaseOrderItemId) === String(poItemId)
        );
        if (byPo) return byPo;
    }

    if (itemId && mongoose.Types.ObjectId.isValid(String(itemId))) {
        try {
            const bySubId = grn.items.id(itemId);
            if (bySubId) return bySubId;
        } catch (_) {}
        const byId = (grn.items || []).find(
            (i) => String(i._id) === String(itemId)
        );
        if (byId) return byId;
    }

    if (productId) {
        return (grn.items || []).find((i) => {
            if (String(i.productId) !== String(productId)) return false;
            if (variantId) {
                return String(i.productVariantId || "") === String(variantId);
            }
            return true;
        });
    }
    return null;
};

/** Ensure line trackingType matches product before IMEI ops */
const ensureLineTracking = async (line) => {
    if (!line) return line;
    line.trackingType = resolveTrackingType(line.trackingType);
    if (!line?.productId) return line;
    const product = await loadProductMeta(line.productId);
    if (!product) return line;
    if (!line.barcode && product.barcode) line.barcode = product.barcode;
    return line;
};

/** Add one IMEI to a GRN line (scan) */
const scanImei = async (id, payload = {}, actorId = null) => {
    const grn = await findGrnOrFail(id);
    if (!EDITABLE_GRN.includes(grn.status) || grn.inventoryUpdated) {
        throw new AppError("Cannot scan IMEI on this GRN.", 400);
    }

    const imei = normalizeImei(payload.imei);
    if (!imei || imei.length < 14 || imei.length > 17) {
        throw new AppError(
            "Invalid IMEI (must be 14–17 characters, usually 15 digits).",
            400
        );
    }

    const exists = await ItemTrack.findOne({
        imei,
        status: { $ne: "deleted" }
    })
        .select("_id")
        .lean();
    if (exists) throw new AppError(`Duplicate IMEI: ${imei}`, 400);

    const onThis = (grn.items || []).some((i) =>
        (i.imeis || []).map(normalizeImei).includes(imei)
    );
    if (onThis) {
        throw new AppError("IMEI already scanned on this GRN.", 400);
    }

    const onOther = await GRN.findOne({
        ...NOT_DELETED,
        status: { $in: EDITABLE_GRN },
        "items.imeis": imei,
        _id: { $ne: grn._id }
    })
        .select("grnNumber")
        .lean();
    if (onOther) {
        throw new AppError(
            `IMEI already on draft GRN ${onOther.grnNumber}.`,
            400
        );
    }

    const line = findGrnLine(grn, payload);
    if (!line) {
        throw new AppError(
            "GRN line not found. Refresh the GRN and try again.",
            404
        );
    }
    await ensureLineTracking(line);
    if (line.trackingType !== "IMEI") {
        throw new AppError(
            "This product is Non-IMEI — enter received quantity instead.",
            400
        );
    }

    const damaged = Math.max(Number(line.damagedQuantity) || 0, 0);
    const maxAccepted = Math.max(Number(line.orderedQuantity) || 0, 0);
    if ((line.imeis || []).length >= maxAccepted) {
        throw new AppError(
            `Cannot scan more accepted IMEIs than qty (${maxAccepted}) for this line.`,
            400
        );
    }

    line.imeis = [...(line.imeis || []), imei];
    line.receivedQuantity = line.imeis.length + damaged;
    recalculateGrn(grn);
    grn.updatedBy = toObjectId(actorId) || grn.updatedBy;
    await grn.save();
    return enrichGrnDoc(await populateGrn(GRN.findById(grn._id)));
};

/** Bulk add IMEIs to a line */
const bulkAddImeis = async (id, payload = {}, actorId = null) => {
    const list = Array.isArray(payload.imeis)
        ? payload.imeis
        : String(payload.imeisText || "")
              .split(/[\n,;\s]+/)
              .filter(Boolean);
    const normalized = [
        ...new Set(
            list
                .map(normalizeImei)
                .filter((e) => e.length >= 14 && e.length <= 17)
        )
    ];
    if (!normalized.length) {
        throw new AppError(
            "No valid IMEIs provided (each must be 14–17 characters).",
            400
        );
    }

    const grn = await findGrnOrFail(id);
    if (!EDITABLE_GRN.includes(grn.status) || grn.inventoryUpdated) {
        throw new AppError("Cannot add IMEIs on this GRN.", 400);
    }

    const line = findGrnLine(grn, payload);
    if (!line) {
        throw new AppError(
            "GRN line not found. Refresh the GRN and try again.",
            404
        );
    }
    await ensureLineTracking(line);
    if (line.trackingType !== "IMEI") {
        throw new AppError(
            "This product is Non-IMEI — enter received quantity instead.",
            400
        );
    }

    await assertImeiUnique(normalized, null);

    const alreadyOnGrn = new Set();
    for (const item of grn.items || []) {
        for (const e of item.imeis || []) {
            alreadyOnGrn.add(normalizeImei(e));
        }
    }
    const fresh = normalized.filter((e) => !alreadyOnGrn.has(e));
    if (!fresh.length) {
        throw new AppError("All provided IMEIs are already on this GRN.", 400);
    }

    const merged = [...new Set([...(line.imeis || []), ...fresh])];
    if (merged.length > Number(line.orderedQuantity || 0)) {
        throw new AppError(
            `Too many IMEIs (${merged.length}) for qty ${line.orderedQuantity}.`,
            400
        );
    }

    line.imeis = merged;
    const damaged = Math.max(Number(line.damagedQuantity) || 0, 0);
    line.receivedQuantity = merged.length + damaged;
    recalculateGrn(grn);
    grn.updatedBy = toObjectId(actorId) || grn.updatedBy;
    await grn.save();
    return enrichGrnDoc(await populateGrn(GRN.findById(grn._id)));
};

const removeImei = async (id, payload = {}, actorId = null) => {
    const grn = await findGrnOrFail(id);
    if (!EDITABLE_GRN.includes(grn.status) || grn.inventoryUpdated) {
        throw new AppError("Cannot remove IMEI on this GRN.", 400);
    }
    const imei = normalizeImei(payload.imei);
    const line = findGrnLine(grn, payload);
    if (!line) throw new AppError("GRN line not found.", 404);
    line.imeis = (line.imeis || []).filter((e) => normalizeImei(e) !== imei);
    const damaged = Math.max(Number(line.damagedQuantity) || 0, 0);
    line.receivedQuantity = line.imeis.length + damaged;
    recalculateGrn(grn);
    grn.updatedBy = toObjectId(actorId) || grn.updatedBy;
    await grn.save();
    return enrichGrnDoc(await populateGrn(GRN.findById(grn._id)));
};

const submitGrn = async (id, actorId = null, opts = {}) => {
    const grn = await findGrnOrFail(id);
    if (grn.status !== "Draft") {
        throw new AppError("Only Draft GRNs can be submitted.", 400);
    }
    recalculateGrn(grn);
    validateDraftLines(grn);

    if (!grn.requiresApproval || isOwnerActor(opts)) {
        // Owner path — complete immediately
        return completeGrn(id, actorId, { ...opts, actorType: "Owner" });
    }

    grn.status = "Pending Approval";
    grn.submittedAt = new Date();
    grn.updatedBy = toObjectId(actorId) || grn.updatedBy;
    await grn.save();
    return populateGrn(GRN.findById(grn._id));
};

const approveGrn = async (id, actor = {}) => {
    const grn = await findGrnOrFail(id);
    if (grn.status !== "Pending Approval") {
        throw new AppError("Only Pending Approval GRNs can be approved.", 400);
    }
    // Approval triggers stock update (Employee path)
    return completeGrn(id, actor.id || actor.actorId, {
        actorType: "Owner",
        approvedBy: actor.id || actor.actorId
    });
};

const rejectGrn = async (id, reason = "", actor = {}) => {
    const grn = await findGrnOrFail(id);
    if (grn.status !== "Pending Approval") {
        throw new AppError("Only Pending Approval GRNs can be rejected.", 400);
    }
    grn.status = "Draft";
    grn.rejectionReason = String(reason || "").trim();
    grn.updatedBy = toObjectId(actor.id || actor.actorId) || grn.updatedBy;
    await grn.save();
    return populateGrn(GRN.findById(grn._id));
};

const completeGrn = async (id, actorId = null, opts = {}) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const grn = await findGrnOrFail(id, session);
        if (grn.status === "Completed" && grn.inventoryUpdated) {
            throw new AppError("GRN already completed.", 400);
        }
        if (!["Draft", "Pending Approval"].includes(grn.status)) {
            throw new AppError("GRN cannot be completed from this status.", 400);
        }

        // Employee cannot complete Draft without approval
        if (
            grn.requiresApproval &&
            grn.status === "Draft" &&
            !isOwnerActor(opts)
        ) {
            throw new AppError(
                "Employee GRNs must be submitted and approved before stock update.",
                403
            );
        }

        const wasPending = grn.status === "Pending Approval";
        // Pull latest sent qty into draft lines before stocking this phase
        await syncDraftGrnLinesFromPo(grn);
        recalculateGrn(grn);
        validateDraftLines(grn);

        const hasReceive = (grn.items || []).some((i) => {
            const recv = Math.max(Number(i.receivedQuantity) || 0, 0);
            const dmg = Math.max(Number(i.damagedQuantity) || 0, 0);
            return recv > 0 || dmg > 0;
        });
        if (!hasReceive) {
            throw new AppError("Enter received quantities before stocking.", 400);
        }

        // Link/create products FIRST so batch snapshot stores real productIds
        const productIds = await applyInventoryForGrn(
            grn,
            toObjectId(actorId),
            session
        );

        const batch = snapshotReceiveBatch(grn, actorId, {
            receivePhase: opts.receivePhase,
            note: opts.note || ""
        });
        if (!batch) {
            throw new AppError("Enter received quantities before stocking.", 400);
        }

        const po = await applyPoReceiving(grn, session);
        const fullyReceived = po.isFullyReceived === true;

        if (!Array.isArray(grn.receiveBatches)) grn.receiveBatches = [];
        grn.receiveBatches.push(batch);

        if (fullyReceived) {
            grn.status = "Completed";
            grn.inventoryUpdated = true;
            grn.inventoryUpdatedAt = new Date();
            grn.inventoryUpdatedBy = toObjectId(actorId);
            grn.purchaseStatus = "Completed";
            grn.qualityStatus = "Passed";
        } else {
            const remainingLines = await buildLinesFromPo(po);
            grn.status = "Draft";
            grn.inventoryUpdated = false;
            grn.purchaseStatus = "Partially Received";
            grn.qualityStatus = "Pending";
            grn.items = remainingLines;
            grn.markModified("items");
            recalculateGrn(grn);
            grn.receivedDate = new Date();
        }

        if (opts.approvedBy || wasPending) {
            grn.approvedBy = toObjectId(opts.approvedBy || actorId);
            grn.approvedAt = new Date();
        }
        grn.updatedBy = toObjectId(actorId) || grn.updatedBy;
        await grn.save({ session });

        await session.commitTransaction();

        const refreshErrors = [];
        for (const pid of productIds) {
            try {
                await productService.refreshStockSummary(pid);
            } catch (err) {
                refreshErrors.push(`${pid}: ${err?.message || err}`);
                console.error(
                    "[GRN] refreshStockSummary failed:",
                    pid,
                    err?.message || err
                );
            }
        }

        const populated = await populateGrn(GRN.findById(grn._id));
        const ctx = await buildPoContextForId(po._id);
        const plain = enrichGrnDoc(populated, ctx);
        plain.stockSummaryRefresh = {
            ok: refreshErrors.length === 0,
            errors: refreshErrors
        };
        plain.partialReceive = !fullyReceived;
        plain.fullyReceived = fullyReceived;
        return plain;
    } catch (err) {
        if (session.inTransaction()) {
            await session.abortTransaction();
        }
        throw err;
    } finally {
        session.endSession();
    }
};

const cancelGrn = async (id, actorId = null, reason = "") => {
    const grn = await findGrnOrFail(id);
    if (grn.inventoryUpdated || grn.status === "Completed") {
        throw new AppError("Completed GRNs cannot be cancelled.", 400);
    }
    if (
        grn.purchaseStatus === "Partially Received" ||
        grn.purchaseStatus === "Completed" ||
        (Array.isArray(grn.receiveBatches) && grn.receiveBatches.length > 0)
    ) {
        throw new AppError(
            "This GRN already stocked inventory for a receive batch and cannot be cancelled.",
            400
        );
    }
    if (grn.status === "Cancelled") {
        throw new AppError("GRN already cancelled.", 400);
    }
    grn.status = "Cancelled";
    grn.cancelledBy = toObjectId(actorId);
    grn.cancelledAt = new Date();
    if (reason) grn.rejectionReason = String(reason).trim();
    grn.updatedBy = toObjectId(actorId) || grn.updatedBy;
    await grn.save();
    return populateGrn(GRN.findById(grn._id));
};

const deleteGrn = (id, actorId = null) => trash.softDelete(id, actorId);
const restoreGrn = (id, actorId = null) => trash.restore(id, actorId);
const permanentDeleteGrn = (id) => trash.permanentDelete(id);
const bulkDeleteGrns = (payload, actorId) => trash.bulkSoftDelete(payload, actorId);
const bulkRestoreGrns = (payload, actorId) => trash.bulkRestore(payload, actorId);
const bulkPermanentDeleteGrns = (payload) => trash.bulkPermanentDelete(payload);

module.exports = {
    listReceivablePurchaseOrders,
    createGrnFromPurchaseOrder,
    getGrns,
    getGrnById,
    getGrnDeleteCheck,
    getGrnStats,
    updateGrn,
    scanImei,
    bulkAddImeis,
    removeImei,
    submitGrn,
    approveGrn,
    rejectGrn,
    completeGrn,
    cancelGrn,
    deleteGrn,
    restoreGrn,
    permanentDeleteGrn,
    bulkDeleteGrns,
    bulkRestoreGrns,
    bulkPermanentDeleteGrns,
    syncOpenDraftGrnLinesForPo,
    RECEIVABLE_PO
};
