const mongoose = require("mongoose");
const { SAAS_PAYMENT_METHODS } = require("../constants/saasBilling");

/**
 * Platform-wide destinations for offline subscription payments.
 * Keyed by currency + paymentMethod. Not company-scoped.
 */
const platformPaymentAccountSchema = new mongoose.Schema(
    {
        accountCode: {
            type: String,
            unique: true,
            sparse: true,
            trim: true,
            uppercase: true,
        },

        currency: {
            type: String,
            required: true,
            uppercase: true,
            trim: true,
            default: "USD",
            index: true,
        },

        paymentMethod: {
            type: String,
            required: true,
            enum: SAAS_PAYMENT_METHODS,
            index: true,
        },

        accountName: { type: String, default: "", trim: true },
        accountNumber: { type: String, default: "", trim: true },
        bankName: { type: String, default: "", trim: true },
        branchName: { type: String, default: "", trim: true },
        routingNumber: { type: String, default: "", trim: true },
        swiftCode: { type: String, default: "", trim: true },
        bankAddress: { type: String, default: "", trim: true },
        phoneNumber: { type: String, default: "", trim: true },
        qrImageUrl: { type: String, default: "", trim: true },
        instructions: { type: String, default: "", trim: true },

        isActive: { type: Boolean, default: true, index: true },
        sortOrder: { type: Number, default: 0 },

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
        deletedAt: { type: Date, default: null },
    },
    { timestamps: true, versionKey: false }
);

platformPaymentAccountSchema.index({
    currency: 1,
    paymentMethod: 1,
    isActive: 1,
    isDeleted: 1,
});

module.exports = mongoose.model(
    "PlatformPaymentAccount",
    platformPaymentAccountSchema
);
