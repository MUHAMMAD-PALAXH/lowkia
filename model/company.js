const mongoose = require("mongoose");

/**
 * SaaS tenant (Company).
 * Every tenant-owned financial document must reference companyId.
 */
const companySchema = new mongoose.Schema(
    {
        companyCode: {
            type: String,
            required: true,
            trim: true,
            uppercase: true,
            unique: true,
        },

        legalName: {
            type: String,
            required: true,
            trim: true,
        },

        tradeName: {
            type: String,
            default: "",
            trim: true,
        },

        logoUrl: {
            type: String,
            default: "",
            trim: true,
        },

        /** ISO 4217. V1 actively supports USD; field remains for multi-currency later. */
        defaultCurrency: {
            type: String,
            default: "USD",
            uppercase: true,
            trim: true,
        },

        countryCode: {
            type: String,
            default: "US",
            uppercase: true,
            trim: true,
        },

        timezone: {
            type: String,
            default: "America/New_York",
            trim: true,
        },

        status: {
            type: String,
            enum: ["Trial", "Active", "Suspended", "Cancelled", "Closed"],
            default: "Active",
        },

        /**
         * Lightweight company settings (branding, locale extras).
         * Keep small; heavy config belongs in dedicated collections later.
         */
        settings: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },

        /** Populated when subscription module is wired (Phase 4). */
        currentSubscriptionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "CompanySubscription",
            default: null,
        },

        trialEndsAt: {
            type: Date,
            default: null,
        },

        isDefault: {
            type: Boolean,
            default: false,
            index: true,
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

        deletedAt: {
            type: Date,
            default: null,
        },

        deletedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

companySchema.index({ status: 1, isDeleted: 1 });

module.exports = mongoose.model("Company", companySchema);
