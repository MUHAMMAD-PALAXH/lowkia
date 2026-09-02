const mongoose = require("mongoose");
const {
    SHIPPING_RULE_TYPES,
    MARKETPLACE_CURRENCIES,
} = require("../../constants/marketplace");
const baseModelPlugin = require("../plugins/baseModel.plugin");

/**
 * Per-company shipping fee rules (flat, free threshold, zone-based).
 */
const shippingRuleSchema = new mongoose.Schema(
    {
        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Company",
            required: true,
            index: true,
        },
        name: { type: String, required: true, trim: true },
        ruleType: {
            type: String,
            enum: SHIPPING_RULE_TYPES,
            required: true,
            default: "flat",
        },
        currency: {
            type: String,
            default: "BDT",
            uppercase: true,
            enum: MARKETPLACE_CURRENCIES,
        },
        flatFee: { type: Number, default: 0, min: 0 },
        freeShippingThreshold: { type: Number, default: null, min: 0 },
        /** Zone-based: [{ district, city, fee, estimatedDays }] */
        zones: {
            type: [
                {
                    district: { type: String, default: "", trim: true },
                    city: { type: String, default: "", trim: true },
                    fee: { type: Number, required: true, min: 0 },
                    estimatedDays: { type: Number, default: 3, min: 0 },
                },
            ],
            default: [],
        },
        estimatedDeliveryDays: { type: Number, default: 3, min: 0 },
        isDefault: { type: Boolean, default: false, index: true },
        isActive: { type: Boolean, default: true, index: true },
        priority: { type: Number, default: 0 },
    },
    { timestamps: true, versionKey: false }
);

shippingRuleSchema.plugin(baseModelPlugin);

shippingRuleSchema.index({ companyId: 1, isActive: 1, isDefault: 1 });

module.exports = mongoose.model("ShippingRule", shippingRuleSchema);
