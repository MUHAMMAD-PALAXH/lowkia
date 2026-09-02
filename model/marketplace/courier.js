const mongoose = require("mongoose");
const { COURIER_TYPES } = require("../../constants/marketplace");
const baseModelPlugin = require("../plugins/baseModel.plugin");

/**
 * Courier provider catalog — platform-wide or company-specific.
 * companyId null = platform-managed courier available to all sellers.
 */
const courierSchema = new mongoose.Schema(
    {
        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Company",
            default: null,
            index: true,
        },
        code: {
            type: String,
            required: true,
            trim: true,
            uppercase: true,
        },
        name: { type: String, required: true, trim: true },
        courierType: {
            type: String,
            enum: COURIER_TYPES,
            default: "other",
            index: true,
        },
        trackingUrlTemplate: {
            type: String,
            default: "",
            trim: true,
            /** e.g. https://track.example.com/{trackingNumber} */
        },
        isActive: { type: Boolean, default: true, index: true },
        metadata: { type: mongoose.Schema.Types.Mixed, default: null },
    },
    { timestamps: true, versionKey: false }
);

courierSchema.plugin(baseModelPlugin);

courierSchema.index(
    { companyId: 1, code: 1 },
    { unique: true, partialFilterExpression: { isDeleted: false } }
);

module.exports = mongoose.model("Courier", courierSchema);
