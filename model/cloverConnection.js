const mongoose = require("mongoose");

/**
 * Company-scoped Clover merchant + Flex device binding.
 * Tokens stored encrypted — never return raw access/refresh to clients.
 */
const cloverDeviceSchema = new mongoose.Schema(
    {
        serialNumber: { type: String, required: true, trim: true },
        name: { type: String, default: "", trim: true },
        isActive: { type: Boolean, default: true },
        isDefault: { type: Boolean, default: false },
        lastSeenAt: { type: Date, default: null },
        lastError: { type: String, default: "", trim: true },
    },
    { _id: true }
);

const cloverConnectionSchema = new mongoose.Schema(
    {
        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Company",
            required: true,
            unique: true,
            index: true,
        },

        environment: {
            type: String,
            enum: ["sandbox", "production"],
            default: "sandbox",
            index: true,
        },

        merchantId: { type: String, default: "", trim: true, index: true },
        merchantName: { type: String, default: "", trim: true },

        /** Encrypted OAuth access token */
        accessTokenEnc: { type: String, default: "" },
        /** Encrypted OAuth refresh token */
        refreshTokenEnc: { type: String, default: "" },
        tokenExpiresAt: { type: Date, default: null },

        posId: { type: String, default: "LOWKIA-ADMIN", trim: true },
        raid: { type: String, default: "", trim: true },

        devices: { type: [cloverDeviceSchema], default: [] },

        isActive: { type: Boolean, default: true, index: true },
        connectedAt: { type: Date, default: null },
        lastUsedAt: { type: Date, default: null },

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

cloverConnectionSchema.index({
    companyId: 1,
    isDeleted: 1,
    isActive: 1,
});

module.exports = mongoose.model("CloverConnection", cloverConnectionSchema);
