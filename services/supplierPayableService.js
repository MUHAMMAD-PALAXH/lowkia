const mongoose = require("mongoose");
const SupplierPayable = require("../model/supplierPayable");
const PurchaseOrder = require("../model/purchaseOrder");
const GRN = require("../model/grn");
const Supplier = require("../model/supplier");
const AdminUser = require("../model/adminUser");
const AppError = require("../utils/appError");
const {
    DEFAULT_CURRENCY,
    assertCurrency,
    toMinor,
    toMajor,
    assertNonNegativeMinor,
    assertPositiveMinor,
    assertNotOverpaying,
    addMinor,
    subMinor,
} = require("../utils/money");
const { generateSupplierPayableCode } = require("./codeGenerator");
const {
    ensureUserCompany,
    ensureDefaultCompany,
    assertDocumentCompany,
} = require("./companyService");
const { writeActivityLog } = require("./activityLogService");

const NOT_DELETED = { isDeleted: { $ne: true } };

const toObjectId = (id) => {
    if (!id) return null;
    if (id instanceof mongoose.Types.ObjectId) return id;
    if (mongoose.Types.ObjectId.isValid(id)) {
        return new mongoose.Types.ObjectId(id);
    }
    return null;
};

/**
 * Hybrid recalculation — pure in-memory on a payable doc.
 * Does not touch payment history; uses stored counters.
 */
const recomputeHybridBalances = (payable) => {
    const commitment = assertNonNegativeMinor(
        payable.poCommitmentMinor || 0,
        "PO commitment"
    );
    const received = assertNonNegativeMinor(
        payable.grnReceivedValueMinor || 0,
        "GRN received"
    );
    const advancePaid = assertNonNegativeMinor(
        payable.advancePaidMinor || 0,
        "Advance paid"
    );
    const paidAgainst = assertNonNegativeMinor(
        payable.paidAgainstPayableMinor || 0,
        "Paid against payable"
    );

    // Advances apply to received goods first (FIFO-style pool).
    const advanceApplied = Math.min(advancePaid, received);
    const advanceUnapplied = Math.max(0, advancePaid - advanceApplied);

    const payableDue = Math.max(0, received - advanceApplied - paidAgainst);
    const unreceived = Math.max(0, commitment - received);
    const remainingExposure = Math.max(0, unreceived - advanceUnapplied);

    payable.poCommitmentMinor = commitment;
    payable.grnReceivedValueMinor = received;
    payable.advancePaidMinor = advancePaid;
    payable.advanceAppliedMinor = advanceApplied;
    payable.advanceUnappliedMinor = advanceUnapplied;
    payable.paidAgainstPayableMinor = paidAgainst;
    payable.payableDueMinor = payableDue;
    payable.outstandingMinor = payableDue;
    payable.remainingExposureMinor = remainingExposure;
    payable.totalPaidMinor = addMinor(advancePaid, paidAgainst);

    if (payable.status === "cancelled") {
        return payable;
    }

    // Never mark settled while unreceived commitment (net of advances) remains.
    if (payableDue > 0 || remainingExposure > 0) {
        payable.status =
            payable.totalPaidMinor > 0 || received > 0 ? "partial" : "open";
    } else if (received > 0 || payable.totalPaidMinor > 0) {
        payable.status = "settled";
    } else {
        payable.status = "open";
    }

    return payable;
};

const majorMirror = (payable) => ({
    poCommitment: toMajor(payable.poCommitmentMinor, payable.currency),
    advancePaid: toMajor(payable.advancePaidMinor, payable.currency),
    advanceApplied: toMajor(payable.advanceAppliedMinor, payable.currency),
    advanceUnapplied: toMajor(payable.advanceUnappliedMinor, payable.currency),
    grnReceivedValue: toMajor(payable.grnReceivedValueMinor, payable.currency),
    payableDue: toMajor(payable.payableDueMinor, payable.currency),
    paidAgainstPayable: toMajor(
        payable.paidAgainstPayableMinor,
        payable.currency
    ),
    outstanding: toMajor(payable.outstandingMinor, payable.currency),
    remainingExposure: toMajor(
        payable.remainingExposureMinor,
        payable.currency
    ),
    totalPaid: toMajor(payable.totalPaidMinor, payable.currency),
});

const serializePayable = (doc) => {
    const plain = doc.toObject ? doc.toObject({ virtuals: true }) : { ...doc };
    return {
        ...plain,
        amounts: majorMirror(plain),
    };
};

const resolveCompanyId = async (actorId, explicitCompanyId = null) => {
    if (explicitCompanyId) return toObjectId(explicitCompanyId);
    if (actorId) {
        const user = await AdminUser.findById(actorId).select("companyId");
        if (user) {
            return ensureUserCompany(user);
        }
    }
    const company = await ensureDefaultCompany(actorId);
    return company._id;
};

/**
 * Received goods value aligned to PO commercial total (line tax/discount +
 * header tax/shipping/other), not bare qty × purchasePrice.
 */
const computeReceivedValueMajorFromPo = (po) => {
    const items = Array.isArray(po?.items) ? po.items : [];
    const subtotal = Math.max(Number(po?.subtotal) || 0, 0);
    const grandTotal = Math.max(Number(po?.grandTotal) || 0, 0);

    let receivedLinePortion = 0;
    for (const item of items) {
        const ordered = Math.max(Number(item.quantity) || 0, 0);
        const recv = Math.max(Number(item.receivedQuantity) || 0, 0);
        if (ordered <= 0 || recv <= 0) continue;
        const fraction = Math.min(1, recv / ordered);

        const explicitTotal = Number(item.total);
        if (Number.isFinite(explicitTotal)) {
            receivedLinePortion += fraction * Math.max(explicitTotal, 0);
            continue;
        }

        const price = Math.max(Number(item.purchasePrice) || 0, 0);
        const discount = Math.max(Number(item.discount) || 0, 0);
        const tax = Math.max(Number(item.tax) || 0, 0);
        const lineTotal = Math.max(ordered * price - discount + tax, 0);
        receivedLinePortion += fraction * lineTotal;
    }

    if (subtotal > 0 && grandTotal >= 0) {
        return (receivedLinePortion / subtotal) * grandTotal;
    }

    const legacy = Number(po?.totalReceivedAmount);
    if (Number.isFinite(legacy) && legacy > 0) return legacy;
    return receivedLinePortion;
};

const sumCompletedGrnValueMinor = async (purchaseOrderId, currency, session) => {
    const q = GRN.find({
        purchaseOrderId,
        ...NOT_DELETED,
        $or: [
            { inventoryUpdated: true },
            { purchaseStatus: { $in: ["Completed", "Partially Received"] } },
            { "receiveBatches.0": { $exists: true } },
        ],
    }).select("grandTotal receiveBatches subtotal");

    if (session) q.session(session);
    const grns = await q.lean();

    // Prefer sum of receive-batch line totals when present; else grandTotal when completed.
    let totalMajor = 0;
    for (const g of grns) {
        const batches = Array.isArray(g.receiveBatches) ? g.receiveBatches : [];
        if (batches.length) {
            for (const b of batches) {
                const lines = Array.isArray(b.lines) ? b.lines : [];
                let fromLines = 0;
                for (const line of lines) {
                    const qty =
                        Number(line.acceptedQuantity) ||
                        Math.max(
                            (Number(line.receivedQuantity) ||
                                Number(line.receivedQty) ||
                                0) -
                                (Number(line.damagedQuantity) || 0),
                            0
                        );
                    const price =
                        Number(line.purchasePrice) ||
                        Number(line.unitPrice) ||
                        0;
                    fromLines +=
                        Number(line.lineTotal) ||
                        Number(line.total) ||
                        qty * price;
                }
                const batchTotal =
                    fromLines > 0
                        ? fromLines
                        : Number(b.grandTotal) ||
                          Number(b.subtotal) ||
                          Number(b.totalAmount) ||
                          0;
                totalMajor += batchTotal;
            }
        } else if (g.inventoryUpdated || g.purchaseStatus === "Completed") {
            totalMajor += Number(g.grandTotal) || Number(g.subtotal) || 0;
        }
    }

    return {
        fromGrnsMinor: toMinor(totalMajor, currency),
        grnIds: grns.map((g) => g._id),
    };
};

/**
 * Create or refresh payable from PO + GRN state.
 * Does not invent payment allocations — only syncs commitment & received.
 */
const syncFromPurchaseOrder = async (
    purchaseOrderId,
    {
        actorId = null,
        companyId = null,
        session = null,
        audit = true,
    } = {}
) => {
    const poId = toObjectId(purchaseOrderId);
    if (!poId) throw new AppError("Invalid purchase order id.", 400);

    let poQuery = PurchaseOrder.findOne({ _id: poId, ...NOT_DELETED });
    if (session) poQuery = poQuery.session(session);
    const po = await poQuery;
    if (!po) throw new AppError("Purchase order not found.", 404);
    if (!po.supplierId) {
        throw new AppError("Purchase order has no supplier.", 400);
    }

    const tenantId =
        toObjectId(po.companyId) ||
        (await resolveCompanyId(actorId, companyId));
    const currency = assertCurrency(DEFAULT_CURRENCY);

    const commitmentMinor = toMinor(po.grandTotal || 0, currency);
    // Align received value to PO commercial totals (tax / discount / shipping).
    const poCommercialReceivedMinor = toMinor(
        computeReceivedValueMajorFromPo(po),
        currency
    );
    const { fromGrnsMinor, grnIds } = await sumCompletedGrnValueMinor(
        poId,
        currency,
        session
    );
    // Prefer commercial PO allocation; GRN qty×price is only a floor for legacy gaps.
    const grnReceivedValueMinor = Math.max(
        poCommercialReceivedMinor,
        fromGrnsMinor
    );
    const linkedGrnIds =
        Array.isArray(po.grnIds) && po.grnIds.length
            ? po.grnIds
            : grnIds;

    let payableQuery = SupplierPayable.findOne({
        purchaseOrderId: poId,
        ...NOT_DELETED,
    });
    if (session) payableQuery = payableQuery.session(session);
    let payable = await payableQuery;
    if (payable && tenantId && String(payable.companyId) !== String(tenantId)) {
        payable.companyId = tenantId;
    }

    const isNew = !payable;
    if (!payable) {
        const payableNumber = await generateSupplierPayableCode({ session });
        payable = new SupplierPayable({
            companyId: tenantId,
            branchId: po.branchId || null,
            supplierId: po.supplierId,
            purchaseOrderId: poId,
            payableNumber,
            currency,
            advancePaidMinor: 0,
            paidAgainstPayableMinor: 0,
            createdBy: toObjectId(actorId),
        });
    }

    payable.branchId = po.branchId || payable.branchId;
    payable.supplierId = po.supplierId;
    payable.currency = currency;
    payable.poCommitmentMinor = commitmentMinor;
    payable.grnReceivedValueMinor = grnReceivedValueMinor;
    payable.grnIds = linkedGrnIds;
    payable.updatedBy = toObjectId(actorId) || payable.updatedBy;
    payable.lastSyncedAt = new Date();

    recomputeHybridBalances(payable);

    if (session) {
        await payable.save({ session });
    } else {
        await payable.save();
    }

    if (audit && actorId) {
        const user = await AdminUser.findById(actorId).select(
            "firstName lastName email role companyId"
        );
        if (user) {
            await writeActivityLog({
                user,
                companyId: tenantId,
                branchId: payable.branchId,
                activityType: isNew ? "Create" : "Update",
                module: "Payment",
                subModule: "SupplierPayable",
                description: isNew
                    ? `Supplier payable ${payable.payableNumber} created for PO`
                    : `Supplier payable ${payable.payableNumber} synced from PO/GRN`,
                referenceType: "Payment",
                referenceId: payable._id,
                newData: {
                    payableNumber: payable.payableNumber,
                    outstandingMinor: payable.outstandingMinor,
                    grnReceivedValueMinor: payable.grnReceivedValueMinor,
                    status: payable.status,
                },
                securityLevel: "High",
            });
        }
    }

    return serializePayable(payable);
};

/**
 * Apply a completed advance payment (Phase 3 will call inside a transaction).
 */
const applyAdvancePayment = async (
    payableId,
    amountMinor,
    { companyId, actorId = null, session = null } = {}
) => {
    const amount = assertPositiveMinor(amountMinor, "Advance amount");
    let q = SupplierPayable.findOne({ _id: payableId, ...NOT_DELETED });
    if (session) q = q.session(session);
    const payable = await q;
    assertDocumentCompany(payable, companyId, "Supplier payable");

    recomputeHybridBalances(payable);
    // Advances cannot exceed remaining PO exposure (commitment − received − unapplied advances).
    assertNotOverpaying(
        amount,
        payable.remainingExposureMinor || 0,
        "Advance payment"
    );

    payable.advancePaidMinor = addMinor(payable.advancePaidMinor, amount);
    payable.updatedBy = toObjectId(actorId) || payable.updatedBy;
    recomputeHybridBalances(payable);
    await payable.save(session ? { session } : undefined);
    return serializePayable(payable);
};

/**
 * Apply a completed payment against payable due (Phase 3).
 * Hard-rejects overpayment.
 */
const applyAgainstPayablePayment = async (
    payableId,
    amountMinor,
    { companyId, actorId = null, session = null } = {}
) => {
    const amount = assertPositiveMinor(amountMinor, "Payment amount");
    let q = SupplierPayable.findOne({ _id: payableId, ...NOT_DELETED });
    if (session) q = q.session(session);
    const payable = await q;
    assertDocumentCompany(payable, companyId, "Supplier payable");

    recomputeHybridBalances(payable);
    assertNotOverpaying(amount, payable.outstandingMinor, "Payment");

    payable.paidAgainstPayableMinor = addMinor(
        payable.paidAgainstPayableMinor,
        amount
    );
    payable.updatedBy = toObjectId(actorId) || payable.updatedBy;
    recomputeHybridBalances(payable);
    await payable.save(session ? { session } : undefined);
    return serializePayable(payable);
};

/**
 * Reverse a previously applied amount (payment reversal).
 */
const reverseAppliedPayment = async (
    payableId,
    { advanceMinor = 0, againstPayableMinor = 0, companyId, actorId, session } = {}
) => {
    let q = SupplierPayable.findOne({ _id: payableId, ...NOT_DELETED });
    if (session) q = q.session(session);
    const payable = await q;
    assertDocumentCompany(payable, companyId, "Supplier payable");

    const adv = assertNonNegativeMinor(advanceMinor, "Advance reversal");
    const against = assertNonNegativeMinor(
        againstPayableMinor,
        "Payable reversal"
    );

    if (adv > payable.advancePaidMinor) {
        throw new AppError("Cannot reverse more advance than recorded.", 400);
    }
    if (against > payable.paidAgainstPayableMinor) {
        throw new AppError(
            "Cannot reverse more payable payment than recorded.",
            400
        );
    }

    payable.advancePaidMinor = subMinor(payable.advancePaidMinor, adv);
    payable.paidAgainstPayableMinor = subMinor(
        payable.paidAgainstPayableMinor,
        against
    );
    payable.updatedBy = toObjectId(actorId) || payable.updatedBy;
    recomputeHybridBalances(payable);
    await payable.save(session ? { session } : undefined);
    return serializePayable(payable);
};

const getPayableById = async (id, companyId) => {
    const payable = await SupplierPayable.findOne({
        _id: id,
        ...NOT_DELETED,
    })
        .populate("supplierId", "supplierCode name companyName")
        .populate(
            "purchaseOrderId",
            "purchaseOrderNo grandTotal paidAmount dueAmount paymentStatus status totalReceivedAmount"
        );
    assertDocumentCompany(payable, companyId, "Supplier payable");
    return serializePayable(payable);
};

const getPayableByPurchaseOrder = async (purchaseOrderId, companyId) => {
    const payable = await SupplierPayable.findOne({
        companyId,
        purchaseOrderId,
        ...NOT_DELETED,
    })
        .populate("supplierId", "supplierCode name companyName")
        .populate(
            "purchaseOrderId",
            "purchaseOrderNo grandTotal paidAmount dueAmount paymentStatus status totalReceivedAmount"
        );
    if (!payable) return null;
    return serializePayable(payable);
};

const listPayables = async (companyId, query = {}) => {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const filter = { companyId, ...NOT_DELETED };
    if (query.supplierId) filter.supplierId = toObjectId(query.supplierId);
    if (query.purchaseOrderId) {
        filter.purchaseOrderId = toObjectId(query.purchaseOrderId);
    }
    if (query.branchId) filter.branchId = toObjectId(query.branchId);
    if (query.status) filter.status = String(query.status);
    if (query.outstandingOnly === "true" || query.outstandingOnly === true) {
        filter.outstandingMinor = { $gt: 0 };
    }

    const [items, total] = await Promise.all([
        SupplierPayable.find(filter)
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate("supplierId", "supplierCode name companyName")
            .populate(
                "purchaseOrderId",
                "purchaseOrderNo status paymentStatus grandTotal"
            ),
        SupplierPayable.countDocuments(filter),
    ]);

    await refreshPayablesCommercialFromPos(items);

    return {
        items: items.map(serializePayable),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit) || 1,
        },
    };
};

const getSupplierOutstanding = async (supplierId, companyId) => {
    const sid = toObjectId(supplierId);
    if (!sid) throw new AppError("Invalid supplier id.", 400);

    const supplier = await Supplier.findOne({ _id: sid, ...NOT_DELETED })
        .select("supplierCode name companyName currentBalance totalDueAmount")
        .lean();
    if (!supplier) throw new AppError("Supplier not found.", 404);

    const rows = await SupplierPayable.find({
        companyId,
        supplierId: sid,
        ...NOT_DELETED,
        status: { $ne: "cancelled" },
    }).lean();

    const sum = (field) =>
        rows.reduce((acc, r) => acc + (Number(r[field]) || 0), 0);

    const totalsMinor = {
        poCommitmentMinor: sum("poCommitmentMinor"),
        advancePaidMinor: sum("advancePaidMinor"),
        advanceUnappliedMinor: sum("advanceUnappliedMinor"),
        grnReceivedValueMinor: sum("grnReceivedValueMinor"),
        payableDueMinor: sum("payableDueMinor"),
        paidAgainstPayableMinor: sum("paidAgainstPayableMinor"),
        outstandingMinor: sum("outstandingMinor"),
        remainingExposureMinor: sum("remainingExposureMinor"),
        totalPaidMinor: sum("totalPaidMinor"),
    };

    return {
        supplier,
        currency: DEFAULT_CURRENCY,
        totalsMinor,
        totals: {
            poCommitment: toMajor(totalsMinor.poCommitmentMinor),
            advancePaid: toMajor(totalsMinor.advancePaidMinor),
            advanceUnapplied: toMajor(totalsMinor.advanceUnappliedMinor),
            grnReceivedValue: toMajor(totalsMinor.grnReceivedValueMinor),
            payableDue: toMajor(totalsMinor.payableDueMinor),
            paidAgainstPayable: toMajor(totalsMinor.paidAgainstPayableMinor),
            outstanding: toMajor(totalsMinor.outstandingMinor),
            remainingExposure: toMajor(totalsMinor.remainingExposureMinor),
            totalPaid: toMajor(totalsMinor.totalPaidMinor),
        },
        openPayables: rows.filter((r) => (r.outstandingMinor || 0) > 0).length,
        payableCount: rows.length,
    };
};

/**
 * Best-effort sync after GRN complete (never fails the GRN flow).
 */
const syncAfterGrnSafe = async (purchaseOrderId, actorId) => {
    try {
        if (!purchaseOrderId) return null;
        const payable = await syncFromPurchaseOrder(purchaseOrderId, {
            actorId,
            audit: true,
        });
        const sid =
            payable?.supplierId?._id ||
            payable?.supplierId ||
            null;
        if (sid) {
            try {
                const { recomputeSupplierFinancials } = require("./supplierService");
                await recomputeSupplierFinancials(sid);
            } catch (err) {
                console.warn(
                    "[SupplierPayable] supplier due refresh failed:",
                    err?.message || err
                );
            }
        }
        return payable;
    } catch (err) {
        console.warn(
            "[SupplierPayable] sync after GRN failed:",
            err?.message || err
        );
        return null;
    }
};

/**
 * Refresh commitment + received commercial value from live PO rows,
 * then recompute outstanding. Persists only when values change.
 */
const refreshPayablesCommercialFromPos = async (payableDocs = []) => {
    const docs = (payableDocs || []).filter((p) => p && p.purchaseOrderId);
    if (!docs.length) return docs;

    const poIds = [
        ...new Set(docs.map((p) => String(p.purchaseOrderId))),
    ];
    const pos = await PurchaseOrder.find({
        _id: { $in: poIds },
        ...NOT_DELETED,
    }).select("items subtotal grandTotal totalReceivedAmount");
    const byPo = new Map(pos.map((p) => [String(p._id), p]));

    const saves = [];
    for (const payable of docs) {
        const po = byPo.get(String(payable.purchaseOrderId));
        if (!po) continue;
        const currency = assertCurrency(payable.currency || DEFAULT_CURRENCY);
        const nextCommitment = toMinor(po.grandTotal || 0, currency);
        const nextReceived = toMinor(
            computeReceivedValueMajorFromPo(po),
            currency
        );
        if (
            Number(payable.poCommitmentMinor) === nextCommitment &&
            Number(payable.grnReceivedValueMinor) === nextReceived
        ) {
            const beforeStatus = payable.status;
            const beforeDue = Number(payable.outstandingMinor) || 0;
            recomputeHybridBalances(payable);
            if (
                payable.status !== beforeStatus ||
                (Number(payable.outstandingMinor) || 0) !== beforeDue
            ) {
                saves.push(payable.save());
            }
            continue;
        }
        payable.poCommitmentMinor = nextCommitment;
        payable.grnReceivedValueMinor = nextReceived;
        payable.lastSyncedAt = new Date();
        recomputeHybridBalances(payable);
        saves.push(payable.save());
    }
    if (saves.length) await Promise.all(saves);
    return docs;
};

module.exports = {
    recomputeHybridBalances,
    computeReceivedValueMajorFromPo,
    serializePayable,
    syncFromPurchaseOrder,
    applyAdvancePayment,
    applyAgainstPayablePayment,
    reverseAppliedPayment,
    getPayableById,
    getPayableByPurchaseOrder,
    listPayables,
    getSupplierOutstanding,
    syncAfterGrnSafe,
    refreshPayablesCommercialFromPos,
};
