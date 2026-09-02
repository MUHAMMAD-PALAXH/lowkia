const mongoose = require("mongoose");
const { SHIPMENT_STATUSES } = require("../../constants/marketplace");

/**
 * Fulfillment shipment under a CompanyOrder. Multiple shipments per company order allowed.
 */
const shipmentSchema = new mongoose.Schema(
    {
        shipmentNumber: {
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
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        status: {
            type: String,
            enum: SHIPMENT_STATUSES,
            default: "pending",
            index: true,
        },
        courierId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Courier",
            default: null,
            index: true,
        },
        courierName: { type: String, default: "", trim: true },
        trackingNumber: { type: String, default: "", trim: true },
        trackingUrl: { type: String, default: "", trim: true },
        estimatedDeliveryAt: { type: Date, default: null },
        shippedAt: { type: Date, default: null },
        deliveredAt: { type: Date, default: null },
        note: { type: String, default: "", trim: true },
        packedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AdminUser",
            default: null,
        },
        isDeleted: { type: Boolean, default: false, index: true },
    },
    { timestamps: true, versionKey: false }
);

shipmentSchema.index({ companyOrderId: 1, createdAt: 1 });
shipmentSchema.index({ companyId: 1, status: 1, createdAt: -1 });
shipmentSchema.index({ trackingNumber: 1 }, { sparse: true });

module.exports = mongoose.model("MarketplaceShipment", shipmentSchema);
