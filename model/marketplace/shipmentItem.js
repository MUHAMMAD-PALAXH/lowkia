const mongoose = require("mongoose");

/**
 * Line items included in a partial shipment.
 */
const shipmentItemSchema = new mongoose.Schema(
    {
        shipmentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "MarketplaceShipment",
            required: true,
            index: true,
        },
        companyOrderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "CompanyOrder",
            required: true,
            index: true,
        },
        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Company",
            required: true,
            index: true,
        },
        orderItemId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "MarketplaceOrderItem",
            required: true,
            index: true,
        },
        productId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Product",
            required: true,
        },
        productVariantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "ProductVariant",
            default: null,
        },
        productName: { type: String, required: true, trim: true },
        sku: { type: String, default: "", trim: true },
        quantity: { type: Number, required: true, min: 1 },
        isDeleted: { type: Boolean, default: false, index: true },
    },
    { timestamps: true, versionKey: false }
);

shipmentItemSchema.index({ shipmentId: 1, orderItemId: 1 }, { unique: true });

module.exports = mongoose.model("MarketplaceShipmentItem", shipmentItemSchema);
