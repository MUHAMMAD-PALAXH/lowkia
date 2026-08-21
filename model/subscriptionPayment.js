const mongoose = require("mongoose");
const {
    SAAS_PAYMENT_METHODS,
    SUBSCRIPTION_PAYMENT_STATUSES,
} = require("../constants/saasBilling");

/**
 * Offline subscription payment submitted by a company for verification.
 * Distinct from ERP Payment model.
 */
const subscriptionPaymentSchema = new mongoose.Schema(
    {
        paymentNumber: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            uppercase: true,
        },

        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Company",
            required: true,
            index: true,
        },

        invoiceId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "SubscriptionInvoice",
            required: true,
            index: true,
        },

        subscriptionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "CompanySubscription",
            required: true,
            index: true,
        },

        paymentAccountId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "PlatformPaymentAccount",
            default: null,
        },

        /** Snapshot of account used at submit time. */
        paymentAccountSnapshot: {
            type: mongoose.Schema.Types.Mixed,
            default: null,
        },

        amountMinor: { type: Number, required: true, min: 0 },
        currency: {
            type: String,
            required: true,
            uppercase: true,
            trim: true,
        },

        paymentMethod: {
            type: String,
            required: true,
            enum: SAAS_PAYMENT_METHODS,
            index: true,
        },

        transactionId: { type: String, default: "", trim: true, index: true },
        paymentDate: { type: Date, required: true },
        proofUrl: { type: String, default: "", trim: true },
        note: { type: String, default: "", trim: true },

        status: {
            type: String,
            enum: SUBSCRIPTION_PAYMENT_STATUSES,
            default: "pending_verification",
            index: true,
        },

        rejectionReason: { type: String, default: "", trim: true },
        rejectionNote: { type: String, default: "", trim: true },
        rejectedAt: { type: Date, default: null },
        rejectedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },

        verifiedAt: { type: Date, default: null },
        verifiedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },

        submittedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },

        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },

        isDeleted: { type: Boolean, default: false, index: true },
    },
    { timestamps: true, versionKey: false }
);

subscriptionPaymentSchema.index({
    companyId: 1,
    status: 1,
    createdAt: -1,
});
subscriptionPaymentSchema.index({
    invoiceId: 1,
    status: 1,
});
// Prevent reuse of the same TrxID + method across pending/verified payments.
subscriptionPaymentSchema.index(
    { paymentMethod: 1, transactionId: 1 },
    {
        unique: true,
        partialFilterExpression: {
            transactionId: { $type: "string", $gt: "" },
            status: { $in: ["pending_verification", "verified"] },
            isDeleted: { $ne: true },
        },
    }
);

module.exports = mongoose.model(
    "SubscriptionPayment",
    subscriptionPaymentSchema
);
