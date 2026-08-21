const mongoose = require("mongoose");

/**
 * SaaS catalog plan (platform-owned).
 * Gateway-ready: priceMinor + currency; no Stripe wiring in V1.
 */
const subscriptionPlanSchema = new mongoose.Schema(
    {
        planCode: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            uppercase: true,
        },

        name: {
            type: String,
            required: true,
            trim: true,
        },

        description: {
            type: String,
            default: "",
            trim: true,
        },

        billingInterval: {
            type: String,
            enum: ["monthly", "yearly"],
            required: true,
        },

        /** Amount in minor units (e.g. cents). */
        priceMinor: {
            type: Number,
            required: true,
            min: 0,
        },

        currency: {
            type: String,
            default: "USD",
            uppercase: true,
            trim: true,
        },

        trialDays: {
            type: Number,
            default: 14,
            min: 0,
        },

        /** Soft limits for future enforcement. */
        limits: {
            maxUsers: { type: Number, default: 10 },
            maxBranches: { type: Number, default: 5 },
            maxWarehouses: { type: Number, default: 10 },
            maxProducts: { type: Number, default: 5000 },
        },

        /** Feature flags (string keys). */
        features: {
            type: [String],
            default: [],
        },

        isActive: {
            type: Boolean,
            default: true,
            index: true,
        },

        sortOrder: {
            type: Number,
            default: 0,
        },

        /** Future gateway product ids (Stripe etc.) — unused in V1. */
        gateway: {
            provider: { type: String, default: "" },
            productId: { type: String, default: "" },
            priceId: { type: String, default: "" },
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

subscriptionPlanSchema.index({ billingInterval: 1, isActive: 1 });

module.exports = mongoose.model("SubscriptionPlan", subscriptionPlanSchema);
