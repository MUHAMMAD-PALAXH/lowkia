const mongoose = require("mongoose");
const { SHIPMENT_STATUSES } = require("../../constants/marketplace");

/**
 * Tracking timeline events for a shipment.
 */
const shipmentTrackingEventSchema = new mongoose.Schema(
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
        status: {
            type: String,
            enum: SHIPMENT_STATUSES,
            required: true,
        },
        title: { type: String, required: true, trim: true },
        description: { type: String, default: "", trim: true },
        location: { type: String, default: "", trim: true },
        eventAt: { type: Date, default: Date.now, index: true },
        source: {
            type: String,
            enum: ["system", "courier", "company", "customer"],
            default: "system",
        },
        metadata: { type: mongoose.Schema.Types.Mixed, default: null },
        isDeleted: { type: Boolean, default: false, index: true },
    },
    { timestamps: true, versionKey: false }
);

shipmentTrackingEventSchema.index({ shipmentId: 1, eventAt: 1 });

module.exports = mongoose.model(
    "MarketplaceShipmentTrackingEvent",
    shipmentTrackingEventSchema
);
