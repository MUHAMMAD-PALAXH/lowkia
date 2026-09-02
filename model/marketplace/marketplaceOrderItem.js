const mongoose = require("mongoose");
const {
    productLineSnapshotSchema,
    sellerSnapshotSchema,
} = require("./sharedSchemas");

/**
 * Marketplace order line (distinct from SalesOrder embedded items).
 */
const marketplaceOrderItemSchema = new mongoose.Schema(
    {
        masterOrderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "MasterOrder",
            required: true,
            index: true,
        },
        companyOrderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "CompanyOrder",
            required: true,
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Company",
            required: true,
            index: true,
        },
        seller: { type: sellerSnapshotSchema, required: true },
        product: { type: productLineSnapshotSchema, required: true },
        quantity: { type: Number, required: true, min: 1 },
        lineSubtotal: { type: Number, required: true, min: 0 },
        discountAmount: { type: Number, default: 0, min: 0 },
        refundedQuantity: { type: Number, default: 0, min: 0 },
        isDeleted: { type: Boolean, default: false, index: true },
    },
    { timestamps: true, versionKey: false }
);

marketplaceOrderItemSchema.index({ companyOrderId: 1 });
marketplaceOrderItemSchema.index({ companyId: 1, createdAt: -1 });

module.exports = mongoose.model(
    "MarketplaceOrderItem",
    marketplaceOrderItemSchema
);
