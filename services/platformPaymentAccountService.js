const PlatformPaymentAccount = require("../model/platformPaymentAccount");
const SubscriptionPayment = require("../model/subscriptionPayment");
const AppError = require("../utils/appError");
const { generateCode } = require("./codeGenerator");
const { writeActivityLog } = require("./activityLogService");
const { SAAS_V1_PAYMENT_METHODS } = require("../constants/saasBilling");

const NOT_DELETED = { isDeleted: { $ne: true } };

const accountFilter = (extra = {}) => ({ ...NOT_DELETED, ...extra });

const assertMethod = (method) => {
    const m = String(method || "")
        .trim()
        .toLowerCase();
    if (!SAAS_V1_PAYMENT_METHODS.includes(m) && m !== "manual" && m !== "other") {
        // Allow full enum from model; soft-warn only for unknown V1 subset
    }
    return m;
};

const validateAccountFields = (payload = {}) => {
    const method = assertMethod(payload.paymentMethod);
    const currency = String(payload.currency || "USD")
        .trim()
        .toUpperCase();
    if (!currency || currency.length < 3) {
        throw new AppError("currency is required (ISO code).", 400);
    }
    if (!method) throw new AppError("paymentMethod is required.", 400);

    if (method === "bank_transfer") {
        if (!String(payload.bankName || "").trim()) {
            throw new AppError("bankName is required for bank transfer.", 400);
        }
        if (!String(payload.accountName || "").trim()) {
            throw new AppError(
                "accountName is required for bank transfer.",
                400
            );
        }
        if (!String(payload.accountNumber || "").trim()) {
            throw new AppError(
                "accountNumber is required for bank transfer.",
                400
            );
        }
    }

    if (["bkash", "nagad", "rocket"].includes(method)) {
        if (!String(payload.accountName || "").trim()) {
            throw new AppError(
                "accountName is required for mobile wallet accounts.",
                400
            );
        }
        if (
            !String(payload.accountNumber || "").trim() &&
            !String(payload.phoneNumber || "").trim()
        ) {
            throw new AppError(
                "accountNumber or phoneNumber is required for mobile wallet.",
                400
            );
        }
    }

    return { method, currency };
};

const toPublicAccount = (doc) => {
    if (!doc) return null;
    const o = doc.toObject ? doc.toObject() : doc;
    return {
        id: String(o._id),
        _id: o._id,
        accountCode: o.accountCode || "",
        currency: o.currency,
        paymentMethod: o.paymentMethod,
        accountName: o.accountName || "",
        accountNumber: o.accountNumber || "",
        bankName: o.bankName || "",
        branchName: o.branchName || "",
        routingNumber: o.routingNumber || "",
        swiftCode: o.swiftCode || "",
        bankAddress: o.bankAddress || "",
        phoneNumber: o.phoneNumber || "",
        qrImageUrl: o.qrImageUrl || "",
        instructions: o.instructions || "",
        isActive: !!o.isActive,
        sortOrder: o.sortOrder || 0,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
    };
};

const listPaymentAccounts = async (query = {}) => {
    const filter = accountFilter();
    if (query.currency) {
        filter.currency = String(query.currency).trim().toUpperCase();
    }
    if (query.paymentMethod) {
        filter.paymentMethod = String(query.paymentMethod)
            .trim()
            .toLowerCase();
    }
    if (query.isActive === "true" || query.isActive === true) {
        filter.isActive = true;
    } else if (query.isActive === "false" || query.isActive === false) {
        filter.isActive = false;
    }

    const rows = await PlatformPaymentAccount.find(filter)
        .sort({ sortOrder: 1, currency: 1, paymentMethod: 1, createdAt: -1 })
        .lean();
    return rows.map(toPublicAccount);
};

/**
 * Active accounts for company checkout (instructions view).
 */
const listActiveAccountsForCheckout = async ({
    currency,
    paymentMethod,
} = {}) => {
    const filter = accountFilter({ isActive: true });
    if (currency) filter.currency = String(currency).trim().toUpperCase();
    if (paymentMethod) {
        filter.paymentMethod = String(paymentMethod).trim().toLowerCase();
    }
    const rows = await PlatformPaymentAccount.find(filter)
        .sort({ sortOrder: 1, createdAt: -1 })
        .lean();
    return rows.map(toPublicAccount);
};

const getPaymentAccount = async (id) => {
    const doc = await PlatformPaymentAccount.findOne(
        accountFilter({ _id: id })
    );
    if (!doc) throw new AppError("Payment account not found.", 404);
    return toPublicAccount(doc);
};

const createPaymentAccount = async (payload, actor) => {
    const { method, currency } = validateAccountFields(payload);
    const accountCode = await generateCode("platform_payment_account");

    const doc = await PlatformPaymentAccount.create({
        accountCode,
        currency,
        paymentMethod: method,
        accountName: String(payload.accountName || "").trim(),
        accountNumber: String(payload.accountNumber || "").trim(),
        bankName: String(payload.bankName || "").trim(),
        branchName: String(payload.branchName || "").trim(),
        routingNumber: String(payload.routingNumber || "").trim(),
        swiftCode: String(payload.swiftCode || "").trim(),
        bankAddress: String(payload.bankAddress || "").trim(),
        phoneNumber: String(payload.phoneNumber || "").trim(),
        qrImageUrl: String(payload.qrImageUrl || "").trim(),
        instructions: String(payload.instructions || "").trim(),
        isActive: payload.isActive !== false,
        sortOrder: Number(payload.sortOrder) || 0,
        createdBy: actor?._id || null,
        updatedBy: actor?._id || null,
    });

    await writeActivityLog({
        user: actor,
        companyId: null,
        activityType: "Create",
        module: "Platform",
        subModule: "PaymentAccount",
        description: `Created payment account ${accountCode} (${currency}/${method})`,
        shortDescription: `Create ${accountCode}`,
        referenceType: "PlatformPaymentAccount",
        referenceId: doc._id,
        newData: toPublicAccount(doc),
        securityLevel: "High",
    });

    return toPublicAccount(doc);
};

const updatePaymentAccount = async (id, payload, actor) => {
    const doc = await PlatformPaymentAccount.findOne(
        accountFilter({ _id: id })
    );
    if (!doc) throw new AppError("Payment account not found.", 404);

    if (payload.paymentMethod != null || payload.currency != null) {
        validateAccountFields({
            paymentMethod: payload.paymentMethod || doc.paymentMethod,
            currency: payload.currency || doc.currency,
            accountName:
                payload.accountName !== undefined
                    ? payload.accountName
                    : doc.accountName,
            accountNumber:
                payload.accountNumber !== undefined
                    ? payload.accountNumber
                    : doc.accountNumber,
            bankName:
                payload.bankName !== undefined ? payload.bankName : doc.bankName,
            phoneNumber:
                payload.phoneNumber !== undefined
                    ? payload.phoneNumber
                    : doc.phoneNumber,
        });
    }

    const fields = [
        "currency",
        "paymentMethod",
        "accountName",
        "accountNumber",
        "bankName",
        "branchName",
        "routingNumber",
        "swiftCode",
        "bankAddress",
        "phoneNumber",
        "qrImageUrl",
        "instructions",
        "isActive",
        "sortOrder",
    ];
    for (const key of fields) {
        if (payload[key] === undefined) continue;
        if (key === "currency") {
            doc.currency = String(payload.currency).trim().toUpperCase();
        } else if (key === "paymentMethod") {
            doc.paymentMethod = assertMethod(payload.paymentMethod);
        } else if (key === "isActive") {
            doc.isActive = !!payload.isActive;
        } else if (key === "sortOrder") {
            doc.sortOrder = Number(payload.sortOrder) || 0;
        } else {
            doc[key] = String(payload[key] || "").trim();
        }
    }
    doc.updatedBy = actor?._id || doc.updatedBy;
    await doc.save();

    await writeActivityLog({
        user: actor,
        companyId: null,
        activityType: "Update",
        module: "Platform",
        subModule: "PaymentAccount",
        description: `Updated payment account ${doc.accountCode || doc._id}`,
        shortDescription: `Update account`,
        referenceType: "PlatformPaymentAccount",
        referenceId: doc._id,
        newData: toPublicAccount(doc),
        securityLevel: "Medium",
    });

    return toPublicAccount(doc);
};

const setPaymentAccountActive = async (id, isActive, actor) => {
    return updatePaymentAccount(id, { isActive: !!isActive }, actor);
};

const softDeletePaymentAccount = async (id, actor) => {
    const doc = await PlatformPaymentAccount.findOne(
        accountFilter({ _id: id })
    );
    if (!doc) throw new AppError("Payment account not found.", 404);

    const referenced = await SubscriptionPayment.exists({
        paymentAccountId: doc._id,
        isDeleted: { $ne: true },
    });
    if (referenced) {
        doc.isActive = false;
        doc.updatedBy = actor?._id || doc.updatedBy;
        await doc.save();
        await writeActivityLog({
            user: actor,
            companyId: null,
            activityType: "Update",
            module: "Platform",
            subModule: "PaymentAccount",
            description: `Deactivated payment account ${doc.accountCode} (referenced by payments; soft-delete blocked)`,
            shortDescription: `Deactivate ${doc.accountCode}`,
            referenceType: "PlatformPaymentAccount",
            referenceId: doc._id,
            securityLevel: "High",
        });
        return {
            ...toPublicAccount(doc),
            deleted: false,
            deactivatedOnly: true,
        };
    }

    doc.isDeleted = true;
    doc.deletedAt = new Date();
    doc.isActive = false;
    doc.updatedBy = actor?._id || doc.updatedBy;
    await doc.save();

    await writeActivityLog({
        user: actor,
        companyId: null,
        activityType: "Delete",
        module: "Platform",
        subModule: "PaymentAccount",
        description: `Soft-deleted payment account ${doc.accountCode || doc._id}`,
        shortDescription: `Delete ${doc.accountCode}`,
        referenceType: "PlatformPaymentAccount",
        referenceId: doc._id,
        securityLevel: "High",
    });

    return { ...toPublicAccount(doc), deleted: true, deactivatedOnly: false };
};

module.exports = {
    listPaymentAccounts,
    listActiveAccountsForCheckout,
    getPaymentAccount,
    createPaymentAccount,
    updatePaymentAccount,
    setPaymentAccountActive,
    softDeletePaymentAccount,
    toPublicAccount,
};
