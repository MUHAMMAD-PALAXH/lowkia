const mongoose = require("mongoose");
const { USER_NOTIFICATION_CHANNELS } = require("../../constants/marketplace");

/**
 * Transactional notifications for marketplace User (order/payment/shipment events).
 */
const userNotificationSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        channel: {
            type: String,
            enum: USER_NOTIFICATION_CHANNELS,
            default: "in_app",
            index: true,
        },
        category: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            index: true,
        },
        eventType: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            index: true,
        },
        title: { type: String, required: true, trim: true },
        body: { type: String, required: true, trim: true },
        masterOrderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "MasterOrder",
            default: null,
            index: true,
        },
        companyOrderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "CompanyOrder",
            default: null,
            index: true,
        },
        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Company",
            default: null,
            index: true,
        },
        companyName: { type: String, default: "", trim: true },
        shipmentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "MarketplaceShipment",
            default: null,
            index: true,
        },
        isRead: { type: Boolean, default: false, index: true },
        readAt: { type: Date, default: null },
        metadata: { type: mongoose.Schema.Types.Mixed, default: null },
        isDeleted: { type: Boolean, default: false, index: true },
    },
    { timestamps: true, versionKey: false }
);

userNotificationSchema.index({ userId: 1, createdAt: -1 });
userNotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model("UserNotification", userNotificationSchema);
