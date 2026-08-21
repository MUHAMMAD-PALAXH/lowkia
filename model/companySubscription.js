const mongoose = require("mongoose");

/**
 * Per-company subscription instance.
 * V1: manual mark-paid only. Gateway fields reserved for later.
 */
const companySubscriptionSchema = new mongoose.Schema(
    {
        subscriptionNumber: {
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

        planId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "SubscriptionPlan",
            required: true,
            index: true,
        },

        /** Snapshot at assign time (plan may change later). */
        planCode: { type: String, default: "", trim: true, uppercase: true },
        planName: { type: String, default: "", trim: true },
        billingInterval: {
            type: String,
            enum: ["monthly", "yearly"],
            required: true,
        },

        status: {
            type: String,
            enum: ["trialing", "active", "past_due", "cancelled", "expired"],
            default: "trialing",
            index: true,
        },

        paymentStatus: {
            type: String,
            enum: ["unpaid", "paid", "waived", "refunded"],
            default: "unpaid",
            index: true,
        },

        amountMinor: { type: Number, default: 0, min: 0 },
        currency: {
            type: String,
            default: "USD",
            uppercase: true,
            trim: true,
        },

        trialStartsAt: { type: Date, default: null },
        trialEndsAt: { type: Date, default: null },

        currentPeriodStart: { type: Date, default: null },
        currentPeriodEnd: { type: Date, default: null },

        paidAt: { type: Date, default: null },
        paidBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },
        paymentNote: { type: String, default: "", trim: true },
        paymentMethod: {
            type: String,
            enum: ["manual", "bank_transfer", "cash", "other", "gateway"],
            default: "manual",
        },

        cancelledAt: { type: Date, default: null },
        cancelReason: { type: String, default: "", trim: true },

        limits: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        features: {
            type: [String],
            default: [],
        },

        /** Reserved for Stripe / other gateways. */
        gateway: {
            provider: { type: String, default: "" },
            customerId: { type: String, default: "" },
            subscriptionId: { type: String, default: "" },
            lastInvoiceId: { type: String, default: "" },
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

        isDeleted: {
            type: Boolean,
            default: false,
            index: true,
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

companySubscriptionSchema.index({ companyId: 1, status: 1 });
companySubscriptionSchema.index({ companyId: 1, createdAt: -1 });

module.exports = mongoose.model(
    "CompanySubscription",
    companySubscriptionSchema
);
