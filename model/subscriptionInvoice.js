const mongoose = require("mongoose");
const {
    SUBSCRIPTION_INVOICE_STATUSES,
    SUBSCRIPTION_PAYMENT_INTENTS,
    SAAS_PAYMENT_METHODS,
} = require("../constants/saasBilling");

/**
 * SaaS subscription invoice (platform billing).
 * Distinct from ERP SalesInvoice.
 */
const subscriptionInvoiceSchema = new mongoose.Schema(
    {
        invoiceNumber: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            uppercase: true,
        },

        /** Display reference companies include when paying offline. */
        paymentReference: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            uppercase: true,
            index: true,
        },

        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Company",
            required: true,
            index: true,
        },

        subscriptionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "CompanySubscription",
            required: true,
            index: true,
        },

        planId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "SubscriptionPlan",
            required: true,
        },

        planCode: { type: String, default: "", trim: true, uppercase: true },
        planName: { type: String, default: "", trim: true },
        billingInterval: {
            type: String,
            enum: ["monthly", "yearly"],
            required: true,
        },

        intent: {
            type: String,
            enum: SUBSCRIPTION_PAYMENT_INTENTS,
            default: "new",
            index: true,
        },

        amountMinor: { type: Number, required: true, min: 0 },
        currency: {
            type: String,
            required: true,
            uppercase: true,
            trim: true,
            default: "USD",
        },

        status: {
            type: String,
            enum: SUBSCRIPTION_INVOICE_STATUSES,
            default: "unpaid",
            index: true,
        },

        preferredPaymentMethod: {
            type: String,
            enum: SAAS_PAYMENT_METHODS,
        },

        paymentAccountId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "PlatformPaymentAccount",
            default: null,
        },

        currentPaymentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "SubscriptionPayment",
            default: null,
        },

        dueAt: { type: Date, default: null },
        paidAt: { type: Date, default: null },

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

subscriptionInvoiceSchema.index({ companyId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model(
    "SubscriptionInvoice",
    subscriptionInvoiceSchema
);
