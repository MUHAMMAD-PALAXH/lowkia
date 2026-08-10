const { writeActivityLog } = require("./activityLogService");
const {
    assertTransition,
    assertValidStatus,
    isEditable,
    isPaidLocked,
} = require("./paymentStateMachine");
const {
    PAYMENT_METHODS,
    PAYMENT_PROVIDERS,
    PAYMENT_PURPOSES,
    DEFAULT_CURRENCY,
} = require("../config/finance");
const {
    assertCurrency,
    assertPositiveMinor,
    toMajor,
    toMinor,
} = require("../utils/money");
const AppError = require("../utils/appError");
const { generateCode } = require("./codeGenerator");

/**
 * Shared ERP payment foundation (Phase 1).
 * Business-specific services (supplier / employee) will call these helpers.
 */

const assertPaymentMethod = (method) => {
    const m = String(method || "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "_");
    // Accept common aliases
    const aliases = {
        CHEQUE: "CHECK",
        "BANK-TRANSFER": "BANK_TRANSFER",
        BANKTRANSFER: "BANK_TRANSFER",
        APPLEPAY: "APPLE_PAY",
        "APPLE-PAY": "APPLE_PAY",
    };
    const normalized = aliases[m] || m;
    if (!PAYMENT_METHODS.includes(normalized)) {
        throw new AppError(
            `Invalid payment method. Allowed: ${PAYMENT_METHODS.join(", ")}`,
            400
        );
    }
    return normalized;
};

const assertPaymentProvider = (provider) => {
    const p = String(provider || "NONE")
        .trim()
        .toUpperCase();
    if (!PAYMENT_PROVIDERS.includes(p)) {
        throw new AppError(
            `Invalid payment provider. Allowed: ${PAYMENT_PROVIDERS.join(", ")}`,
            400
        );
    }
    return p;
};

const assertPaymentPurpose = (purpose) => {
    const p = String(purpose || "other").trim();
    if (!PAYMENT_PURPOSES.includes(p)) {
        throw new AppError(
            `Invalid payment purpose. Allowed: ${PAYMENT_PURPOSES.join(", ")}`,
            400
        );
    }
    return p;
};

/**
 * Normalize inbound payment payload amounts to minor units.
 * Accepts either amountMinor or major `amount`.
 */
const resolveAmountMinor = (payload = {}, currency = DEFAULT_CURRENCY) => {
    const code = assertCurrency(currency || payload.currency || DEFAULT_CURRENCY);
    if (payload.amountMinor != null && payload.amountMinor !== "") {
        return {
            amountMinor: assertPositiveMinor(payload.amountMinor),
            currency: code,
            amount: toMajor(payload.amountMinor, code),
        };
    }
    if (payload.amount != null && payload.amount !== "") {
        const minor = toMinor(payload.amount, code);
        return {
            amountMinor: assertPositiveMinor(minor),
            currency: code,
            amount: toMajor(minor, code),
        };
    }
    throw new AppError("Payment amount is required.", 400);
};

const assertMethodProviderCombo = (method, provider) => {
    const m = assertPaymentMethod(method);
    const p = assertPaymentProvider(provider);

    // Card / Apple Pay must go through a PCI provider (never raw card storage).
    if ((m === "CARD" || m === "APPLE_PAY") && p === "NONE") {
        throw new AppError(
            `${m} requires a payment provider (e.g. STRIPE). Raw card data is not stored.`,
            400
        );
    }
    if (m === "CASH" && p !== "NONE" && p !== "OTHER") {
        // Allow OTHER; prefer NONE for cash
    }
    return { paymentMethod: m, paymentProvider: p };
};

const generatePaymentNumber = async (options = {}) => {
    return generateCode("payment", options);
};

/**
 * Apply a validated status transition onto a payment document (in-memory).
 * Caller persists inside a Mongo transaction when needed.
 */
const applyStatusTransition = (payment, nextStatus, actorId, meta = {}) => {
    const current = assertValidStatus(payment.status);
    const next = assertTransition(current, nextStatus);

    payment.status = next;

    if (next === "pendingApproval") {
        payment.requiresApproval = true;
    }
    if (next === "approved") {
        payment.approvedBy = actorId;
        payment.approvedAt = new Date();
        if (meta.note) payment.approvalNote = meta.note;
    }
    if (next === "paid") {
        payment.postedBy = actorId;
        payment.postedAt = new Date();
        payment.paidAmountMinor =
            payment.paidAmountMinor != null
                ? payment.paidAmountMinor
                : payment.amountMinor;
        payment.paidAmount = toMajor(
            payment.paidAmountMinor,
            payment.currency || DEFAULT_CURRENCY
        );
        payment.dueAmountMinor = 0;
        payment.dueAmount = 0;
    }
    if (next === "cancelled") {
        payment.cancelledBy = actorId;
        payment.cancelledAt = new Date();
        if (meta.reason) payment.cancellationReason = meta.reason;
    }
    if (next === "reversed") {
        payment.reversedBy = actorId;
        payment.reversedAt = new Date();
        if (meta.reason) payment.reversalReason = meta.reason;
        if (meta.originalPaymentId) {
            payment.originalPaymentId = meta.originalPaymentId;
        }
    }
    if (next === "failed" && meta.reason) {
        payment.failureReason = meta.reason;
    }

    payment.updatedBy = actorId;
    return payment;
};

const assertPaymentEditable = (payment) => {
    if (!isEditable(payment.status)) {
        throw new AppError(
            `Payment in status "${payment.status}" cannot be edited. Use cancel/reverse where allowed.`,
            400
        );
    }
};

const assertNotPaidLocked = (payment) => {
    if (isPaidLocked(payment.status)) {
        throw new AppError(
            "Paid payments cannot be edited. Create a reversal instead.",
            400
        );
    }
};

const auditPayment = async ({
    user,
    companyId,
    branchId = null,
    activityType,
    description,
    payment,
    oldData = null,
    reason = "",
    ipAddress = "",
}) => {
    await writeActivityLog({
        user,
        companyId,
        branchId: branchId || payment?.branchId || null,
        activityType,
        module: "Payment",
        subModule: payment?.paymentType || "",
        description,
        shortDescription: description?.slice?.(0, 120) || "",
        referenceType: "Payment",
        referenceId: payment?._id || null,
        oldData,
        newData: payment
            ? {
                  paymentNumber: payment.paymentNumber,
                  status: payment.status,
                  amountMinor: payment.amountMinor,
                  currency: payment.currency,
                  paymentMethod: payment.paymentMethod,
                  paymentProvider: payment.paymentProvider,
                  reason,
              }
            : null,
        changedFields: reason ? ["status", "reason"] : ["status"],
        ipAddress,
        securityLevel: "High",
    });
};

module.exports = {
    assertPaymentMethod,
    assertPaymentProvider,
    assertPaymentPurpose,
    resolveAmountMinor,
    assertMethodProviderCombo,
    generatePaymentNumber,
    applyStatusTransition,
    assertPaymentEditable,
    assertNotPaidLocked,
    auditPayment,
};
