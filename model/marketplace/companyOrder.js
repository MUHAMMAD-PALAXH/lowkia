const mongoose = require("mongoose");
const {
    COMPANY_ORDER_STATUSES,
    MARKETPLACE_CURRENCIES,
} = require("../../constants/marketplace");
const {
    addressSnapshotSchema,
    sellerSnapshotSchema,
    moneyTotalsSchema,
} = require("./sharedSchemas");

/**
 * Per-company slice of a MasterOrder. Strict tenant boundary via companyId.
 */
const companyOrderSchema = new mongoose.Schema(
    {
        orderNumber: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            uppercase: true,
        },
        masterOrderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "MasterOrder",
            required: true,
            index: true,
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Company",
            required: true,
            index: true,
        },
        seller: { type: sellerSnapshotSchema, required: true },
        status: {
            type: String,
            enum: COMPANY_ORDER_STATUSES,
            default: "pending",
            index: true,
        },
        currency: {
            type: String,
            default: "BDT",
            uppercase: true,
            enum: MARKETPLACE_CURRENCIES,
        },
        totals: { type: moneyTotalsSchema, required: true },
        itemCount: { type: Number, default: 0, min: 0 },
        shippingAddress: { type: addressSnapshotSchema, required: true },
        shippingRuleId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "ShippingRule",
            default: null,
        },
        estimatedDeliveryAt: { type: Date, default: null },
        confirmedAt: { type: Date, default: null },
        shippedAt: { type: Date, default: null },
        deliveredAt: { type: Date, default: null },
        cancelledAt: { type: Date, default: null },
        cancelReason: { type: String, default: "", trim: true },
        /** Optional ERP bridge — populated after payment + inventory reservation. */
        salesOrderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "SalesOrder",
            default: null,
            index: true,
        },
        erpCustomerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Customer",
            default: null,
        },
        companyNote: { type: String, default: "", trim: true },
        inventoryReservedAt: { type: Date, default: null },
        isDeleted: { type: Boolean, default: false, index: true },
    },
    { timestamps: true, versionKey: false }
);

companyOrderSchema.index({ companyId: 1, createdAt: -1 });
companyOrderSchema.index({ companyId: 1, status: 1, createdAt: -1 });
companyOrderSchema.index({ masterOrderId: 1, companyId: 1 }, { unique: true });
companyOrderSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("CompanyOrder", companyOrderSchema);
