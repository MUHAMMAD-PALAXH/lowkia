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
            enum: ["monthly", "quarterly", "yearly", "lifetime"],
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

        /** Extra list prices (USD, BDT, …). First entry matches currency/priceMinor. */
        prices: {
            type: [
                {
                    _id: false,
                    currency: {
                        type: String,
                        uppercase: true,
                        trim: true,
                    },
                    priceMinor: { type: Number, min: 0 },
                },
            ],
            default: [],
        },

        trialDays: {
            type: Number,
            default: 14,
            min: 0,
        },

        /** Soft limits — null qty = Unlimited. Nested caps for roles / product sources. */
        limits: {
            type: mongoose.Schema.Types.Mixed,
            default: () => ({
                maxUsers: 10,
                maxBranches: 5,
                maxWarehouses: 10,
                maxProducts: 5000,
                maxSuppliers: 50,
            }),
        },

        /** Feature flags (string keys). */
        features: {
            type: [String],
            default: [],
        },

        /**
         * Catalog status. isActive is kept in sync for legacy filters.
         * Active = available for new subs; Inactive = not sold; Archived = historical only.
         */
        status: {
            type: String,
            enum: ["Active", "Inactive", "Archived"],
            default: "Active",
            index: true,
        },

        isActive: {
            type: Boolean,
            default: true,
            index: true,
        },

        visibility: {
            type: String,
            enum: ["Public", "Private"],
            default: "Public",
        },

        isRecommended: {
            type: Boolean,
            default: false,
        },

        /** Optional product-family key for UI grouping (e.g. STARTER, PRO). */
        productFamily: {
            type: String,
            default: "",
            trim: true,
            uppercase: true,
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
