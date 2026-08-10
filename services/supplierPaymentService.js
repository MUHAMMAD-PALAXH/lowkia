const mongoose = require("mongoose");
const Payment = require("../model/payment");
const PurchaseOrder = require("../model/purchaseOrder");
const Supplier = require("../model/supplier");
const AdminUser = require("../model/adminUser");
const AppError = require("../utils/appError");
const {
    DEFAULT_CURRENCY,
    toMinor,
    toMajor,
    formatMoney,
} = require("../utils/money");
const {
    generatePaymentNumber,
    resolveAmountMinor,
    assertMethodProviderCombo,
    assertPaymentPurpose,
    applyStatusTransition,
    assertNotPaidLocked,
    auditPayment,
} = require("./paymentFoundationService");
const {
    syncFromPurchaseOrder,
    applyAdvancePayment,
    applyAgainstPayablePayment,
    reverseAppliedPayment,
    getPayableByPurchaseOrder,
} = require("./supplierPayableService");
const { ensureUserCompany, assertDocumentCompany } = require("./companyService");
const { getPaymentProvider } = require("./paymentProviders");

const NOT_DELETED = { isDeleted: { $ne: true } };

const toObjectId = (id) => {
    if (!id) return null;
    if (id instanceof mongoose.Types.ObjectId) return id;
    if (mongoose.Types.ObjectId.isValid(String(id))) {
        return new mongoose.Types.ObjectId(String(id));
    }
    return null;
};

const isOwner = (user) => (user?.role || "").toLowerCase() === "admin";

const mapLegacyMethod = (raw) => {
    const s = String(raw || "")
        .trim()
        .toLowerCase();
    if (!s) return "BANK_TRANSFER";
    if (s.includes("cash")) return "CASH";
    if (s.includes("cheque") || s.includes("check")) return "CHECK";
    if (s.includes("ach")) return "ACH";
    if (s.includes("apple")) return "APPLE_PAY";
    if (s.includes("card") || s.includes("visa") || s.includes("master")) {
        return "CARD";
    }
    if (s.includes("bank") || s.includes("transfer") || s.includes("wire")) {
        return "BANK_TRANSFER";
    }
    return String(raw).trim().toUpperCase().replace(/\s+/g, "_");
};

const inferPurpose = (po, explicitPurpose) => {
    if (explicitPurpose) return assertPaymentPurpose(explicitPurpose);
    const received =
        Number(po.totalReceivedAmount) > 0 ||
        ["Partially Received", "Received", "Completed"].includes(po.status);
    return received ? "againstPayable" : "advance";
};

const populatePayment = (q) =>
    q
        .populate("partyId")
        .populate(
            "purchaseOrderId",
            "purchaseOrderNo grandTotal paidAmount dueAmount paymentStatus status totalReceivedAmount supplierId"
        )
        .populate("supplierPayableId")
        .populate("createdBy", "firstName lastName email role")
        .populate("approvedBy", "firstName lastName email role")
        .populate("postedBy", "firstName lastName email role");

const serializePayment = (doc) => {
    const plain = doc.toObject ? doc.toObject({ virtuals: true }) : { ...doc };
    const currency = plain.currency || DEFAULT_CURRENCY;
    return {
        ...plain,
        amounts: {
            amount: toMajor(plain.amountMinor || 0, currency),
            paidAmount: toMajor(plain.paidAmountMinor || 0, currency),
            dueAmount: toMajor(plain.dueAmountMinor || 0, currency),
        },
    };
};

const loadPoOrFail = async (purchaseOrderId, companyId, session = null) => {
    let q = PurchaseOrder.findOne({
        _id: purchaseOrderId,
        ...NOT_DELETED,
    });
    if (session) q = q.session(session);
    const po = await q;
    if (!po) throw new AppError("Purchase order not found.", 404);
    if (!po.supplierId) {
        throw new AppError("Purchase order has no supplier.", 400);
    }
    if (companyId) {
        const { bindCompanyOrFail } = require("./tenantBind");
        await bindCompanyOrFail(po, companyId, "Purchase order");
    }
    return po;
};

/**
 * Create a supplier payment request / draft.
 * branch_manager → pendingApproval
 * admin → approved (ready to complete) unless forcePending
 */
const createSupplierPayment = async (payload = {}, user, meta = {}) => {
    if (!user?._id) throw new AppError("Authentication required.", 401);
    const companyId = await ensureUserCompany(user);
    const poId = toObjectId(payload.purchaseOrderId);
    if (!poId) throw new AppError("purchaseOrderId is required.", 400);

    const po = await loadPoOrFail(poId, companyId);
    const purpose = inferPurpose(po, payload.purpose);
    const { amountMinor, currency, amount } = resolveAmountMinor(
        payload,
        payload.currency || DEFAULT_CURRENCY
    );

    const methodRaw = mapLegacyMethod(
        payload.paymentMethod || payload.method || "BANK_TRANSFER"
    );
    let provider = payload.paymentProvider || "NONE";
    if (
        (methodRaw === "CARD" || methodRaw === "APPLE_PAY") &&
        (!provider || provider === "NONE")
    ) {
        provider = "STRIPE";
    }
    const { paymentMethod, paymentProvider } = assertMethodProviderCombo(
        methodRaw,
        provider
    );

    if (
        (paymentMethod === "CARD" || paymentMethod === "APPLE_PAY") &&
        !payload.providerTransactionId &&
        !payload.completeImmediately
    ) {
        // Allow create without provider id; required on complete.
    }

    // Ensure payable exists & is synced
    const payableSerialized = await syncFromPurchaseOrder(poId, {
        actorId: user._id,
        companyId,
        audit: false,
    });
    const payableId = toObjectId(payableSerialized._id || payableSerialized.id);

    if (purpose === "againstPayable") {
        const outstanding = Number(payableSerialized.outstandingMinor) || 0;
        if (amountMinor > outstanding) {
            throw new AppError(
                `Payment of ${formatMoney(amountMinor)} exceeds outstanding ${formatMoney(outstanding)}.`,
                400
            );
        }
    } else if (purpose === "advance") {
        const commitment = Number(payableSerialized.poCommitmentMinor) || 0;
        const advancePaid = Number(payableSerialized.advancePaidMinor) || 0;
        const paidAgainst =
            Number(payableSerialized.paidAgainstPayableMinor) || 0;
        const remainingCommitment = Math.max(
            0,
            commitment - advancePaid - paidAgainst
        );
        const exposure =
            Number(payableSerialized.remainingExposureMinor) ||
            remainingCommitment;
        const room = Math.max(remainingCommitment, exposure);
        if (amountMinor > room) {
            throw new AppError(
                `Advance of ${formatMoney(amountMinor)} exceeds remaining PO room ${formatMoney(room)}.`,
                400
            );
        }
    }

    const paymentNumber = await generatePaymentNumber();
    const owner = isOwner(user);
    const forcePending = payload.forcePending === true;
    const initialStatus =
        owner && !forcePending ? "approved" : "pendingApproval";

    const payment = await Payment.create({
        companyId,
        branchId: po.branchId || null,
        paymentNumber,
        paymentDate: payload.paymentDate
            ? new Date(payload.paymentDate)
            : new Date(),
        paymentType: purpose === "advance" ? "SupplierAdvance" : "SupplierPayment",
        purpose,
        partyType: "Supplier",
        partyId: po.supplierId,
        purchaseOrderId: poId,
        supplierPayableId: payableId,
        grnId: toObjectId(payload.grnId),
        currency,
        amountMinor,
        amount,
        paidAmountMinor: 0,
        paidAmount: 0,
        dueAmountMinor: amountMinor,
        dueAmount: amount,
        paymentMethod,
        paymentProvider,
        providerTransactionId: String(payload.providerTransactionId || "").trim(),
        providerPaymentIntentId: String(
            payload.providerPaymentIntentId || ""
        ).trim(),
        paymentMethodReference: String(
            payload.paymentMethodReference || ""
        ).trim(),
        transactionReference: String(
            payload.transactionReference ||
                payload.paymentRef ||
                payload.reference ||
                ""
        ).trim(),
        bankName: String(payload.bankName || "").trim(),
        accountReference: String(payload.accountReference || "").trim(),
        checkNumber: String(payload.checkNumber || payload.chequeNumber || "").trim(),
        checkDate: payload.checkDate ? new Date(payload.checkDate) : null,
        status: initialStatus,
        requiresApproval: initialStatus === "pendingApproval",
        requestedBy: user._id,
        createdBy: user._id,
        note: String(payload.note || "").trim().slice(0, 1000),
        sourceModule: "Purchase",
        isManualEntry: true,
        // stash schedule phase for bridge (non-schema → use referenceType)
        referenceType: payload.phase != null ? `SchedulePhase:${payload.phase}` : "",
        referenceId: null,
        allocations: [
            {
                targetType: "SupplierPayable",
                targetId: payableId,
                amountMinor,
                note: purpose,
            },
        ],
    });

    if (owner && !forcePending) {
        payment.approvedBy = user._id;
        payment.approvedAt = new Date();
        await payment.save();
    }

    await auditPayment({
        user,
        companyId,
        branchId: payment.branchId,
        activityType: "Create",
        description: `Supplier payment ${payment.paymentNumber} created (${purpose}, ${formatMoney(amountMinor)})`,
        payment,
        ipAddress: meta.ipAddress || "",
    });

    // Owner shortcut: create + complete
    if (owner && payload.completeImmediately === true) {
        return completeSupplierPayment(payment._id, user, {
            ...meta,
            allowSelfApprove: true,
        });
    }

    const populated = await populatePayment(Payment.findById(payment._id));
    return serializePayment(populated);
};

const getPaymentOrFail = async (id, companyId, session = null) => {
    let q = Payment.findOne({ _id: id, ...NOT_DELETED });
    if (session) q = q.session(session);
    const payment = await q;
    assertDocumentCompany(payment, companyId, "Payment");
    return payment;
};

const approveSupplierPayment = async (id, user, meta = {}) => {
    if (!isOwner(user)) {
        throw new AppError("Only the owner can approve supplier payments.", 403);
    }
    const companyId = await ensureUserCompany(user);
    const payment = await getPaymentOrFail(id, companyId);

    if (
        payment.createdBy &&
        String(payment.createdBy) === String(user._id) &&
        payment.requiresApproval &&
        !meta.allowSelfApprove
    ) {
        throw new AppError(
            "You cannot approve your own payment request. Another owner must approve.",
            403
        );
    }

    if (payment.status !== "pendingApproval" && payment.status !== "draft") {
        throw new AppError(
            `Cannot approve payment in status "${payment.status}".`,
            400
        );
    }

    const old = { status: payment.status };
    applyStatusTransition(payment, "approved", user._id, {
        note: meta.note || "",
    });
    await payment.save();

    await auditPayment({
        user,
        companyId,
        branchId: payment.branchId,
        activityType: "Approve",
        description: `Supplier payment ${payment.paymentNumber} approved`,
        payment,
        oldData: old,
        reason: meta.note || "",
        ipAddress: meta.ipAddress || "",
    });

    const populated = await populatePayment(Payment.findById(payment._id));
    return serializePayment(populated);
};

/**
 * Complete (pay) an approved supplier payment inside a Mongo transaction.
 */
const completeSupplierPayment = async (id, user, meta = {}) => {
    if (!isOwner(user)) {
        throw new AppError("Only the owner can complete supplier payments.", 403);
    }
    const companyId = await ensureUserCompany(user);

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const payment = await getPaymentOrFail(id, companyId, session);

        if (payment.status === "paid") {
            throw new AppError("Payment is already completed.", 400);
        }
        if (payment.status === "pendingApproval" || payment.status === "draft") {
            applyStatusTransition(payment, "approved", user._id, {
                note: meta.note || "Auto-approved on complete",
            });
        }
        if (payment.status !== "approved" && payment.status !== "processing") {
            throw new AppError(
                `Cannot complete payment in status "${payment.status}".`,
                400
            );
        }

        if (
            (payment.paymentMethod === "CARD" ||
                payment.paymentMethod === "APPLE_PAY") &&
            payment.paymentProvider === "STRIPE"
        ) {
            const intentId =
                payment.providerPaymentIntentId ||
                meta.providerPaymentIntentId ||
                meta.providerTransactionId;
            if (!intentId) {
                throw new AppError(
                    "Stripe PaymentIntent id is required to complete CARD / APPLE_PAY payments.",
                    400
                );
            }
            const status = await getPaymentProvider("STRIPE").getPaymentStatus(
                String(intentId)
            );
            if (!status.succeeded) {
                throw new AppError(
                    `Stripe payment not succeeded (status=${status.status}).`,
                    400
                );
            }
            if (
                status.amountReceivedMinor != null &&
                Number(status.amountReceivedMinor) !== Number(payment.amountMinor)
            ) {
                throw new AppError("Stripe amount does not match payment.", 400);
            }
            payment.providerPaymentIntentId =
                status.providerPaymentIntentId || payment.providerPaymentIntentId;
            payment.providerTransactionId =
                status.providerTransactionId || String(intentId);
        } else if (
            (payment.paymentMethod === "CARD" ||
                payment.paymentMethod === "APPLE_PAY") &&
            !payment.providerTransactionId &&
            !meta.providerTransactionId
        ) {
            throw new AppError(
                "providerTransactionId is required to complete CARD / APPLE_PAY payments.",
                400
            );
        } else if (meta.providerTransactionId) {
            payment.providerTransactionId = String(meta.providerTransactionId);
        }

        applyStatusTransition(payment, "processing", user._id);
        await payment.save({ session });

        // Refresh payable then allocate
        await syncFromPurchaseOrder(payment.purchaseOrderId, {
            actorId: user._id,
            companyId,
            session,
            audit: false,
        });

        if (payment.purpose === "advance") {
            await applyAdvancePayment(payment.supplierPayableId, payment.amountMinor, {
                companyId,
                actorId: user._id,
                session,
            });
        } else {
            await applyAgainstPayablePayment(
                payment.supplierPayableId,
                payment.amountMinor,
                { companyId, actorId: user._id, session }
            );
        }

        applyStatusTransition(payment, "paid", user._id);
        payment.transactionDate = new Date();
        await payment.save({ session });

        // Keep legacy PO schedule / paidAmount in sync when phase was provided
        await syncLegacyPoSchedule(payment, user._id, session);

        await session.commitTransaction();

        await refreshSupplierDueSafe(payment.partyId || payment.supplierId);

        await auditPayment({
            user,
            companyId,
            branchId: payment.branchId,
            activityType: "Payment",
            description: `Supplier payment ${payment.paymentNumber} completed (${formatMoney(payment.amountMinor)})`,
            payment,
            ipAddress: meta.ipAddress || "",
        });

        const populated = await populatePayment(Payment.findById(payment._id));
        return serializePayment(populated);
    } catch (err) {
        if (session.inTransaction()) await session.abortTransaction();
        throw err;
    } finally {
        session.endSession();
    }
};

/**
 * Update PO supplierPaymentSchedule + header paid/due when payment references a phase.
 */
const syncLegacyPoSchedule = async (payment, actorId, session) => {
    const ref = String(payment.referenceType || "");
    const phaseMatch = /^SchedulePhase:(\d+)$/.exec(ref);
    if (!phaseMatch) {
        // Still bump PO paidAmount from payable totals for consistency
        return bumpPoPaidFromPayable(payment, actorId, session);
    }

    const phaseNo = parseInt(phaseMatch[1], 10);
    let poQ = PurchaseOrder.findOne({
        _id: payment.purchaseOrderId,
        ...NOT_DELETED,
    });
    if (session) poQ = poQ.session(session);
    const po = await poQ;
    if (!po) return;

    const schedule = Array.isArray(po.supplierPaymentSchedule)
        ? po.supplierPaymentSchedule
        : [];
    const phase = schedule.find((p) => Number(p.phase) === phaseNo);
    const payMajor = toMajor(payment.amountMinor, payment.currency);

    if (phase) {
        const already = Math.max(Number(phase.paidAmount) || 0, 0);
        phase.paidAmount = already + payMajor;
        const planned =
            phase.amountType === "Percentage"
                ? (Number(po.grandTotal) || 0) * ((Number(phase.amount) || 0) / 100)
                : Number(phase.amount) || 0;
        phase.isPaid = phase.paidAmount + 0.0001 >= planned;
        phase.paidAt = new Date();
        phase.paidBy = toObjectId(actorId);
        phase.paymentRef = payment.paymentNumber;
        phase.paymentNote = payment.note || "";
        phase.method = payment.paymentMethod;
        po.markModified("supplierPaymentSchedule");
    }

    // Recompute header from schedule if present, else from payable
    if (schedule.length) {
        let totalPaid = 0;
        for (const p of schedule) {
            totalPaid += Math.max(Number(p.paidAmount) || 0, 0);
        }
        po.paidAmount = totalPaid;
        po.dueAmount = Math.max((Number(po.grandTotal) || 0) - totalPaid, 0);
        if (po.dueAmount <= 0.0001) po.paymentStatus = "Paid";
        else if (totalPaid > 0) po.paymentStatus = "Partial";
        else po.paymentStatus = "Pending";
    }

    po.updatedBy = toObjectId(actorId);
    await po.save({ session });
};

const bumpPoPaidFromPayable = async (payment, actorId, session) => {
    let poQ = PurchaseOrder.findOne({
        _id: payment.purchaseOrderId,
        ...NOT_DELETED,
    });
    if (session) poQ = poQ.session(session);
    const po = await poQ;
    if (!po) return;

    // Prefer payable totals when schedule empty
    const schedule = Array.isArray(po.supplierPaymentSchedule)
        ? po.supplierPaymentSchedule
        : [];
    if (schedule.length) return;

    const payMajor = toMajor(payment.amountMinor, payment.currency);
    po.paidAmount = Math.max(Number(po.paidAmount) || 0, 0) + payMajor;
    po.dueAmount = Math.max((Number(po.grandTotal) || 0) - po.paidAmount, 0);
    if (po.dueAmount <= 0.0001) po.paymentStatus = "Paid";
    else if (po.paidAmount > 0) po.paymentStatus = "Partial";
    po.updatedBy = toObjectId(actorId);
    await po.save({ session });
};

const refreshSupplierDueSafe = async (supplierId, session = null) => {
    if (!supplierId) return;
    try {
        const { recomputeSupplierFinancials } = require("./supplierService");
        await recomputeSupplierFinancials(supplierId, { session });
    } catch (err) {
        console.warn(
            "[SupplierPayment] supplier due refresh failed:",
            err?.message || err
        );
    }
};

const cancelSupplierPayment = async (id, user, meta = {}) => {
    const companyId = await ensureUserCompany(user);
    const payment = await getPaymentOrFail(id, companyId);
    assertNotPaidLocked(payment);

    if (!["draft", "pendingApproval", "approved", "failed"].includes(payment.status)) {
        throw new AppError(
            `Cannot cancel payment in status "${payment.status}".`,
            400
        );
    }

    // Only owner or creator can cancel pending
    const owner = isOwner(user);
    if (
        !owner &&
        String(payment.createdBy) !== String(user._id)
    ) {
        throw new AppError("You can only cancel your own payment requests.", 403);
    }

    const old = { status: payment.status };
    applyStatusTransition(payment, "cancelled", user._id, {
        reason: meta.reason || "Cancelled",
    });
    await payment.save();

    await auditPayment({
        user,
        companyId,
        branchId: payment.branchId,
        activityType: "Cancel",
        description: `Supplier payment ${payment.paymentNumber} cancelled`,
        payment,
        oldData: old,
        reason: meta.reason || "",
        ipAddress: meta.ipAddress || "",
    });

    return serializePayment(await populatePayment(Payment.findById(payment._id)));
};

/**
 * Reverse a paid payment — keeps original auditable; creates reversal record.
 */
const reverseSupplierPayment = async (id, user, meta = {}) => {
    if (!isOwner(user)) {
        throw new AppError("Only the owner can reverse supplier payments.", 403);
    }
    const reason = String(meta.reason || "").trim();
    if (!reason) throw new AppError("Reversal reason is required.", 400);

    const companyId = await ensureUserCompany(user);
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const original = await getPaymentOrFail(id, companyId, session);
        if (original.status !== "paid") {
            throw new AppError("Only paid payments can be reversed.", 400);
        }
        if (original.reversalPaymentId) {
            throw new AppError("Payment was already reversed.", 400);
        }

        // Undo payable allocation
        if (original.purpose === "advance") {
            await reverseAppliedPayment(original.supplierPayableId, {
                advanceMinor: original.amountMinor,
                againstPayableMinor: 0,
                companyId,
                actorId: user._id,
                session,
            });
        } else {
            await reverseAppliedPayment(original.supplierPayableId, {
                advanceMinor: 0,
                againstPayableMinor: original.amountMinor,
                companyId,
                actorId: user._id,
                session,
            });
        }

        const reversalNumber = await generatePaymentNumber({ session });
        const [reversal] = await Payment.create(
            [
                {
                    companyId,
                    branchId: original.branchId,
                    paymentNumber: reversalNumber,
                    paymentDate: new Date(),
                    paymentType: original.paymentType,
                    purpose: original.purpose,
                    partyType: "Supplier",
                    partyId: original.partyId,
                    purchaseOrderId: original.purchaseOrderId,
                    supplierPayableId: original.supplierPayableId,
                    currency: original.currency,
                    amountMinor: original.amountMinor,
                    amount: original.amount,
                    paidAmountMinor: original.amountMinor,
                    paidAmount: original.amount,
                    dueAmountMinor: 0,
                    dueAmount: 0,
                    paymentMethod: original.paymentMethod,
                    paymentProvider: original.paymentProvider,
                    status: "reversed",
                    originalPaymentId: original._id,
                    reversedBy: user._id,
                    reversedAt: new Date(),
                    reversalReason: reason,
                    createdBy: user._id,
                    note: `Reversal of ${original.paymentNumber}`,
                    sourceModule: "Purchase",
                    requiresApproval: false,
                },
            ],
            { session }
        );

        applyStatusTransition(original, "reversed", user._id, {
            reason,
            originalPaymentId: original._id,
        });
        original.reversalPaymentId = reversal._id;
        original.reversalReason = reason;
        await original.save({ session });

        await session.commitTransaction();

        await auditPayment({
            user,
            companyId,
            branchId: original.branchId,
            activityType: "Update",
            description: `Supplier payment ${original.paymentNumber} reversed → ${reversal.paymentNumber}`,
            payment: original,
            reason,
            ipAddress: meta.ipAddress || "",
        });

        return {
            original: serializePayment(
                await populatePayment(Payment.findById(original._id))
            ),
            reversal: serializePayment(
                await populatePayment(Payment.findById(reversal._id))
            ),
        };
    } catch (err) {
        if (session.inTransaction()) await session.abortTransaction();
        throw err;
    } finally {
        session.endSession();
    }
};

const listSupplierPayments = async (companyId, query = {}) => {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const filter = {
        companyId,
        ...NOT_DELETED,
        partyType: "Supplier",
        paymentType: { $in: ["SupplierPayment", "SupplierAdvance"] },
    };
    if (query.supplierId) filter.partyId = toObjectId(query.supplierId);
    if (query.purchaseOrderId) {
        filter.purchaseOrderId = toObjectId(query.purchaseOrderId);
    }
    if (query.status) filter.status = String(query.status);
    if (query.purpose) filter.purpose = String(query.purpose);
    if (query.paymentMethod) {
        filter.paymentMethod = mapLegacyMethod(query.paymentMethod);
    }

    const [items, total] = await Promise.all([
        populatePayment(
            Payment.find(filter).sort({ paymentDate: -1 }).skip(skip).limit(limit)
        ),
        Payment.countDocuments(filter),
    ]);

    return {
        items: items.map(serializePayment),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit) || 1,
        },
    };
};

const getSupplierPaymentById = async (id, companyId) => {
    const payment = await populatePayment(
        Payment.findOne({ _id: id, ...NOT_DELETED })
    );
    assertDocumentCompany(payment, companyId, "Payment");
    return serializePayment(payment);
};

/**
 * Receipt payload for on-demand PDF / UI.
 */
const getSupplierPaymentReceipt = async (id, companyId) => {
    const payment = await getSupplierPaymentById(id, companyId);
    const supplier = await Supplier.findById(payment.partyId)
        .select("supplierCode name companyName phone email")
        .lean();

    let payable = null;
    if (payment.purchaseOrderId) {
        payable = await getPayableByPurchaseOrder(
            payment.purchaseOrderId._id || payment.purchaseOrderId,
            companyId
        );
    }

    return {
        receiptType: "SupplierPayment",
        currency: payment.currency || DEFAULT_CURRENCY,
        company: {
            // filled by caller if needed
        },
        supplier,
        payment,
        purchaseOrder: payment.purchaseOrderId,
        payable,
        remainingOutstanding: payable?.amounts?.outstanding ?? null,
        generatedAt: new Date().toISOString(),
    };
};

/**
 * Bridge from legacy PO schedule payment API.
 * Creates + completes a Payment and updates payable (owner assumed for legacy path).
 */
const recordViaLegacyPoSchedule = async (
    purchaseOrderId,
    payload = {},
    user
) => {
    if (!user?._id) throw new AppError("Authentication required.", 401);

    const companyId = await ensureUserCompany(user);
    const po = await loadPoOrFail(purchaseOrderId, companyId);
    const purpose = inferPurpose(po, payload.purpose);

    // Determine amount from payload (major units as legacy)
    const amountMajor =
        payload.paidAmount != null
            ? Number(payload.paidAmount)
            : payload.amount != null
              ? Number(payload.amount)
              : null;
    if (amountMajor == null || !(amountMajor > 0)) {
        throw new AppError("paidAmount must be greater than 0.", 400);
    }

    const created = await createSupplierPayment(
        {
            purchaseOrderId,
            amount: amountMajor,
            purpose,
            paymentMethod: payload.method || payload.paymentMethod || "BANK_TRANSFER",
            paymentProvider: payload.paymentProvider || "NONE",
            paymentRef: payload.paymentRef || payload.reference,
            note: payload.note || payload.paymentNote,
            phase: payload.phase,
            completeImmediately: isOwner(user),
            forcePending: !isOwner(user),
        },
        user,
        {}
    );

    // If employee created pending, also update schedule only after approve+complete.
    // Owner path already completed inside createSupplierPayment.
    if (!isOwner(user)) {
        return {
            payment: created,
            message:
                "Payment request submitted for owner approval. Schedule will update when completed.",
        };
    }

    return { payment: created };
};

module.exports = {
    mapLegacyMethod,
    createSupplierPayment,
    approveSupplierPayment,
    completeSupplierPayment,
    cancelSupplierPayment,
    reverseSupplierPayment,
    listSupplierPayments,
    getSupplierPaymentById,
    getSupplierPaymentReceipt,
    recordViaLegacyPoSchedule,
    serializePayment,
};
